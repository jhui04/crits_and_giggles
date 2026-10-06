# CLAUDE.md

This file is Claude Code's entry point for working in **Crits & Giggles**. The mission, architecture, and accessibility mandates live in [`GEMINI.md`](./GEMINI.md) — **read it first**, it is not legacy or agent-specific, it's the project's shared source of truth. This file adds Claude-specific operating notes on top of it.

## One-paragraph summary
Crits & Giggles is a screen-reader-first web app that lets a blind Dungeon Master run D&D 5e campaigns and live combat as fast as a sighted DM. React 19 + Vite frontend, Express 5 + SQLite (`better-sqlite3`) backend, plus a local-LLM "Assistant Oracle" chat co-DM (`server/assistant/`) that can only mutate game state through a mandatory Human-in-the-Loop (HITL) confirmation step. Every UI change is judged against WCAG 2.1/2.2, deterministic Playwright a11y tests, and strict focus-management rules — treat those as hard constraints, not style preferences.

## Before you start
1. Read `GEMINI.md` for mission, tech stack, architecture, and the non-negotiable accessibility mandates.
2. Read `docs/HITL_WRITE_TOOLS.md` before touching anything under `server/assistant/` or `src/components/hitl/`. The two-phase (stage → confirm) write architecture is the most load-bearing invariant in the codebase — do not add a code path that mutates campaign/encounter state from inside the LLM tool-call loop.
3. Skim `tests/modal-accessibility.spec.ts` for the canonical pattern used to test focus trapping/restoration — new modals and views are expected to follow it, not reinvent it.

## Repo map
```
src/                  React app (TypeScript)
  components/         UI, one file per feature area; src/components/hitl/ = HITL proposal cards
  services/           Testable logic used by components (dice, maps, data fetch/API clients)
  utils/              Pure helper functions (dnd math, grid/cover geometry, markdown)
  context/            React context providers (Campaign, World)
server/               Express 5 backend (ESM, Node)
  assistant/          LLM orchestrator, tool controller, HITL manager, vector store, config
  evals/              Scenario-based LLM eval harness + judge
  db.js               SQLite schema/access (better-sqlite3) -> data/campaigns.sqlite3
tools/                Python scrapers/generators that produce public/data/*.json
public/data/          Static SRD-derived JSON consumed directly by the frontend (monsters, spells, etc.)
tests/                Playwright E2E + accessibility specs
docs/HITL_WRITE_TOOLS.md   Spec for the write-confirmation framework — read before editing assistant code
.agents/              Config for a Gemini-CLI stop hook (build/test/lint + gap-analysis). Not Claude-specific.
```

## Commands
- `npm run dev` — build once, then run the Express server (nodemon) and Vite dev server concurrently.
- `npm run build` — `tsc -b && vite build`. Must pass before calling a task done.
- `npm run test` — build + `vitest run` + `playwright test`. This is the full check; run it before finishing any non-trivial change.
- `npm run lint` — ESLint.
- `npm run eval` / `npm run eval:mock` / `npm run eval:bonus` — LLM assistant evals (`server/evals/run_evals.js`); use `--mock` if there's no local Ollama server running.
- `npm run test:eval` — Vitest-based eval harness (`vitest.eval.config.ts`).
- `npm run seed:eval` — seed the eval SQLite fixture (`tools/seed_eval_db.js`).

**Definition of done for code changes:** `npm run build`, `npm run test`, and `npm run lint` all pass. If you touched `server/assistant/`, also consider whether `server/evals/eval_cases.js` needs a new case and whether the change needs adversarial coverage (see `*Adversarial.test.js` files) — the HITL boundary is a security/safety boundary, not just a feature.

## Conventions worth internalizing
- **Two distinct lookup features, don't merge their mental models:** `Oracle.tsx` (`Alt+O`) is a static, offline JSON search. `AssistantOracleModal.tsx` (`Alt+A`) is the LLM-backed chat assistant. They are separate components with separate purposes.
- **State mutation from the assistant is always two-phase.** `stageProposal` (validate only) and `executeMutation` (atomic SQLite transaction, DM-approved only) are separate functions registered via `registerWriteTool` in `server/assistant/toolController.js`. Never collapse them.
- **Context profiles only subtract tools.** The Assistant is screen-aware (`server/assistant/contextProfiles.js`, `src/context/AssistantScreenContext.ts`, design in `docs/CONTEXT_AWARE_ASSISTANT.md`). A client `screen` string is allow-list validated (unknown -> `general`), is never interpolated into the prompt, and cannot add tools or affect `/confirm`. Every new tool must be assigned to a `TOOL_GROUPS` entry in `toolController.js` (a unit test enforces it), and every new screen needs an id in both `contextProfiles.js` and `src/utils/assistantScreens.ts`.
- **`DisclosureSelect` is the preferred control for any one-off dropdown or combo box with fewer than 15 options** (a choice that is not a field in a real data-entry form, e.g. a search type, view or sort choice). Don't use a native `<select>`, an ARIA combobox, a listbox or a menu for these, and don't build a new picker: reuse the component. Longer option lists, and real form fields, keep native controls. `DisclosureSelect` (`src/components/DisclosureSelect.tsx`) is one `<button aria-expanded>` whose visible text is "Label: Value" (one screen reader stop, no separate `<label>`, no `aria-haspopup`, no keydown handler: Enter, Space and click toggle it natively). Open, it shows a `<ul aria-label="Label">` rendered right after the button, whose options are `<button aria-pressed>`; focus moves to the pressed one, Up/Down wrap, Home/End, Tab works natively, choosing or Escape returns focus to the button, and focus or a click leaving the control closes it. While open, everything outside the control is `inert`, so a screen reader's browse-mode arrows stop at the last option instead of reading on into the page (browse-mode arrows never reach the page, so only focus-mode/keyboard arrows wrap); Tab out of the last option or Shift+Tab out of the button lifts the inert first. It must not use menu, menuitem*, listbox, option, combobox or radio roles, `aria-haspopup`, or timing tricks. Why: JAWS enters forms mode in a `role="menu"` and keeps it after the menu closes, so Up/Down after choosing couldn't read on (it also keeps forms mode on a button with `aria-haspopup`); plain buttons keep JAWS and NVDA in browse mode throughout. The Oracle's Search Type uses it. Drive it in Playwright with `tests/utils/disclosure-select-helper.ts`, and in the NVDA VM see `tools/nvda-vm/runner/tests/oracle-disclosure.nvda.spec.ts`.
  It is also used for: the Encounter Builder's per-unit phase, the Current Chapter picker (Create Mode) and Chapter picker (Run Mode), the Assistant's Current Model picker, and the "Filter by Type" asset filters (World Builder, Insert Asset Link, Link World Asset). It takes `disabled` and `emptyText` (shown, disabled, when there are no options). Native `<select>`s deliberately kept: real form fields (asset type in create/edit forms, campaign template, connection target), the map row/column pickers, and lists that can grow past 15 (Nearby Entities origin creature, Dice Log roller filter).
- **Oracle browse pages share one structure** (`src/components/OracleBrowserParts.tsx`, helpers in `src/utils/oracleBrowser.ts`). Every page (Monsters, Spells, Magic Items, World Assets, and any new one) is: a search landmark holding a text field labelled "Search <Kind>" (no placeholder) and a "Filters" button whose name says how many filters are active; an h3 "Results"; a status line "<n> <kind> found."; and a list with one button per result named "Name, detail, detail". Results are paged 100 at a time (`RESULTS_PAGE_SIZE`, built into `OracleResults`; never cap a list instead): with more than one page the heading reads "Results, page 2 of 5", "Previous page"/"Next page" buttons sit both above the list (after the count) and below it (only when there is a page to go to) and move focus to the heading, and a new search or filter returns to page 1. A result opens `OracleDialog` (heading focused, Tab loops from the heading, Escape/Close restore focus to the result); Filters opens `OracleFiltersDialog` (collapsed checkbox groups, "Source" last, then Apply Filters). Filters differ per page; the structure doesn't. Don't add region landmarks, extra headings, per-result secondary buttons, or "click to view" text. `tests/oracle-accessibility.spec.ts` checks the structure on every page.
- **Alt-modifier shortcuts only**, to avoid colliding with screen-reader navigation keys (JAWS/NVDA/VoiceOver own most other modifier combos).
- **New interactive UI needs a matching deterministic Playwright test** that seeds state via the API, asserts focus lands on the opening heading, runs an axe scan, and asserts focus restoration on close — follow the existing pattern rather than writing a new one.
- **Local-first LLM:** the assistant targets an OpenAI-compatible local endpoint (Ollama, `qwen3.5:9b`/`4b` by default) — see `server/assistant/config.js`, including an explicit VRAM budget guard that rejects large models. Don't assume a hosted API key is configured; use `--mock` eval modes when no local model server is available.
- Don't hand-edit `data/campaigns.sqlite3` or `public/data/*.json` — go through the Express API/`server/db.js` for the DB, and through the `tools/*.py` scrapers for the reference JSON.

## Style preferences carried over from GEMINI.md
These are project-wide standards (not a Claude-specific interpretation of them):
- Semantic HTML over `div` + click handler; buttons for actions, headings for structure, lists for data.
- Manual focus trap/restore via `useRef` in every modal; heading receives focus on open, trigger element regains it on close.
- ARIA live regions (`polite`/`assertive` as appropriate) for turn changes, dice results, and HITL proposal lifecycle events.
- Monster HP/initiative are rolled at Run time, not Create time.
