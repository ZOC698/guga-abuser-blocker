$ErrorActionPreference = 'Stop'
$projectDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$extensionDir = Join-Path $projectDir 'extension'
$outputDir = [System.IO.Path]::GetFullPath((Join-Path $projectDir '..'))
$manifest = Get-Content -LiteralPath (Join-Path $extensionDir 'manifest.json') -Raw | ConvertFrom-Json
$zipPath = Join-Path $outputDir ('guga-abuser-blocker-' + $manifest.version + '-chrome-store.zip')
Push-Location $projectDir
try {
    & node scripts/check.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Extension check failed.' }
    # Chrome Web Store requires manifest.json at the ZIP root.
    $items = Get-ChildItem -LiteralPath $extensionDir | Select-Object -ExpandProperty FullName
    Compress-Archive -LiteralPath $items -DestinationPath $zipPath -Force
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        if (@($archive.Entries | Where-Object { $_.FullName -eq 'manifest.json' }).Count -ne 1) { throw 'Root manifest missing.' }
        $actual = @($archive.Entries | Where-Object { -not $_.FullName.EndsWith('/') })
        $expected = @(Get-ChildItem -LiteralPath $extensionDir -File -Recurse)
        if ($actual.Count -ne $expected.Count) { throw 'Store archive file count mismatch.' }
        foreach ($entry in $actual) {
            $relative = $entry.FullName.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
            $source = [System.IO.Path]::GetFullPath((Join-Path $extensionDir $relative))
            if (-not $source.StartsWith($extensionDir + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected archive path.' }
            if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw ('Unexpected file: ' + $entry.FullName) }
            $stream = $entry.Open()
            $hash = [System.Security.Cryptography.SHA256]::Create()
            try { $entryHash = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '') }
            finally { $stream.Dispose(); $hash.Dispose() }
            if ($entryHash -ne (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash) { throw ('Archive bytes differ: ' + $entry.FullName) }
        }
    } finally { $archive.Dispose() }
    [PSCustomObject]@{ Path = $zipPath; Files = $actual.Count; RootManifest = $true; Hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash } | Format-List
} finally { Pop-Location }
