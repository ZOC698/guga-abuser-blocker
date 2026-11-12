$ErrorActionPreference = 'Stop'
$projectDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$extensionDir = Join-Path $projectDir 'extension'
$outputDir = [System.IO.Path]::GetFullPath((Join-Path $projectDir '..'))
$zipPath = Join-Path $outputDir 'guga-abuser-blocker-0.1.0.zip'
Push-Location $projectDir
try {
    & node scripts/check.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Extension check failed.' }
    $packageItems = @($extensionDir, (Join-Path $projectDir 'README.md'), (Join-Path $projectDir 'README.en.md'), (Join-Path $projectDir 'README.zh-CN.md'), (Join-Path $projectDir 'README.ja.md'), (Join-Path $projectDir 'PRIVACY.md'), (Join-Path $projectDir 'DATA_FORMAT.md'), (Join-Path $projectDir 'CONTRIBUTING.md'), (Join-Path $projectDir 'VERIFICATION.md'), (Join-Path $projectDir 'lists'))
    $packageItems += @('schemas', 'scripts', 'tests', 'package.json') | ForEach-Object { Join-Path $projectDir $_ }
    Compress-Archive -Path $packageItems -DestinationPath $zipPath -Force
    Get-FileHash -LiteralPath $zipPath -Algorithm SHA256 | Format-List Path,Hash
} finally { Pop-Location }
