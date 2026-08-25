# DevAssist UI

DevAssist UI is a local triage assistant that runs two services:
1. Bridge API on port `7447`
2. SPA UI on port `5173`

## End-User Quick Start (Windows)

### Easiest way
1. Double-click `start.bat` from the repo root.
2. Wait for startup to finish.
3. Open `http://localhost:5173/triage`.

`start.bat` automatically:
- verifies `npm` is installed,
- runs `npm install` on first run,
- starts the bridge and UI together.

## Manual Start (Developer)

From repo root:

```powershell
npm install
npm run dev
```

Then open:

```text
http://localhost:5173/triage
```

## Bridge-Only Start (Auto Build)

If you want to run the compiled bridge that serves the built SPA:

```powershell
npm run bridge
```

This command now auto-builds both:
- `packages/spa` (`dist` assets)
- `packages/bridge` (`dist` runtime)

## Requirements

- Node.js LTS (includes npm)

## Stop the App

Press `Ctrl+C` in the terminal running `npm run dev`.
