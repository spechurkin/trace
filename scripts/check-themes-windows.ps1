param([Parameter(Mandatory = $true)][string]$Installer, [string]$BuildConfig)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$testRoot = [IO.Path]::GetFullPath((Join-Path $workspace '.test-data'))
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
if (-not $installerPath.StartsWith($testRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Use an isolated installer artifact under .test-data.'
}
if ((Get-Item -LiteralPath $installerPath).VersionInfo.ProductName -ne 'TraceThemeLifecycleTest') {
  throw 'The installer must use the isolated TraceThemeLifecycleTest product identity.'
}
$isolatedBuild = $false
if ($BuildConfig) {
  # Non-interactive electron-builder runs do not write builder-effective-config.yaml.
  # Accept the explicit JSON config passed to that build instead.
  $testBuild = Get-Content -LiteralPath $BuildConfig -Raw | ConvertFrom-Json
  $isolatedBuild = $testBuild.appId -eq 'studio.trace.theme-lifecycle-test' -and
    $testBuild.productName -eq 'TraceThemeLifecycleTest'
} else {
  $effectiveConfig = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $installerPath) 'builder-effective-config.yaml') -Raw
  $isolatedBuild = $effectiveConfig -match '(?m)^appId: studio\.trace\.theme-lifecycle-test\s*$' -and
    $effectiveConfig -match '(?m)^productName: TraceThemeLifecycleTest\s*$'
}
if (-not $isolatedBuild) {
  throw 'The isolated artifact must use a separate appId and productName.'
}
# Build with productName=TraceThemeLifecycleTest and a separate appId.
foreach ($registryRoot in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
  $registered = Get-ChildItem -LiteralPath $registryRoot -ErrorAction SilentlyContinue |
    Get-ItemProperty -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'TraceThemeLifecycleTest*' }
  if ($registered) { throw 'A lifecycle test installation already exists; refusing to replace it.' }
}
$installDirectory = [IO.Path]::GetFullPath((Join-Path $testRoot ('theme-install-' + [Guid]::NewGuid().ToString('N'))))
if (-not $installDirectory.StartsWith($testRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid test directory.' }
New-Item -ItemType Directory -Path $installDirectory | Out-Null
$themeRoot = Join-Path $installDirectory 'themes'
$uninstaller = Join-Path $installDirectory 'Uninstall Trace.exe'

function Run-Installer([switch]$Update) {
  $arguments = @('/S', '/currentuser')
  if ($Update) { $arguments += '--updated' }
  $arguments += "/D=$installDirectory"
  $process = Start-Process -FilePath $installerPath -ArgumentList $arguments -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(60000)) { throw 'Installer timed out.' }
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'The artifact must use the isolated lifecycle-test identity.' }
}
function Snapshot-Themes {
  $files = Get-ChildItem -LiteralPath $themeRoot -Recurse -File | Sort-Object FullName
  return @($files | ForEach-Object { $_.FullName.Substring($themeRoot.Length) + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash })
}
function Assert-Themes($Expected, [string]$Stage) {
  $actual = Snapshot-Themes
  if (@(Compare-Object -ReferenceObject $Expected -DifferenceObject $actual).Count -ne 0) { throw "Theme files changed during $Stage." }
  Write-Output "PASS: $Stage preserves all theme paths and SHA-256 hashes."
}
function Run-Uninstaller {
  $process = Start-Process -FilePath $uninstaller -ArgumentList @('/S', "_?=$installDirectory") -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(60000)) { throw 'Uninstaller timed out.' }
  if ($process.ExitCode -ne 0) { throw "Uninstaller failed: $($process.ExitCode)" }
  if (Test-Path -LiteralPath (Join-Path $installDirectory 'Trace.exe')) { throw 'Application executable was not removed.' }
}

Run-Installer
$clubsSource = Join-Path $workspace 'resources/themes/clubs'
$clubsFolder = Join-Path $themeRoot 'clubs'
foreach ($file in @('theme.json', 'style.css')) {
  $installedFile = Join-Path $clubsFolder $file
  if (-not (Test-Path -LiteralPath $installedFile)) { throw "Clubs was not installed before the first launch: $file" }
  if ((Get-FileHash -LiteralPath $installedFile -Algorithm SHA256).Hash -ne
      (Get-FileHash -LiteralPath (Join-Path $clubsSource $file) -Algorithm SHA256).Hash) {
    throw "Installed Clubs differs from the bundled theme: $file"
  }
}
Write-Output 'PASS: Clubs is installed with the application before the first launch.'
$ownedTheme = Join-Path $themeRoot ('My Theme [' + [char]0x591c + ']')
New-Item -ItemType Directory -Path (Join-Path $ownedTheme 'images') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $ownedTheme 'theme.json'), '{"format":"clubs/theme","api_version":1,"name":"User theme","mode":"dark","stylesheet":"style.css"}')
[IO.File]::WriteAllText((Join-Path $ownedTheme 'style.css'), ':root { --theme-accent: #123456; }')
[IO.File]::WriteAllText((Join-Path $ownedTheme 'images/paper.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
[IO.File]::WriteAllText((Join-Path $clubsFolder 'style.css'), '/* User edits to Clubs must survive. */')
[IO.File]::WriteAllText((Join-Path $clubsFolder 'theme.json'), '{}')
$expected = Snapshot-Themes
Run-Installer
Assert-Themes $expected 'same-version reinstallation'
Run-Installer -Update
Assert-Themes $expected 'update-mode reinstallation'
Run-Uninstaller
Assert-Themes $expected 'uninstallation'
Run-Installer
Assert-Themes $expected 'installation after uninstall'
Run-Uninstaller
Assert-Themes $expected 'final uninstallation'
Write-Output "Preserved theme files: $themeRoot"
