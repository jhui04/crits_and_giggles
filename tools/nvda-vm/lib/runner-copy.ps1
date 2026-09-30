# Copies the test project (tools/nvda-vm/runner) into the guest, without
# node_modules, results or other local-only folders.
# Requires config.ps1 and lib/guest.ps1 to already be dot-sourced.

function Copy-RunnerToGuest {
    $stage = Join-Path $env:TEMP 'nvda-vm-runner-stage'
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $stage | Out-Null

    $exclude = @('node_modules', 'results', 'test-results', 'playwright-report')
    Get-ChildItem -Path $NvdaRunnerDir -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination $stage -Recurse -Force
    }
    if (-not (Test-Path (Join-Path $stage 'package-lock.json'))) {
        throw "runner/package-lock.json is missing; run 'npm install --package-lock-only' in $NvdaRunnerDir"
    }

    # Replace the guest copy's source files but keep its node_modules.
    Invoke-GuestPowerShell -Command @"
New-Item -ItemType Directory -Force -Path '$GuestRunnerDir' | Out-Null
Get-ChildItem -Path '$GuestRunnerDir' -Force | Where-Object { `$_.Name -ne 'node_modules' } | Remove-Item -Recurse -Force
"@ | Out-Null

    Get-ChildItem -Path $stage -Force | ForEach-Object {
        if ($_.PSIsContainer) {
            Copy-ToGuest -LocalPath $_.FullName -GuestPath "$GuestRunnerDir\$($_.Name)" -Recursive
        } else {
            Copy-ToGuest -LocalPath $_.FullName -GuestPath "$GuestRunnerDir\$($_.Name)"
        }
    }
    Remove-Item $stage -Recurse -Force
}
