# AgentDeck Mobile

React Native (Expo) mobile app for [AgentDeck](https://github.com/jason0960/vscode_ide_mobile_plug) — control GitHub Copilot Chat from your phone.

**Available on TestFlight** — iOS native app (version 0.3.0).

## Features

- **Chat** — Stream AI responses from GitHub Copilot in real-time
- **Agent Mode** — Run Copilot agent tasks from your phone
- **File Browser** — Browse workspace files remotely
- **Git Changes** — View diffs and modified files
- **Diagnostics** — See errors and warnings
- **Terminal** — Send commands to VS Code terminal
- **Quick Commands** — One-tap actions (build, test, lint, etc.)
- **Leave Room** — Disconnect and return to the connect screen
- **End-to-end encryption** — X25519 ECDH key exchange + XSalsa20-Poly1305 via tweetnacl
- **Error boundary** — Global crash recovery with retry UI

## How it works

The app connects to the AgentDeck VS Code extension using a 6-character pairing code. Transport is selected automatically — no configuration needed.

```
┌──────────────┐                  ┌───────────────┐                  ┌──────────────┐
│  Mobile App  │ ◄──────────────► │  Cloud Relay  │ ◄──────────────► │  VS Code Ext │
│  (this app)  │   6-char code    │               │   auto-paired    │  (AgentDeck) │
└──────────────┘                  └───────────────┘                  └──────────────┘
```

1. Open VS Code with AgentDeck installed — a 6-character room code appears automatically
2. Enter the code in the mobile app (or scan the QR code)
3. Messages flow bidirectionally with end-to-end encryption

## Install

### TestFlight (iOS)

The production iOS app is available on TestFlight. Contact the repo owner for a TestFlight invite.

### Development

```bash
npm install
npx expo start          # Dev server (scan QR with Expo Go)
npx expo start --web    # Browser preview
```

## Build

```bash
# iOS
eas build --profile preview --platform ios

# Production
eas build --profile production --platform all
```

## Project structure

```
src/
├── api/
│   ├── connection.ts       — WebSocket manager (direct + relay modes)
│   ├── pubsub.ts           — Cloud transport (publish, pull, Avro encoding)
│   ├── e2e-crypto.ts       — X25519 + XSalsa20-Poly1305 end-to-end encryption
│   └── rpc.ts              — JSON-RPC client with E2E encryption layer
├── components/
│   ├── CommandCenterDrawer.tsx — Drawer with Leave Room button
│   ├── ErrorBoundary.tsx   — Global crash recovery with retry UI
│   ├── InlineDiffPanel.tsx — Inline diff viewer
│   └── SyntaxHighlighter.tsx
├── screens/
│   ├── ChatScreen.tsx      — Streaming Copilot chat
│   ├── ConnectScreen.tsx   — Unified code entry (auto-detect transport)
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

## Testing

```bash
npm test             # 160 tests
```

## License

MIT
