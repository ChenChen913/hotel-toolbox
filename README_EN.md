<h1 align="center">Hotel Stay Toolbox</h1>

<p align="center">
  <b>English</b> | <a href="./README.md">简体中文</a>
  <br><br>
  <a href="https://github.com/ChenChen913/hotel-toolbox/actions/workflows/deploy.yml"><img src="https://github.com/ChenChen913/hotel-toolbox/actions/workflows/deploy.yml/badge.svg" alt="Deploy"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

Rule-driven hotel stay toolbox: packing list, room & checkout checks, evidence-graded knowledge. No backend.

Use it online:
- GitHub Pages (primary): <https://chenchen913.github.io/hotel-toolbox/>
- Cloudflare Pages (mirror): <https://hotel-toolbox.pages.dev/>

> These are different origins, so local data is not shared; export a backup on the old site and import it on the new one.

## Table of Contents

- [Why this project](#why-this-project)
- [Getting started](#getting-started)
- [Usage](#usage)
- [Configuration](#configuration)
- [Project structure](#project-structure)
- [Development](#development)
- [FAQ](#faq)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)

## Why this project

The project started as a personal note on hotel precautions and was redefined during product design as a toolbox built around a single stay: the core object is not an article but one concrete hotel stay, with lists, checks and knowledge organized around it.

Three design decisions, each archived in the repository:

- Fixed rules instead of AI. Every question must be able to answer "what does this answer change", otherwise it is not asked (see `聊天记录/聊03.txt`)
- The list distinguishes "number of users" from "quantity to prepare"; consumables are calculated as "guests × (nights + 1)" (see `docs/规则表.md`)
- Every knowledge entry carries an evidence level and source; pseudo-detection methods that create false safety are excluded (conclusions come from the three fact-check documents in the repo)

## Getting started

Requirements: Node.js (the repo CI builds and tests on Node 22), npm.

```sh
git clone https://github.com/ChenChen913/hotel-toolbox.git
cd hotel-toolbox
npm install
npm run dev
```

Open <http://localhost:5173/hotel-toolbox/>.

## Usage

The main flow:

1. Click "创建一次入住" on the home page and walk the 7-step wizard (it collapses to 5 steps when "pack for others" is off): gender, dates and nights, guests, companions and relationship, scenario with weather/temperature, preferences, confirm
2. The app generates the list from 56 item rules; quantities are derived from guests and nights. On the last step you can change quantities, drop an item to 0 (it moves to "not bringing", restorable anytime), or append custom items, clothing and cosmetics
3. The stay page has three stages: prep (tick items, assign them to a guest, attach gear), check-in (15 items in 5 groups, including fire observations and emergency supplies) and checkout (14 items in 6 groups plus 2 deposit/bill checks)
4. The knowledge section holds 44 entries in 11 modules with evidence levels, risk levels and sources, an evidence/risk legend, one-tap copy for emergency phrasing, and an emergency entry on the stay page
5. The gear page collects item + brand pairs by category; the category is guessed from the item name (18 categories, 412 keywords) until you pick one manually
6. The "Mine" page handles backup export/import (JSON file), disclaimer, privacy notes and clearing local data

Stays are stored in the browser. The home page can duplicate the last stay as a template (relationship and weather are carried over).

## Configuration

| Environment variable | Required | Default | Notes |
|---------------------|----------|---------|-------|
| `BASE_PATH` | No | `/hotel-toolbox/` | Deploy path. Keep the default for GitHub Pages project sites; Cloudflare Pages uses `/` (`npm run build:cf` sets it) |

Data is stored in browser `localStorage` and never uploaded. Keys: `htb_stays_v1` (stays), `htb_gear_v5` (gear, plus v4/v3 migration sources), `htb_ext_v1` (relationship / weather / temperature extensions), `htb_ui_collapsed_v2` (collapsed groups), `htb_stays_v1_corrupt` / `htb_gear_corrupt` (quarantined corrupt payloads).

## Project structure

```
src/
├── data.ts             # 56 item rules, fixed checklists (15 check-in / 14 checkout), 44 knowledge entries
├── types.ts            # Domain types (byte-identical with the mini-program codebase)
├── engine.ts           # Rule evaluation, stay storage, gear collection
├── extra.ts            # Extension layer: relationship, weather/temperature, purpose, extra items, deposit
├── repair.ts           # Read repair and backup sanitising
├── rich.ts             # Paragraph / bold parsing for knowledge bodies (no v-html)
├── platform.ts         # Browser storage adapter (localStorage + read repair + write-failure toast)
├── store.ts            # View state, date formatting, stage inference
├── ui.ts / toast.ts    # Global toast and its copy/duration contract
├── styles/
│   ├── global.css      # Design tokens and utilities (cool grey + navy + amber)
│   └── icons.css       # 49 self-drawn base64 icons (no icon library)
├── components/         # AppIcon, Stepper, Toggle, ItemRow, DatePicker, ClothingAdd,
│                       # GearPanel, ProgressPill, AppModal, AppToast, TabBar
└── views/              # Six pages: Home / Wizard / Stay / Knowledge / Gear / Mine
tests/
├── engine.test.ts      # 38 upstream cases (unchanged)
├── parity.test.ts      # 23 cases mirroring the mini-program extension/repair suites
└── platform.test.ts    # 6 cases for the storage adapter
docs/
└── 规则表.md            # Rule design document
```

## Development

Stack: Vite, Vue 3, TypeScript, Vitest; icons are self-drawn SVG (base64, no icon library); installable and offline-capable via vite-plugin-pwa.

```sh
npm test          # Run tests (67 cases)
npm run build     # Type check + production build (GitHub Pages base)
npm run build:cf  # Production build with base "/" for Cloudflare Pages
npm run deploy:cf # Deploy dist/ to Cloudflare Pages via wrangler
npm run preview   # Preview the production build locally
```

On every push to main, GitHub Actions runs the tests, builds the app and deploys it to GitHub Pages (see `.github/workflows/deploy.yml`). An optional Cloudflare Pages workflow (`.github/workflows/deploy-cloudflare.yml`) runs in parallel and is skipped when `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` are not configured.

> Switching domains (GitHub Pages ↔ Cloudflare Pages) changes the origin, so `localStorage` is not shared: export a backup on the old site and import it on the new one.

## FAQ

**Q: Are my stays still there after switching devices or clearing browser data?**
A: No. Stays live only in this browser. The "duplicate last stay" action in the app can rebuild a list quickly.

**Q: Why is something I want to bring not on the list?**
A: The app only recommends items it can infer by rules. Profession- or hobby-related items (camera, medication, pet supplies) go through "add my own must-bring item"; the app shows hints after generating the list.

**Q: Why not use AI to generate the list?**
A: The design settles on fixed rules: they are explainable, testable and work offline. An AI entry point is left for future extensions.

## Known limitations

- Stay data lives in browser localStorage: clearing browser data deletes it. Use the backup card on the "Mine" page to export a JSON file and import it back
- Weather and temperature are not fetched: you pick them in the wizard (no network); leaving them unset simply skips those rules
- Quantities are suggestions (guests × (nights + 1) etc.), adjustable per item; items like wipes cannot be derived from headcount, adjust manually
- V1.2 roadmap (from external review): full purchase-status loop (to buy / bought / already at home), independent age per child (full Guest model), desktop two-column layout

## Contributing

This is a personal project. Questions and suggestions are welcome through [Issues](https://github.com/ChenChen913/hotel-toolbox/issues); please open an Issue before sending a PR.

## License

[MIT](LICENSE) © 2026 ChenChen913
