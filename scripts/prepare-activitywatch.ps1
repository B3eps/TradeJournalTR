$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$cacheRoot = Join-Path $projectRoot 'vendor-cache'
$zipPath = Join-Path $cacheRoot 'activitywatch-v0.14.1-windows-x86_64.zip'
$extractRoot = Join-Path $cacheRoot 'activitywatch-unpacked'
$bundleRoot = Join-Path $cacheRoot 'activitywatch'
$url = 'https://github.com/ActivityWatch/activitywatch/releases/download/v0.14.1/activitywatch-v0.14.1-windows-x86_64.zip'
$expectedHash = 'F6AA42FF1D898258379958028FC8C181DFE65439C07EEBA8E7E7C13865E446CA'
function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  try {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '')) }
    finally { $sha.Dispose() }
  } finally { $stream.Dispose() }
}
New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $zipPath) -or (Get-Sha256 $zipPath) -ne $expectedHash) {
  $downloadPath = "$zipPath.download"
  Invoke-WebRequest -Uri $url -OutFile $downloadPath
  if ((Get-Sha256 $downloadPath) -ne $expectedHash) { throw 'ActivityWatch arşivinin SHA-256 doğrulaması başarısız.' }
  Move-Item -LiteralPath $downloadPath -Destination $zipPath -Force
}
if (-not (Test-Path -LiteralPath (Join-Path $bundleRoot 'aw-qt.exe'))) {
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
  $sourceRoot = Join-Path $extractRoot 'activitywatch'
  if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'aw-qt.exe'))) { throw 'ActivityWatch arşivinde aw-qt.exe bulunamadı.' }
  New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null
  Copy-Item -Path (Join-Path $sourceRoot '*') -Destination $bundleRoot -Recurse -Force
}
if (-not (Test-Path -LiteralPath (Join-Path $bundleRoot 'aw-qt.exe'))) { throw 'ActivityWatch uygulama paketine hazırlanamadı.' }
Write-Host 'ActivityWatch v0.14.1 pakete hazır; resmi arşiv SHA-256 ile doğrulandı.'
