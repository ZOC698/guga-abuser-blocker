$ErrorActionPreference = 'Stop'
$projectDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$extensionDir = Join-Path $projectDir 'extension'
$outputDir = [System.IO.Path]::GetFullPath((Join-Path $projectDir '..'))
$manifest = Get-Content -LiteralPath (Join-Path $extensionDir 'manifest.json') -Raw | ConvertFrom-Json
$zipPath = Join-Path $outputDir ('guga-abuser-blocker-' + $manifest.version + '.zip')
Push-Location $projectDir
try {
    & node scripts/check.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Extension check failed.' }
    $packageItems = @($extensionDir, (Join-Path $projectDir 'README.md'), (Join-Path $projectDir 'README.en.md'), (Join-Path $projectDir 'README.zh-CN.md'), (Join-Path $projectDir 'README.ja.md'), (Join-Path $projectDir 'PRIVACY.md'), (Join-Path $projectDir 'DATA_FORMAT.md'), (Join-Path $projectDir 'CONTRIBUTING.md'), (Join-Path $projectDir 'VERIFICATION.md'), (Join-Path $projectDir 'lists'))
    $packageItems += @('schemas', 'scripts', 'tests', 'package.json', 'package-lock.json') | ForEach-Object { Join-Path $projectDir $_ }
    Compress-Archive -Path $packageItems -DestinationPath $zipPath -Force
    $zipStream = [System.IO.File]::OpenRead($zipPath)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $zipHash = [BitConverter]::ToString($sha256.ComputeHash($zipStream)).Replace('-', '')
        [PSCustomObject]@{ Path = $zipPath; Hash = $zipHash } | Format-List
    } finally { $zipStream.Dispose(); $sha256.Dispose() }
} finally { Pop-Location }
