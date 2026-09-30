# Builds (if needed), starts and stops the Crits & Giggles servers on
# the host, the same way the root playwright.config.ts does:
#   - API:  node server/index.js with PORT=3005 DB_MODE=memory NODE_ENV=test
#   - app:  npx vite preview --port 5174 with VITE_API_TARGET pointing at the API
# The guest reaches them through VirtualBox NAT at 10.0.2.2, which VirtualBox
# maps to the host's loopback. Inside the guest, the runner's global-setup.ts
# forwards localhost:5174 and localhost:3005 to 10.0.2.2, so the browser uses
# http://localhost:5174 exactly like the regular suite.
#
# vite preview binds 127.0.0.1 explicitly: NAT forwards 10.0.2.2 to the host's
# IPv4 loopback, and on Windows "localhost" may resolve to ::1 only.
# Requires config.ps1 to already be dot-sourced.

$Global:HostAppPort = 5174
$Global:HostApiPort = 3005
# The guest's view of the host (VirtualBox NAT gateway).
$Global:GuestAppHost = '10.0.2.2'

function Wait-HttpOk {
    param([string] $Url, [int] $TimeoutSeconds = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
        } catch { }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Test-PortInUse {
    param([int] $Port)
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

# True when dist/ is missing or older than any app source file.
function Test-AppBuildStale {
    $distIndex = Join-Path $RepoRoot 'dist\index.html'
    if (-not (Test-Path $distIndex)) { return $true }
    $built = (Get-Item $distIndex).LastWriteTimeUtc
    $inputs = @('index.html', 'vite.config.ts', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.app.json') |
        ForEach-Object { Join-Path $RepoRoot $_ } | Where-Object { Test-Path $_ } | ForEach-Object { Get-Item $_ }
    $inputs += Get-ChildItem (Join-Path $RepoRoot 'src') -Recurse -File -ErrorAction SilentlyContinue
    $inputs += Get-ChildItem (Join-Path $RepoRoot 'public') -Recurse -File -ErrorAction SilentlyContinue
    $newer = $inputs | Where-Object { $_.LastWriteTimeUtc -gt $built } | Select-Object -First 1
    return [bool]$newer
}

# Runs `npm run build` in the repo root if dist/ is stale. Returns $true on success.
function Invoke-AppBuildIfStale {
    param([string] $LogDir)
    if (-not (Test-AppBuildStale)) {
        Write-Host 'INFO: dist/ is up to date; skipping npm run build'
        return $true
    }
    Write-Host 'INFO: dist/ is missing or older than the sources; running npm run build'
    $log = Join-Path $LogDir 'app-build.log'
    Push-Location $RepoRoot
    try {
        & cmd.exe /c "npm run build > `"$log`" 2>&1" | Out-Null
        $code = $LASTEXITCODE
    } finally { Pop-Location }
    if ($code -ne 0) {
        Write-Host "FAIL: npm run build (exit $code); last lines of $log follow"
        Get-Content $log -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  | $_" }
        return $false
    }
    Write-Host 'PASS: npm run build'
    return $true
}

function Start-HostAppServers {
    param([string] $LogDir)
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $procs = @()

    foreach ($port in @($HostApiPort, $HostAppPort)) {
        if (Test-PortInUse $port) {
            Write-Host "FAIL: port $port is already in use on the host (is npm run dev or npm run test running?)"
            return [PSCustomObject]@{ Processes = $procs; Ok = $false }
        }
    }
    # Say which checkout is served (RepoRoot comes from this script's location,
    # so a git worktree serves its own app), in the console; each server log starts
    # with the working directory its process really runs in.
    Write-Host "INFO: serving the app from $RepoRoot"
    if (-not (Invoke-AppBuildIfStale -LogDir $LogDir)) {
        return [PSCustomObject]@{ Processes = $procs; Ok = $false }
    }

    $apiCmd = "echo working directory: %CD%&& set PORT=$HostApiPort&& set DB_MODE=memory&& set NODE_ENV=test&& node server/index.js"
    $procs += Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $apiCmd -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput (Join-Path $LogDir 'api-server.log') -RedirectStandardError (Join-Path $LogDir 'api-server.err.log') `
        -WindowStyle Hidden -PassThru

    $appCmd = "echo working directory: %CD%&& set VITE_API_TARGET=http://127.0.0.1:$HostApiPort&& npx vite preview --port $HostAppPort --strictPort --host 127.0.0.1"
    $procs += Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $appCmd -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput (Join-Path $LogDir 'app-server.log') -RedirectStandardError (Join-Path $LogDir 'app-server.err.log') `
        -WindowStyle Hidden -PassThru

    $apiOk = Wait-HttpOk -Url "http://127.0.0.1:$HostApiPort/api/campaigns"
    $appOk = Wait-HttpOk -Url "http://127.0.0.1:$HostAppPort/"
    Write-Host ("{0}: host API server on port {1}" -f ($(if ($apiOk) { 'PASS' } else { 'FAIL' }), $HostApiPort))
    Write-Host ("{0}: host app server on 127.0.0.1:{1}" -f ($(if ($appOk) { 'PASS' } else { 'FAIL' }), $HostAppPort))
    return [PSCustomObject]@{ Processes = $procs; Ok = ($apiOk -and $appOk) }
}

function Stop-HostAppServers {
    param($Servers)
    if (-not $Servers) { return }
    foreach ($p in $Servers.Processes) {
        # Kill the whole tree (cmd -> node / npx -> node).
        & taskkill.exe /PID $p.Id /T /F 2>$null | Out-Null
    }
}
