param(
  [string]$SourceRoot = (Join-Path $PSScriptRoot '..'),
  [string]$InstallRoot = (Join-Path $env:APPDATA 'trade-gunlugu')
)

$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$appDir = Join-Path $root 'app'
$runId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$stageDir = Join-Path $root "app-stage-$runId"
$previousDir = Join-Path $root "app-previous-$runId"
$backupDir = Join-Path $root "yedek-guncelleme-$runId"

function Assert-InstallChild([string]$path) {
  $full = [IO.Path]::GetFullPath($path)
  if (-not $full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Kurulum klasoru disinda islem reddedildi: $full"
  }
}
@($appDir, $stageDir, $previousDir, $backupDir) | ForEach-Object { Assert-InstallChild $_ }

if (-not (Test-Path -LiteralPath (Join-Path $source 'package.json'))) { throw 'Kaynak proje bulunamadi.' }
$listener = Get-NetTCPConnection -LocalPort 8471 -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw '8471 portu kullanimda. Uygulamayi sistem tepsisinden de kapatin.' }

$npm = Get-Command npm.cmd -ErrorAction Stop
Push-Location $source
try {
  & $npm.Source run build
  if ($LASTEXITCODE -ne 0) { throw 'Arayuz derlenemedi.' }
  & $npm.Source run bundle
  if ($LASTEXITCODE -ne 0) { throw 'Sunucu paketlenemedi.' }
} finally { Pop-Location }

$serverFile = Join-Path $source 'electron\server.cjs'
$schemaFile = Join-Path $source 'server\src\db\schema.sql'
$publicDir = Join-Path $source 'public'
foreach ($required in @($serverFile, $schemaFile, (Join-Path $publicDir 'trades.html'), (Join-Path $publicDir 'assets\appBundle.js'), (Join-Path $publicDir 'assets\app.css'))) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Gerekli dosya eksik: $required" }
}

New-Item -ItemType Directory -Path $root -Force | Out-Null
$dataDir = Join-Path $root 'data'
if (Test-Path -LiteralPath $dataDir -PathType Container) {
  Write-Host 'Kullanici verisi yedekleniyor...'
  & robocopy.exe $dataDir $backupDir /E /R:2 /W:1 /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Veri yedegi basarisiz (robocopy: $LASTEXITCODE). Guncelleme durduruldu." }
  foreach ($name in @('rrmetrics.db', 'secret.key')) {
    $original = Join-Path $dataDir $name
    if (Test-Path -LiteralPath $original -PathType Leaf) {
      $copy = Join-Path $backupDir $name
      if (-not (Test-Path -LiteralPath $copy -PathType Leaf)) { throw "Veri yedeginde $name eksik." }
      if ((Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash) {
        throw "Veri yedeginde $name dogrulanamadi. Guncelleme durduruldu."
      }
    }
  }
  Write-Host "Veri yedegi: $backupDir"
}

Write-Host 'Yeni surum ayri klasorde hazirlaniyor...'
New-Item -ItemType Directory -Path $stageDir | Out-Null
Copy-Item -LiteralPath $serverFile -Destination (Join-Path $stageDir 'server.cjs')
Copy-Item -LiteralPath $schemaFile -Destination (Join-Path $stageDir 'schema.sql')
Copy-Item -LiteralPath $publicDir -Destination (Join-Path $stageDir 'public') -Recurse

$hashes = [ordered]@{}
foreach ($file in (Get-ChildItem -LiteralPath $stageDir -Recurse -File | Sort-Object FullName)) {
  $relative = $file.FullName.Substring($stageDir.Length + 1).Replace('\', '/')
  if ($relative -eq 'server.cjs') { $sourceFile = $serverFile }
  elseif ($relative -eq 'schema.sql') { $sourceFile = $schemaFile }
  else { $sourceFile = Join-Path $source ($relative.Replace('/', '\')) }
  $sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant()
  $copiedHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sourceHash -ne $copiedHash) { throw "Kopyalanan dosya dogrulanamadi: $relative" }
  $hashes[$relative] = $copiedHash
}
$version = Get-Date -Format 'yyyy.MM.dd-HHmmss'
$manifest = [ordered]@{ version = $version; format = 2; files = $hashes }
$json = $manifest | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $stageDir 'version.json'), $json + "`n", [Text.UTF8Encoding]::new($false))

$oldMoved = $false
try {
  if (Test-Path -LiteralPath $appDir) {
    Move-Item -LiteralPath $appDir -Destination $previousDir
    $oldMoved = $true
  }
  Move-Item -LiteralPath $stageDir -Destination $appDir
} catch {
  if ($oldMoved -and -not (Test-Path -LiteralPath $appDir)) {
    Move-Item -LiteralPath $previousDir -Destination $appDir
  }
  throw
}

Write-Host "Guncellendi: $version"
if ($oldMoved) { Write-Host "Onceki surum: $previousDir" }

# Keep several known updater snapshots for rollback without allowing unlimited growth.
$oldVersions = Get-ChildItem -LiteralPath $root -Directory -Filter 'app-previous-*' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^app-previous-\d{8}-\d{6}-[a-f0-9]{8}$' } |
  Sort-Object Name -Descending
foreach ($oldVersion in ($oldVersions | Select-Object -Skip 3)) {
  Assert-InstallChild $oldVersion.FullName
  try { Remove-Item -LiteralPath $oldVersion.FullName -Recurse -Force }
  catch { Write-Warning "Eski surum silinemedi, saklandi: $($oldVersion.FullName)" }
}
