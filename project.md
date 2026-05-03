# Project: Blind-Accessible DM Web App (Project Name TBD)

## Mission
To provide a lightweight, high-performance web application specifically designed for blind Dungeon Masters (DMs) running Dungeons & Dragons (D&D) games. The application prioritizes maximum screen reader compatibility, keyboard-driven efficiency, and rapid information retrieval to enable a seamless gaming experience.

## Core Principles
- **Screen Reader First:** Every element must be semantic, descriptive, and optimized for screen readers (NVDA, JAWS, VoiceOver).
- **Efficiency over Aesthetics:** Visual polish is secondary to speed of navigation and clarity of information.
- **Keyboard Centrality:** All major actions and lookups should be accessible via keyboard shortcuts.
- **Contextual Information:** Surfaces only what is needed, reducing "noise" for screen reader users.

## DM Workflow & Functional Elements

### 1. Pre-Session Planning
- **Encounter Builder:** Select monsters from JSON data and organize them into encounters.
- **NPC Management:** Create and store persistent NPCs with notes and basic stats.
- **Adventure Outlining:** A text-based organizer for session beats, room descriptions, and plot points.

### 2. During-Session Management
- **Initiative Tracker:** 
    - Quick addition of players and monsters.
    - Automated sorting.
    - Turn tracking with "current turn" focus for screen readers.
- **Combat Hub:**
    - Live HP tracking for monsters.
    - Quick application of conditions (Blinded, Prone, etc.) with automatic rule reminders.
    - Instant access to monster stat blocks.
- **Quick Lookup (The "Oracle"):**
    - A global search bar to instantly pull up spell descriptions, monster stats, or magic item properties from local JSON sources.
- **Active Note-Taking:**
    - A persistent "Scratchpad" for tracking improvised details (NPC names, player choices) that can be saved to a session log.

## Data Sources (JSON)
The application will leverage static JSON files for standard D&D reference material:
- `monsters.json`: Stat blocks, abilities, and actions.
- `spells.json`: Descriptions, components, casting times, and levels.
- `items.json`: Magic items and mundane equipment.
- `rules.json`: Common rule lookups (conditions, combat actions, environmental effects).

## Technical Requirements
- **Framework:** React (TypeScript) for a responsive, single-page application feel.
- **Persistence:** LocalStorage or a local file-based system (e.g., IndexedDB) for saving session state and notes. This ensures the app remains lightweight and "offline-first."
- **Accessibility Standards:** WCAG 2.1 AA/AAA compliance.

## High-Level Design Goals
- Avoid complex nested menus.
- Use landmarks (header, main, nav, aside) for quick navigation.
- Implement "Announce" regions for dynamic updates (e.g., "It is now Grog's turn").
- Minimize page reloads to maintain screen reader focus.
