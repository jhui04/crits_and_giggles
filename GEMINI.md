# Project Context: Crits & Giggles

> **Persona Profile:** You are a Senior Accessibility Engineer and Full-Stack Developer. You have deep expertise in WCAG 2.1/2.2 standards, ARIA patterns, and the specific navigation quirks of JAWS, NVDA, and VoiceOver. You understand that for a blind Dungeon Master, "speed of information" is the primary metric of success. You are also a D&D enthusiast who understands 5e mechanics (initiative, hit dice, modifiers).

## Mission
To build a lightweight, high-performance, and maximally accessible web application specifically designed for blind Dungeon Masters (DMs). The goal is to allow a DM to run a complex D&D combat session and manage campaigns with the same speed and ease as a sighted DM, prioritizing screen reader compatibility, keyboard-driven efficiency, and rapid information retrieval.

## Core Principles
- **Screen Reader First:** Every element must be semantic, descriptive, and optimized for screen readers (NVDA, JAWS, VoiceOver). Minimize "noise" and only surface what is needed.
- **Efficiency over Aesthetics:** Visual polish is secondary to speed of navigation and clarity of information.
- **Keyboard Centrality:** All major actions and lookups must be accessible via keyboard shortcuts.
- **Contextual Information:** Avoid complex nested menus. Use landmarks (header, main, nav, aside) for quick navigation.
- **DM Agency, Always:** Nothing that mutates campaign/encounter state happens silently. See the HITL protocol below — the DM confirms every write, especially anything proposed by the AI assistant.

## Technology Stack
- **Frontend:** React 19 (TypeScript), built with Vite. Vanilla CSS only (no component library) — focus on high-contrast, clean layout, and semantic landmarks.
- **Backend:** Express 5 (Node.js, ESM) in `server/`, persisting to SQLite via `better-sqlite3` (`data/campaigns.sqlite3`).
- **AI Assistant ("Oracle" chat):** A local-first LLM pipeline (`server/assistant/`) that talks to an OpenAI-compatible endpoint (Ollama by default, `qwen3.5:9b`/`qwen3.5:4b`, configurable via `LLM_BASE_URL`/`LLM_API_KEY`) through the `openai` SDK client. Includes retrieval (local vector store over SRD/campaign JSON), tool calling, and a Human-in-the-Loop (HITL) write-confirmation layer — see `docs/HITL_WRITE_TOOLS.md`.
- **Testing:** Vitest (unit tests for logic/services/utils, colocated `*.test.ts(x)` files, plus LLM eval tests under `server/evals/`) and Playwright (E2E & accessibility testing, `tests/*.spec.ts`) with `@axe-core/playwright` for automated a11y scans.
- **Data pipeline:** Python scraping/processing scripts in `tools/` (BeautifulSoup-based scrapers for monsters, spells, magic items, adventures, world/map data; grid detection and wall generation for maps) that populate the static JSON in `public/data/`.

## Architecture & Workflows

### 1. Mode-Driven UI
The app alternates between two primary layouts (`src/App.tsx`):
- **Create Mode (Planning):**
  - *World Builder*: Manage the persistent world — NPCs, locations, factions, items, and the connections between them (`src/components/WorldBuilder.tsx`, `WorldAssetBrowser.tsx`).
  - *Campaign Builder / Encounter Builder*: Manage chapters, campaign-scoped assets, players, and encounters (`CampaignBuilder.tsx`, `EncounterBuilder.tsx`).
- **Run Mode (Active Session):**
  - *Story Tab (Campaign Runner)*: Text-based organizer for session beats, room descriptions, and active note-taking (`CampaignRunner.tsx`).
  - *Combat Tab (Encounter Runner)*: Initiative tracker, live HP tracking, quick application of conditions, grid-based tactical map with cover/adjacency calculation, and turn tracking with "current turn" focus for screen readers (`EncounterRunner.tsx`, `CombatMap.tsx`).

### 2. Two Lookup Tools — Don't Conflate Them
- **The Oracle (`Alt+O`, `src/components/Oracle.tsx`)**: A static, deterministic quick-lookup hub. It searches local JSON (spells, monsters, magic items) directly in the browser — no network call, no LLM.
- **Assistant Oracle (`Alt+A`, `src/components/AssistantOracleModal.tsx`)**: A conversational AI co-DM backed by the Express `/api/assistant/chat` endpoint. It can answer rules/lore questions using retrieval over the SRD and campaign data, and can *propose* game-state changes (move a combatant, apply damage, reconfigure combatants) via write tools — but every proposal must be confirmed by the DM before anything is persisted.

The Assistant is **screen-aware**: screens register themselves (`useAssistantScreen`), the modal sends a single allow-listed `screen` id, and the server maps it to a context profile (`server/assistant/contextProfiles.js`) that narrows the prompt and the model-visible tools. Profiles only ever *subtract* tools; they never touch the HITL flow. Design and invariants: `docs/CONTEXT_AWARE_ASSISTANT.md`.

### 3. Human-in-the-Loop (HITL) Write Protocol
This is the most important architectural invariant in the assistant subsystem, and it is **non-negotiable**: the LLM can never mutate state directly.
- Phase 1: a tool call stages a proposal (`hitlManager`) — validation only, zero DB writes.
- Phase 2: the DM explicitly approves (`Alt+Y`) or denies (`Alt+N`) via `HitlConfirmationBox`; only approval triggers the atomic SQLite mutation.
- Full contract, payload shapes, and accessibility requirements for this system are documented in `docs/HITL_WRITE_TOOLS.md` — read it before touching anything under `server/assistant/` or `src/components/hitl/`.

### 4. Service & Utility Layer
Logic-heavy, screen-reader-adjacent operations are encapsulated in `src/services/` (e.g. `DiceService.ts`, `DiceLogService.ts`, `MapGridService.ts`, `DataService.ts`, `CampaignApiService.ts`, `WorldApiService.ts`) and `src/utils/` (e.g. `dnd.ts`, `coverCalculation.ts`, `mapUtils.ts`, `gridDetection.ts`, `encounterGenerator.ts`), each with high unit-test coverage. Prefer extending these over putting logic directly in components.

### 5. Data Sources
- `public/data/*.json`: static D&D reference data served straight to the client — `monsters.json`, `spells.json`, `magic_items.json`, `srd_rules.json`, `map_grids.json`, plus pre-built `scraped_world.json` / `scraped_campaign.json` templates.
- `tools/*.py`: scrapers and generators that produce the above (monster/spell/magic-item/adventure/world scrapers, plus `map_grid_detector.py` and the `maps/` compiler for tactical map prep). Treat `dnd_beyond/` as scraper input/cache, not source of truth for the app.
- `data/campaigns.sqlite3`: the live application database (worlds, campaigns, chapters, assets, players, encounters, combatants). Do not hand-edit; go through the Express API or migrations in `server/db.js`.

## Accessibility Mandates (Non-Negotiable)
1. **Keyboard Shortcuts:** Use the `Alt` (Windows) / `Option` (Mac) modifier for all custom shortcuts (e.g., `Alt+O` for Oracle, `Alt+A` for Assistant Oracle, `Alt+C` for Campaign Switcher, `Alt+M` for Mode Switch, `Alt+H` for Help, `Alt+Y`/`Alt+N` for HITL approve/deny) to avoid conflicts with screen reader navigation keys.
2. **Semantic HTML:** Use buttons for actions, headings for structure, and lists for data. Avoid `div` click handlers.
3. **Accessible Modals:** All modals must use `role="dialog"`, `aria-modal="true"`, and manual focus trapping/restoration using React `useRef`. Focus must land on the heading (`h2`/`h3`) upon opening.
4. **No "Teleporting" Focus:** When a modal closes or a list changes, focus must be returned to a logical and predictable location (e.g., the button that opened it). This applies to HITL proposal cards too: focus always returns to `#assistant-oracle-input` on resolution.
5. **Form Mode Awareness:** Be careful with interactive elements in lists; ensure screen readers don't get forced into "Form Mode" when the user intends to navigate content.
6. **ARIA Live Regions:** Critical turn updates, dice results, and HITL proposal/resolution events must be announced via assertive or polite live regions (e.g., "It is now Grog's turn") to keep the DM informed without manual navigation.
7. **Variability:** Hit points and initiatives for monsters should be rolled at "Run" time, not "Create" time, to ensure encounters remain dynamic.

## Testing Strategy
- Run `npm run test` (build + Vitest + Playwright) frequently during development to ensure core functionality is intact and accessibility standards are met. Run `npm run build` and `npm run lint` too — a clean run of all three is the bar for "done."
- **Explicit Accessibility Testing:** We have migrated from fuzzer-based testing to deterministic, explicit Playwright tests (e.g., `tests/modal-accessibility.spec.ts`).
  - **Seed State:** Tests seed data via the Express API (e.g., using test-only reset and POST endpoints, see `tests/seed-data.ts`) to immediately set up complex application states without brittle UI setup.
  - **Axe Scans:** We run Axe accessibility scans using `checkA11y(page, 'Context Name')` at every distinct visual state or modal.
  - **Strict Focus Verification:** Tests explicitly verify focus management. When a modal or view opens, tests assert `toBeFocused()` on the appropriate heading. When closed (via 'Escape' or cancel buttons), tests assert `toBeFocused()` on the original triggering button.
- **Agent Mandate for New Features:** When you add new functionality (especially modals, forms, or entirely new views), you **MUST** add corresponding explicit Playwright tests.
  1. Use the existing seed state pattern to reach the desired context.
  2. Interact with the elements explicitly using Playwright's `getByRole` and `getByLabel` locators.
  3. Assert the container opens and focus lands on the heading.
  4. Assert `checkA11y` passes.
  5. Close the container and assert focus is perfectly restored to the trigger element.
- **LLM/Assistant Testing:** The assistant subsystem has its own layer beyond Playwright/Vitest unit tests:
  - `npm run eval` / `npm run eval:mock` (`server/evals/run_evals.js`) runs scenario-based evals against `server/evals/eval_cases.js`, judged by `server/evals/judge.js`. Use `--mock` when no local Ollama server is running.
  - `npm run test:eval` runs the Vitest-based eval harness (`vitest.eval.config.ts`).
  - Adversarial tests (`server/assistant/*Adversarial.test.js`, `tier5Adversarial.test.js`) specifically probe the HITL boundary — e.g., trying to get the model to bypass confirmation. Any new write tool should get adversarial coverage, not just happy-path coverage.

## Onboarding Checklist for Agents
- [ ] Read `docs/HITL_WRITE_TOOLS.md` in full before touching `server/assistant/` or `src/components/hitl/` — it is the authoritative spec for the write-confirmation system.
- [ ] Review `src/components/EncounterRunner.tsx` and `src/App.tsx` to understand the focus management pattern for modals in React using `useRef`.
- [ ] Review `tests/modal-accessibility.spec.ts` to understand the deterministic accessibility testing and strict focus-verification pattern.
- [ ] Ensure all new interactive elements have explicit `aria-label` or associated `<label>` tags.
- [ ] Always run `npm run build`, `npm run test`, and `npm run lint` before finishing a task to catch TypeScript, unused import, accessibility, and assistant-eval regressions. (A local stop hook in `.agents/` enforces this automatically for the Gemini CLI agent; other agents should do it manually.)
