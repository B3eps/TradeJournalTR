param(
  [string]$SourceRoot = (Join-Path $PSScriptRoot '..'),
  [string]$OutputRoot = ''
)
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
if (-not $OutputRoot) { $OutputRoot = Join-Path $source 'dist-app\update-feed' }
$out = [IO.Path]::GetFullPath($OutputRoot).TrimEnd('\')
$distRoot = [IO.Path]::GetFullPath((Join-Path $source 'dist-app')).TrimEnd('\')
if (-not $out.StartsWith($distRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "Update feed, dist-app klasorunun altinda olmali: $out"
}
if (Test-Path -LiteralPath $out) { throw "Cikti klasoru zaten var; yeni bir ad secin: $out" }
$npm = Get-Command npm.cmd -ErrorAction Stop
Push-Location $source
try {
  & $npm.Source run build
  if ($LASTEXITCODE -ne 0) { throw 'Arayuz derlenemedi.' }
  & $npm.Source run bundle
  if ($LASTEXITCODE -ne 0) { throw 'Sunucu paketlenemedi.' }
} finally { Pop-Location }
$stage = Join-Path $out 'stage'
New-Item -ItemType Directory -Path (Join-Path $stage 'public') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'electron\server.cjs') -Destination (Join-Path $stage 'server.cjs')
Copy-Item -LiteralPath (Join-Path $source 'server\src\db\schema.sql') -Destination (Join-Path $stage 'schema.sql')
Copy-Item -Path (Join-Path $source 'public\*') -Destination (Join-Path $stage 'public') -Recurse -Force
$hashes = [ordered]@{}
foreach ($file in (Get-ChildItem -LiteralPath $stage -Recurse -File | Sort-Object FullName)) {
  $relative = $file.FullName.Substring($stage.Length + 1).Replace('\', '/')
  $bytes = [IO.File]::ReadAllBytes($file.FullName)
  if ($file.Extension -match '^\.(js|css|html|sql|json|txt|svg|xml)$') {
    $text = [Text.Encoding]::UTF8.GetString($bytes).Replace("`r`n", "`n")
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($text)
  }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $hashes[$relative] = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
$version = Get-Date -Format 'yyyy.MM.dd-HHmmss'
$manifest = [ordered]@{ version = $version; format = 2; files = $hashes }
$manifestPath = Join-Path $stage 'version.json'
$json = $manifest | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText($manifestPath, $json + "`n", [Text.UTF8Encoding]::new($false))
Write-Host "Update feed hazir: $stage"
Write-Host "Manifest: $manifestPath"
