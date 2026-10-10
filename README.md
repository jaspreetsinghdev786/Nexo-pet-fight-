# Nexo — 3D desktop pet for Windows

An offline, animated 3D robot that lives on your desktop. Built with Electron, React, TypeScript, Vite, Tailwind, Zustand and Three.js. It has no network calls, no accounts and no AI.

## Run

```bash
npm install
npm run dev      # Vite + Electron with hot reload
npm start        # production build, run locally
npm run dist     # Windows installer -> release/Nexo Setup x.y.z.exe
```

## Using Nexo

- **Click:** happy / wave / spin. **Double-click:** jump.
- **Drag:** carry it. It dangles, then falls to the taskbar when gravity is on.
- **Right-click** or use the **tray icon:** actions, pause, walk around, always on top, size, start with Windows, settings, reset position, quit.
- **Roaming the whole screen:** Nexo walks the bottom edge and climbs either side. It can round a top corner and walk upside down along the top edge, then climb down the far side or drop through the middle. It also abseils on a cyan rope, floats up to the middle of the screen, and sometimes turns around through its back. Turn climbing off with *Climb screen edges*.
- More activities: stretch (with a yawn), jumping jacks, and thinking (hand on chin, "…" bubble).
- Nexo idles, blinks and looks around on its own. It walks every 20–45 s, dances every 60–180 s, and now and then jumps, waves, spins or sits. The activity level scales these timings.
- It falls asleep when the PC has been idle (default 3 min) and wakes up when you come back.

## How it is built

| File | Role |
| --- | --- |
| `electron/main.ts` | Transparent click-through pet window, tray, settings window, multi-monitor clamping, saved position |
| `src/renderer/pet/model.ts` | Procedural 3D Nexo modelled on `assets/nexo-reference.png` |
| `src/renderer/pet/cloud.ts` | Cloud head as one smooth SDF-sculpted mesh |
| `src/renderer/pet/faceTexture.ts` | Curved face screen with live expressions |
| `src/renderer/pet/limbs.ts` | Joint angles per state, eased for smooth transitions |
| `src/renderer/pet/poses.ts` | Whole-body hop, lean, squash and stretch |
| `src/renderer/pet/brain.ts` | State machine: autonomous activities, walking, gravity, drag, sleep |

Settings are stored in `%APPDATA%/nexo-pet/settings.json`.

Dev aid: `NEXO_SNAPSHOT_DIR=<dir> electron .` plays every animation and saves PNG captures.
