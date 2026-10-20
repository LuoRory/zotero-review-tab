[CmdletBinding()]
param(
  [ValidateSet('Status', 'Setup', 'Restart', 'Logs', 'Rollback')]
  [string]$Mode = 'Status',
  [string]$Profile = (Join-Path $env:APPDATA "Zotero\Zotero\Profiles\default"),
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AddonId = 'review-tab@local.zotero'
$ProxyPath = Join-Path (Join-Path $Profile 'extensions') $AddonId
$PrefsPath = Join-Path $Profile 'prefs.js'
$BackupRoot = Join-Path $env:LOCALAPPDATA 'ReviewTabDev\backups'
$LogRoot = Join-Path $env:LOCALAPPDATA 'ReviewTabDev\logs'
$ZoteroExe = Join-Path $env:ProgramFiles 'Zotero\zotero.exe'

function Assert-Project {
  $manifestPath = Join-Path $ProjectRoot 'manifest.json'
  if (-not (Test-Path $manifestPath)) { throw "Missing manifest: $manifestPath" }
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.applications.zotero.id -ne $AddonId) { throw "Manifest ID does not match $AddonId" }
}
function Get-ProxyState {
  [pscustomobject]@{
    Profile = $Profile
    Proxy = $ProxyPath
    Exists = Test-Path $ProxyPath -PathType Leaf
    Target = if (Test-Path $ProxyPath -PathType Leaf) { (Get-Content $ProxyPath -Raw).Trim() } else { $null }
    Xpi = Join-Path (Split-Path $ProxyPath -Parent) "$AddonId.xpi"
    XpiExists = Test-Path (Join-Path (Split-Path $ProxyPath -Parent) "$AddonId.xpi")
  }
}
function Backup-Prefs {
  if (-not (Test-Path $PrefsPath)) { throw "Profile prefs not found: $PrefsPath" }
  New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup = Join-Path $BackupRoot "prefs-$stamp.js"
  Copy-Item $PrefsPath $backup -ErrorAction Stop
  return $backup
}
function Assert-RegisteredAddon {
  $registryPath = Join-Path $Profile 'extensions.json'
  if (-not (Test-Path $registryPath)) { return }
  $registry = Get-Content $registryPath -Raw | ConvertFrom-Json
  $addon = @($registry.addons | Where-Object { $_.id -eq $AddonId })[0]
  if ($null -eq $addon) { throw "Source proxy was not registered in $registryPath; start Zotero once to rebuild the extension registry." }
  if ($addon.userDisabled) { throw "Source proxy is registered but disabled. Enable Review Tab in Zotero Add-ons once, then restart development mode." }
}
function Enable-Proxy {
  Assert-Project
  $state = Get-ProxyState
  if (Get-Process zotero -ErrorAction SilentlyContinue) { throw 'Close Zotero before enabling the source proxy.' }
  $backup = Backup-Prefs
  New-Item -ItemType Directory -Force -Path (Split-Path $ProxyPath -Parent) | Out-Null
  if ($state.XpiExists) {
    New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $xpiBackup = Join-Path $BackupRoot "$AddonId-$stamp.xpi"
    Move-Item $state.Xpi $xpiBackup -ErrorAction Stop
    Write-Host "Moved competing XPI to development backup: $xpiBackup"
  }
  [System.IO.File]::WriteAllText($ProxyPath, "$ProjectRoot`r`n", [Text.UTF8Encoding]::new($false))
  $prefs = Get-Content $PrefsPath
  $prefs | Where-Object { $_ -notmatch 'extensions\.(lastAppBuildId|lastAppVersion)' } | Set-Content -Encoding utf8 $PrefsPath
  Write-Host "Source proxy enabled: $ProxyPath -> $ProjectRoot"
  Write-Host "Backed up prefs: $backup"
}
function Start-DevZotero {
  Assert-Project
  $state = Get-ProxyState
  if (-not $state.Exists -or $state.Target -ne $ProjectRoot) { throw "Expected source proxy is missing or wrong: $ProxyPath" }
  if (Get-Process zotero -ErrorAction SilentlyContinue) {
    if (-not $Force) { throw 'Zotero is running. Close it before restarting, or rerun with -Force to stop it.' }
    Stop-Process -Name zotero -Force
    Start-Sleep -Milliseconds 800
  }
  if (-not (Test-Path $ZoteroExe)) { throw "Zotero executable not found: $ZoteroExe" }
  Push-Location $ProjectRoot
  try { npm run check; if ($LASTEXITCODE -ne 0) { throw 'Plugin checks failed.' } } finally { Pop-Location }
  New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $stdoutLog = Join-Path $LogRoot "zotero-$stamp.stdout.log"
  $stderrLog = Join-Path $LogRoot "zotero-$stamp.stderr.log"
  $args = '-purgecaches', '-ZoteroDebugText', '-jsconsole'
  Write-Host "Starting Zotero source proxy development session. Logs: $stdoutLog ; $stderrLog"
  Start-Process -FilePath $ZoteroExe -ArgumentList $args -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
  Start-Sleep -Seconds 4
  Write-Host 'Expected log marker: [Review Tab] ... LOADED'
}
function Show-Logs {
  if (-not (Test-Path $LogRoot)) { Write-Host 'No Review Tab development logs yet.'; return }
  $latest = Get-ChildItem $LogRoot -Filter 'zotero-*.stdout.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { Write-Host 'No Review Tab development logs yet.'; return }
  $stderr = $latest.FullName -replace '\.stdout\.log$', '.stderr.log'
  Write-Host "Latest logs: $($latest.FullName) ; $stderr"
  @($latest.FullName, $stderr) | Where-Object { Test-Path $_ } | ForEach-Object { Get-Content $_ -Tail 160 } | Select-String -Pattern '\[Review Tab\]|Error|Exception|review-tab' -CaseSensitive:$false
}
function Remove-Proxy {
  if (Get-Process zotero -ErrorAction SilentlyContinue) { throw 'Close Zotero before removing the source proxy.' }
  if (Test-Path $ProxyPath -PathType Leaf) { Remove-Item $ProxyPath -Force; Write-Host "Removed source proxy: $ProxyPath" } else { Write-Host 'No source proxy found.' }
}

switch ($Mode) {
  'Status' { Assert-Project; Get-ProxyState | Format-List; Write-Host "Running Zotero processes: $((Get-Process zotero -ErrorAction SilentlyContinue | Measure-Object).Count)" }
  'Setup' { Enable-Proxy }
  'Restart' { Start-DevZotero }
  'Logs' { Show-Logs }
  'Rollback' { Remove-Proxy }
}
