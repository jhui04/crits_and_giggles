# NVDA screen reader tests in a VM

## What this is

An automated test suite that drives the real NVDA screen reader against the Crits & Giggles app and asserts on what NVDA actually says. It runs inside a local VirtualBox VM, never on your own desktop, so it cannot disturb JAWS.

- The VM is headless (no window) and its audio is switched off. You never hear NVDA.
- Your machine serves the app. Inside the VM, Playwright opens Chromium, Guidepup starts a portable NVDA, and each test presses real keys through NVDA.
- Guidepup records every phrase NVDA speaks. Tests check that phrases contain the expected words, for example "the oracle" and "dialog".
- The tests (in `runner/tests/app.nvda.spec.ts`, with shared setup in `runner/tests/app-fixtures.ts`):
  - The Oracle: Alt+O speaks the dialog name, and Escape closes it and returns to the button you started from.
  - The dice roller: Alt+R speaks the dialog, and rolling speaks the result from the live region.
  - The Oracle's Search Type disclosure (`runner/tests/oracle-disclosure.nvda.spec.ts`): one browse-mode stop, one Enter or Space opens the list of pressed/not pressed buttons without NVDA switching to focus mode, Down Arrow and Enter in browse mode choose and return to the button, Escape cancels, and the Tab path.
- Nothing here is part of `npm run test`. The suite has its own project in `tools/nvda-vm/runner/`, with its own `package.json`, so Guidepup never enters the root `package.json`. The root `eslint.config.js` ignores `runner/`, and the root TypeScript build does not include it.

## One-time setup

You need:

- VirtualBox 7.2, with the VM `jaws-rcs-test` and its snapshot `windows-ready`.
- The VM password in `%USERPROFILE%\jaws-vm\vm-password.txt`, as plain ASCII with no byte order mark. It stays outside the repository; the scripts only pass the file's path to VirtualBox.
- An internet connection for the VM (it downloads Node, NVDA and Chromium).

From the repository root, run:

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools\nvda-vm\setup-vm.ps1
```

It takes about 20 minutes. It prints `PASS`, `FAIL` and `INFO` lines, and ends with a snapshot called `nvda-ready`, replacing any older one. Every test run starts from that snapshot. Add `-SkipIfReady` to do nothing when `nvda-ready` already exists.

Run the setup again only if you change `runner/package.json` in a big way or want a clean rebuild. Small package changes are picked up automatically at test time: if `runner/package-lock.json` differs from the one in the snapshot, the run does `npm ci` first.

## Running the tests

From the repository root:

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools\nvda-vm\run-tests.ps1
```

This does everything, with no further input:

1. Runs `npm run build` if `dist` is older than the sources, then starts the app on your machine: `vite preview` on port 5174 and the API on port 3005 with an in-memory database. It is the same setup as the regular Playwright suite.
2. Restores the `nvda-ready` snapshot and starts the VM headless.
3. Copies the latest `runner` folder into the VM and runs the tests.
4. Copies the results back, stops the app servers, shuts the VM down and prints a summary.

A full run takes about 4 minutes. The exit code is 0 only when every test passed.

Ports 5174 and 3005 must be free. Stop `npm run dev` or `npm run test` first.

Options:

- `-Grep "text"`: only run tests whose title matches this regular expression, for example `-Grep "Oracle"`.
- `-KeepVmRunning`: leave the VM running afterwards, for diagnosis.
- `-UseRunningVm`: reuse the running VM as it is instead of restoring the snapshot. This is faster for trying a change, but it is not a clean run.
- `-TestTimeoutMinutes 20`: how long the test step may take.

## Reading the results

- The console prints the progress lines of the run, then a block between `===== NVDA test summary =====` and a closing line of equals signs.
- In the summary there is one line per test, starting with `PASS:`, `FAIL:` or `SKIP:`, then the test title and its duration.
- A failing test has up to 12 `error:` lines after it. They usually include the phrase `It said:` followed by everything NVDA said.
- Every test has an `NVDA spoken log:` section. It lists each step as `[step] focus: <element>; spoken: <phrases>`, which shows where the browser's focus was and what NVDA said after each key, then the numbered phrases of the last step.
- The last summary line starts with `SUMMARY:` and counts the passed, failed and skipped tests.
- Everything is saved in `tools/nvda-vm/results/<date-time>/`, which git ignores:
  - `playwright/summary.txt`: the same summary as a text file.
  - `playwright.log`: the full console output of the test run in the VM.
  - `playwright/results.json`: Playwright's machine-readable results.
  - `api-server.log`, `app-server.log`, `app-build.log`: the app servers and the build.
  - `windows.log`: only after a failure. A text list of the windows open in the VM and the foreground window, which shows when something else took the foreground.
- Setup logs go to `results/setup-<date-time>/`. When a setup step fails it also saves `failure-screenshot.png` of the VM, for an AI assistant to inspect; the text logs are enough on their own.

## Adding a test

- Tests live in `tools/nvda-vm/runner/tests/` and must end in `.nvda.spec.ts`.
- Add to `app.nvda.spec.ts` or copy its pattern. A new spec file calls `useAppSuite()` from `app-fixtures.ts` inside its `test.describe`, which gives it `resetAndOpenApp` and `note` and the shared NVDA setup:
  1. Reset or seed state through the API at `apiUrl` (from `tests/app-urls.ts`), the same API the regular suite uses. Seed a small campaign: with an empty database the app loads its large default campaign, whose text is full of links that NVDA's page click can land on.
  2. Open `appUrl` with `page.goto`, then call `nvda.navigateToWebContent()`, which brings the browser to the front and puts NVDA in browse mode at the top of the page.
  3. Before each action, call `nvda.clearSpokenPhraseLog()`. Then press keys through NVDA with `nvda.press('Tab', { capture: true })`. Key names include `Alt+o`, `Shift+Tab`, `ArrowDown`, `Enter` and `Escape`. Do not use `page.keyboard`: those keys bypass NVDA.
  4. Wait for speech with `const joined = await waitForSpeech(nvda, ['word', 'other word'])`, then assert with `expectSpoken(joined, ['word', 'other word'])`. On failure it names the missing words and prints everything NVDA said. Use a few lowercase key words, not whole sentences: wording changes between NVDA versions, and NVDA sometimes splits text (it reads "3d1" as "3d 1").
  5. Cross-check the DOM with Playwright, for example `await expect(locator).toBeFocused()`.
  6. The `afterEach` hook attaches the spoken log, so it appears in the summary.
- Try a new test quickly with `-Grep "part of its title"` and `-KeepVmRunning`, then `-UseRunningVm` for the next attempts. Finish with a clean run.
- If a test shows a real accessibility bug in the app, keep the assertion honest. Mark the test with `test.fail()` and a comment explaining the bug, rather than weakening the assertion.

## How NVDA and Guidepup behave

These facts were measured with NVDA 2026.2 and Guidepup 0.34, and the tests rely on them.

- Guidepup sends keys to NVDA over NVDA Remote Access (`127.0.0.1:6837`), and NVDA injects them into the foreground window. Only `nvda.type()` uses Windows `SendKeys`. Either way the browser must be the foreground window on the logged-in desktop.
- Speech is only recorded while a Guidepup action is in flight. `waitForSpeech()` therefore listens in extra 1-second windows, up to 5 seconds, to catch late speech such as live regions.
- NVDA restarts for every test, with a fresh copy of Guidepup's settings, so tests do not share state. The first test after boot takes longer while NVDA starts for the first time.
- NVDA plays a sound, not speech, when it switches between browse and focus mode. The tests set `virtualBuffers.passThroughAudioIndication` to false, so NVDA says "focus mode" and "browse mode" and the spoken log shows the mode.
- When focus lands in a text field or combo box, NVDA switches to focus mode on its own. The first Escape then only returns to browse mode, and NVDA keeps the key. A second Escape reaches the page. So closing the Oracle from its search field takes two Escapes.
- In browse mode, Enter on a form field such as a text field or combo box switches NVDA to focus mode, and NVDA keeps the Enter itself, the same as for a native `<select>`. The control does not act on that Enter: a combo box's list stays closed, and the next key, for example ArrowDown, reaches the page.
- A button does not switch NVDA to focus mode. (The Search Type control is a disclosure: a plain button with no `aria-haspopup`, because JAWS keeps forms mode on buttons with `aria-haspopup` and inside a `role="menu"`, so NVDA reads it as a plain button with its expanded state.) Reaching it with Tab or Shift+Tab switches NVDA to browse mode, so ArrowDown moves the browse cursor and does not move DOM focus. In browse mode, Enter and Space click the button. Its options are also plain buttons (`aria-pressed`), so when focus moves to one NVDA stays in browse mode: Down Arrow moves the browse cursor to the next option, and Enter clicks the option under the cursor. To move DOM focus between options under NVDA, use Tab and Shift+Tab. Escape in browse mode reaches the page.

## Design

- Everything that needs the screen (NVDA, Chromium and the Playwright run) must run on the `tester` user's interactive desktop. Programs started directly through `VBoxManage guestcontrol run` are not on that desktop. So each guest script runs as a "step" through one of two on-demand scheduled tasks, `JawsTestUser` or `JawsTestElevated` (`lib/guest.ps1`, `Invoke-GuestStep`). The step writes a log and a `.done` marker with its exit code, and the host polls for the marker while streaming the log.
- The app runs on the host, like the regular suite. The VM reaches the host at `10.0.2.2`, which VirtualBox NAT maps to the host's loopback. Inside the VM, `runner/global-setup.ts` starts a small TCP forwarder from `localhost:5174` and `localhost:3005` to `10.0.2.2`. The browser therefore uses `http://localhost:5174`, exactly like the regular suite, so the Host header, the page origin and localStorage are the same, and vite's host check never sees a foreign host name. Host-side `vite preview` binds `127.0.0.1` explicitly, because NAT forwards to the host's IPv4 loopback.
- `setup-vm.ps1` makes the `nvda-ready` snapshot once: step tasks with hidden windows, IPv6 off, portable Node (SHA-256 checked), the runner's npm packages, Guidepup's NVDA, Playwright's Chromium, a firewall rule and a console setting. Every test run restores that snapshot, so runs start from a clean, known state.
- Names: the VM `jaws-rcs-test`, the guest folder `C:\jawstest`, the tasks `JawsTestUser` and `JawsTestElevated`, and the host folder `%USERPROFILE%\jaws-vm` are historical. The VM was first built for an abandoned JAWS attempt, blocked by licensing. Nothing JAWS-specific is installed in it. The names are kept because renaming them would mean rebuilding the snapshots. They all live in `config.ps1` and at the top of the `guest` scripts.
- The VM runs Windows 11 Enterprise Evaluation, installed from the ISO in `%USERPROFILE%\jaws-vm\iso`. The scripts that created the VM and the `windows-ready` snapshot are in the archive in `%USERPROFILE%\jaws-vm\archive`, not in this repository.

## Troubleshooting

Each item says what happened and what the scripts now do about it.

- "snapshot nvda-ready not found": run `setup-vm.ps1`.
- Guest authentication fails: the password file must be plain ASCII without a byte order mark. A UTF-8 byte order mark breaks authentication, and the scripts refuse such a file.
- "port 5174 (or 3005) is already in use": stop `npm run dev` or another test run.
- "npm run build failed": the app does not compile. Read `app-build.log` in the results folder. The NVDA suite serves the built `dist` folder.
- "The app on the host is not reachable from the guest": the app servers did not answer through 10.0.2.2. Read `api-server.log` and `app-server.log`.
- A run hangs: every guest step has a time limit, and the script then shuts the VM down. You can also stop the VM with `"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe" controlvm jaws-rcs-test poweroff`.
- Windows stops working after about 90 days: the evaluation licence has expired. It counts from when Windows was installed in the VM, and restoring a snapshot does not reset it. The current VM expires on 27 December 2026. To check, while the VM is running (for example after `-KeepVmRunning`), run `VBoxManage guestcontrol jaws-rcs-test run --username tester --passwordfile %USERPROFILE%\jaws-vm\vm-password.txt --exe C:\Windows\System32\cscript.exe -- //nologo C:\Windows\System32\slmgr.vbs /xpr`. Rebuild the VM from a fresh evaluation ISO with the archived scripts, then run `setup-vm.ps1` again.
- Speech is missing or belongs to another window: another window took the foreground in the VM. Read `windows.log` in the results folder. Known causes, now all prevented:
  - Console windows. The step tasks start PowerShell hidden, but Windows 11 hosts consoles in Windows Terminal, which ignores hidden windows. `guest/prep-user.ps1` switches `tester` to the classic console host.
  - A Windows Security firewall prompt when NVDA's Remote Access starts listening. `guest/prep-firewall.ps1` adds an inbound block rule for NVDA, which suppresses the prompt. Guidepup connects over loopback, which the firewall does not filter.
  - A OneDrive "Turn On Windows Backup" notification that appeared about 10 minutes after boot. `guest/run-playwright.ps1` turns notifications off and stops OneDrive before every run.
- Every test fails with "NVDA cannot be started": NVDA's files were extracted badly. Guidepup's unzip sometimes leaves some of NVDA's DLLs zero-filled, which gives a "Bad Image" error. `guest/setup-runner.ps1` re-extracts every file from Guidepup's checked zip and verifies each one byte for byte, so rerun the setup.
- Downloads fail during setup with "timed out after 30000ms": VirtualBox NAT gives the VM an IPv6 address, but IPv6 connections hang, and Playwright's downloader tries IPv6 first. `guest/prep-network.ps1` turns IPv6 off in the VM, and the Chromium download is retried up to 3 times. If it still fails, run the setup again.
- A results file shows lines from an older run: `VBoxManage guestcontrol copyfrom` does not overwrite existing host files, so `Copy-FromGuest` deletes the host file first. Keep that if you change the copy code.
- The VM does not shut down: `acpipowerbutton` is unreliable in this guest, so the scripts run `shutdown.exe` inside the VM and power off hard if that stalls.
- A guest program gets an unexpected extra argument: with `VBoxManage guestcontrol run --exe X -- args`, do not repeat the program name after `--`.

## Removing everything

1. Delete the snapshot, if you want the VM back at `windows-ready`: `VBoxManage snapshot jaws-rcs-test delete nvda-ready`.
2. To delete the VM completely, with its disk: `VBoxManage unregistervm jaws-rcs-test --delete`.
3. Delete `%USERPROFILE%\jaws-vm` (the password file, the Windows ISO and the archive).
4. Delete the `tools/nvda-vm` folder, and remove its line from `.gitignore` and its entry from the ignores in `eslint.config.js`.

Nothing was installed on your own machine apart from the npm packages in `tools/nvda-vm/runner/node_modules`, which are used only for type checking and are deleted with the folder.
