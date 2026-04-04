# AgentDeck Mobile

React Native (Expo) mobile app for [AgentDeck](https://github.com/jason0960/vscode_ide_mobile_plug) — control GitHub Copilot Chat from your phone via **Google Cloud Pub/Sub** or WebSocket relay.

**Available on TestFlight** — iOS native app (version 0.2.1).

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
- **Dual Transport** — Connects via GCP Pub/Sub (preferred) or WebSocket relay (fallback)

## How it works

The app supports two transport modes. Both use the same 6-character room/pairing code UX.

### Pub/Sub Mode (preferred)

```
┌──────────────┐  GET /pair/:code  ┌───────────────┐  POST /pair  ┌──────────────┐
│  Mobile App  │ ────────────────► │ Relay Server  │ ◄─────────── │  VS Code Ext │
│  (this app)  │                  │ (pairing only)│              │  (GoPilot)   │
└──────┬───────┘                  └───────────────┘              └──────┬───────┘
       │                                                             │
       │               ┌─────────────────┐                             │
       └──────────────►│  GCP Pub/Sub   │◄────────────────────────────┘
                        └─────────────────┘
```

1. Enter the 6-char pairing code on the Relay tab
2. App tries `GET /pair/:code` first — if found, it’s a Pub/Sub pairing
3. App receives GCP Pub/Sub credentials (project, topic, subscriptions, access token)
4. App connects directly to Pub/Sub — relay is no longer involved
5. Extension pushes `token_refresh` messages every 45 min to keep credentials fresh

### WebSocket Relay Mode (fallback)

```
┌──────────────┐     WebSocket     ┌─────────────────┐     WebSocket     ┌──────────────┐
│  Mobile App  │ ──────────────→  │  Relay Server   │ ──────────────→  │  VS Code Ext │
│  (this app)  │ ◄──────────────  │  (gopilot.dev)  │ ◄──────────────  │  (GoPilot)   │
└──────────────┘                   └─────────────────┘                   └──────────────┘
```

If `GET /pair/:code` returns 404, the app falls back to WebSocket relay mode:
1. Connects to `/relay/join?code=XXXX` → joins the room
2. All messages forwarded bidirectionally through the relay in real-time

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
│   ├── pubsub.ts           — GCP Pub/Sub transport (publish, pull, Avro encoding)
│   ├── e2e-crypto.ts       — X25519 + XSalsa20-Poly1305 end-to-end encryption
│   └── rpc.ts              — JSON-RPC client with E2E encryption layer
├── components/
│   ├── CommandCenterDrawer.tsx — Drawer with Leave Room button
│   ├── ErrorBoundary.tsx   — Global crash recovery with retry UI
│   ├── InlineDiffPanel.tsx — Inline diff viewer
│   └── SyntaxHighlighter.tsx
├── screens/
│   ├── ChatScreen.tsx      — Streaming Copilot chat
│   ├── ConnectScreen.tsx   — Unified code entry (Pub/Sub or relay auto-detect)
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
| `EXPO_PUBLIC_RELAY_URL` | `wss://gopilot-relay.onrender.com` | Relay server URL (for WebSocket relay + pairing exchange) |

## Testing

```bash
npm test             # 135 tests
```

## License

MIT
