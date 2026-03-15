# GoPilot Mobile

React Native (Expo) mobile app for [GoPilot](https://github.com/jason0960/vscode_ide_mobile_plug) — control GitHub Copilot Chat from your phone.

## Features

- **Chat** — Stream AI responses from GitHub Copilot in real-time
- **Agent Mode** — Run Copilot agent tasks from your phone
- **File Browser** — Browse workspace files remotely
- **Git Changes** — View diffs and modified files
- **Diagnostics** — See errors and warnings
- **Terminal** — Send commands to VS Code terminal
- **Quick Commands** — One-tap actions (build, test, lint, etc.)

## How it works

```
┌──────────────┐     WebSocket     ┌─────────────────┐     WebSocket     ┌────────────────┐
│  Mobile App  │ ───────────────→  │  Relay Server   │ ───────────────→  │  VS Code Ext   │
│  (this app)  │ ←───────────────  │  (gopilot.dev)  │ ←───────────────  │  (GoPilot)     │
└──────────────┘                   └─────────────────┘                   └────────────────┘
```

1. Install the GoPilot VS Code extension — it auto-connects and shows a 6-char room code
2. Open this app and enter the room code
3. Start chatting with Copilot from your phone

## Quick start

```bash
npm install
npx expo start          # Dev server (scan QR with Expo Go)
npx expo start --web    # Browser preview
```

## Build

```bash
# iOS
eas build --profile preview --platform ios

# Android
eas build --profile preview --platform android

# Production
eas build --profile production --platform all
```

## Project structure

```
src/
├── api/
│   ├── connection.ts       — WebSocket manager (direct + relay modes)
│   └── rpc.ts              — JSON-RPC client
├── components/
│   ├── CommandCenterDrawer.tsx
│   └── SyntaxHighlighter.tsx
├── screens/
│   ├── ChatScreen.tsx      — Streaming Copilot chat
│   ├── ConnectScreen.tsx   — QR/relay/direct pairing
│   ├── ChangesScreen.tsx   — Git diff viewer
│   ├── FilesScreen.tsx     — Workspace file browser
│   └── ...
├── store/
│   └── AppStore.ts         — Zustand global state
└── theme/
    └── index.ts            — Dark/light theme
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EXPO_PUBLIC_RELAY_URL` | `wss://gopilot-relay.onrender.com` | Relay server URL |

## License

MIT
