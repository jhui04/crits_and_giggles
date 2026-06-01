# Accessibility Validation Results

## Overview
The accessibility testing integration as described in `design.md` has been successfully implemented across the project. `@axe-core/playwright` is integrated into both the baseline scans (`tests/accessibility-baseline.spec.ts`) and the deterministic fuzzer (`tests/modal-accessibility.spec.ts`).

## Findings against Strict Accessibility Standards

While the integration is structurally correct and fulfills most of the design requirements (such as hashing view signatures to avoid redundant scans and running on dynamic modals), the implementation fails the requirement to **"meet the most strict accessibility standards and that the tests ensure all possible accessiblity checks (not excluding any category of checks)."**

### Issue: Exclusion of Categories and Newer Standards
In `tests/utils/axe-helper.ts`, the `AxeBuilder` is configured as follows:

```typescript
const accessibilityScanResults = await new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  .analyze();
```

By explicitly chaining `.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])`, the implementation **restricts** Axe from running all of its available rules. This specifically excludes:
1. **WCAG 2.2 Checks:** Rules associated with `wcag22a` and `wcag22aa`.
2. **Best Practices:** Axe's `best-practice` tag, which contains many strict accessibility recommendations not strictly tied to WCAG success criteria but essential for maximizing accessibility.
3. **Experimental and other tags:** Any other checks Axe can perform outside those four specified tags.

To meet the requirement of not excluding any category of checks, the `.withTags(...)` constraint should either include all available tags (e.g., adding `wcag22a`, `wcag22aa`, `best-practice`, etc.) or be removed entirely to allow `AxeBuilder` to execute its complete default rule set.

## Conclusion
The structural framework (fuzzer integration, baseline tests) works as designed, but the Axe configuration itself is currently too permissive and violates the strict standards requirement by filtering out multiple categories of accessibility checks.
