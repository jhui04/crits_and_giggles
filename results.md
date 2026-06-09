# Test Failure Investigation Results

## 1. Cause of Failures in `Fuzz View 1` and `Fuzz View 4`
Both tests are failing due to an identical accessibility violation (Axe violation: `heading-order`) in the `Campaign Settings` modal. 
- **Violation:** "Heading levels should only increase by one."
- **Target Node:** `<h4 id="players-heading">Manage Players</h4>`
- **Context:** The markup jumps to an `<h4>` without preceding correctly ordered heading levels within the modal structure.

## 2. Cause of Failure in `Fuzz View 3` (Run Mode -> Combat Tab)
This test is failing because it exceeds the 5-minute (300,000ms) timeout limit. 
- **Reason:** The `Combat Tab` is highly complex, containing encounters, multiple monsters, actions, spells, and skill checks. The deterministic fuzzer explores these UI paths recursively up to `maxDepth = 3`. 
- **Impact:** Navigating this dense hierarchy creates a combinatorial explosion of click paths (e.g., Encounter -> Monster -> Actions -> Skill Checks), causing the test to run endlessly until it hits the timeout threshold.

## 3. Duplicate View Testing (Performance Impact)
The extensive execution time and redundant error reporting are exacerbated by duplicate view testing across the test suite.
- **Root Cause:** In `tests/modal-accessibility.spec.ts`, the `scannedSignatures` and `visitedStateSignatures` tracking Sets are instantiated *inside* the `fuzzView` function.
- **Effect:** State memory is scoped per-test, not globally. This means if `Fuzz View 1` (Create Mode) and `Fuzz View 4` (Main Menu) both find a path to the `Campaign Settings` modal, the fuzzer will unnecessarily scan and validate the exact same view twice. Sharing visited view signatures globally across the suite would prevent testing duplicate views and drastically reduce test length.