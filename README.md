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
4. Enable strict managed mode so users never fall back to localhost bridge

Example build configuration:

```powershell
$env:VITE_BRIDGE_URL = "https://devassist-bridge.company.net"
$env:VITE_STRICT_MANAGED = "1"
npm run build --workspace=packages/spa
```

### Managed Bridge Deployment

Run the bridge on a central Windows host (service VM) so all users share one runtime.

Example environment variables:

```powershell
$env:BRIDGE_HOST = "0.0.0.0"
$env:BRIDGE_PORT = "7447"
$env:BRIDGE_OPEN_BROWSER = "0"
$env:SPA_ORIGIN = "https://jatinkumar-patel.github.io"
$env:PAGES_URL = "https://jatinkumar-patel.github.io/devassist-ui/"
$env:CORS_ORIGINS = "https://jatinkumar-patel.github.io,https://your-static-site.company.net"
node packages/bridge/dist/index.js --no-open
```

Recommended operations model:
1. Build and deploy bridge from CI/CD to one managed environment.
2. Build and publish SPA static assets with `VITE_BRIDGE_URL` pointing to that environment.
3. End users open only the static site URL. No local bridge install/updates on user VMs.

Behavior:
1. SPA uses `VITE_BRIDGE_URL` when provided
2. If `VITE_STRICT_MANAGED=1`, SPA does not fall back to localhost bridge
3. If strict managed mode is not enabled, SPA can still fall back to `http://localhost:7447`
4. Triage page shows a clear bridge-unreachable banner when the bridge cannot be reached

## End-User One-Time Setup (No Daily Commands)

For local-bridge environments, use a one-time setup and avoid sharing terminal commands with users every day.

Run once:

```text
setup-end-user.bat
```

This one-time setup does three things:
1. Creates a Startup entry that launches the local bridge at Windows login
2. Creates a desktop shortcut named `DevAssist`
3. Starts DevAssist immediately

Daily use for end users:
1. Click the `DevAssist` desktop shortcut

No daily terminal commands are required after setup.

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
