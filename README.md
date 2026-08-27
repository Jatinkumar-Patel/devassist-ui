# DevAssist UI

DevAssist UI supports two deployment modes:
1. Static end-user app with a managed bridge server (recommended for enterprise rollout)
2. Local developer mode with local bridge + local SPA

## Enterprise End-User Mode (Static First)

End users should only open the static app URL and should not need to run local commands.

Requirements:
1. Host SPA static assets (GitHub Pages or internal static host)
2. Host a managed bridge API service in your network
3. Configure `VITE_BRIDGE_URL` at build time to the managed bridge URL

Example build configuration:

```powershell
$env:VITE_BRIDGE_URL = "https://devassist-bridge.company.net"
npm run build --workspace=packages/spa
```

Behavior:
1. SPA uses `VITE_BRIDGE_URL` when provided
2. If missing, SPA falls back to `http://localhost:7447`
3. Triage page shows a clear bridge-unreachable banner when the bridge cannot be reached

## Local Developer Mode

From repo root:

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:5173/triage
```

## Bridge-Only Start (Auto Build)

To run the compiled bridge that serves built SPA assets:

```powershell
npm run bridge
```

This command auto-builds:
1. `packages/spa` (`dist` assets)
2. `packages/bridge` (`dist` runtime)

## Requirements

1. Node.js LTS (includes npm)

## Stop the App

Press `Ctrl+C` in the terminal running `npm run dev` or `npm run bridge`.
