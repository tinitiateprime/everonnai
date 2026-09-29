# EverOnn.Ai

EverOnn combines the recreated public marketing site with the reusable customer-response product foundations migrated from AgenticThat.

## Run locally

```bash
npm install
npm run dev
```

Open:

- Marketing site: `http://localhost:3000`
- Product dashboard: `http://localhost:3000/dashboard`
- Login and MFA demo: `http://localhost:3000/login`
- Private website preview: `http://localhost:3000/preview/demo`

The product persists its workspace in `data/everonn.json`. Dashboard edits, leads, calls, appointments, team settings, and Website Studio progress are saved through the server JSON API. Use **Settings → Reset demo** to restore the original data.

## Quality commands

```bash
npm run lint
npm test
npm run build
```

With the production server running on port 3000:

```bash
npm run smoke
```

The smoke test covers the dashboard, urgent phone handling, lead persistence, Website Studio lifecycle, mobile navigation, login, and MFA.

## JSON persistence and optional services

No database is required. The default JSON file is committed at `data/everonn.json`; set `EVERONN_DATA_FILE` to an absolute path if you want the writable file stored elsewhere. Writes are validated, serialized, and replaced atomically to protect the workspace from partial saves.

Copy `.env.example` to `.env.local` and add only the providers you intend to enable. Website generation, QA, browser voice, typed phone demo, inbox, preview workflow, JSON persistence, and RBAC demonstrations work without external secrets.

The provider variable names intentionally match AgenticThat. Existing `GEMINI_API_KEY`/`GOOGLE_API_KEY`, Gemini model and timeout settings, `PEXELS_API_KEY`, ElevenLabs, Google OAuth, encryption, and Resend credentials can therefore be reused unchanged. EverOnn never copies those values into the browser or `data/everonn.json`.

When Gemini is configured, Website Studio requests schema-constrained content, normalizes it against the approved service list, and runs the same unsupported-claim QA before accepting it. If every configured Gemini model fails or produces unsafe content, generation falls back to the deterministic grounded version instead of blocking the workflow.

Google Calendar and Gmail use a real OAuth authorization-code flow at `/api/integrations/google/connect` and `/api/integrations/google/callback`. Access and refresh tokens are encrypted with AES-256-GCM and stored separately in the ignored `data/provider-connections.json` file. Set `EVERONN_CONNECTIONS_FILE` when that encrypted file should live elsewhere.

When `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` are configured, the AI Front Desk can start a private WebRTC microphone session using a short-lived server-minted conversation token. The provider key is never sent to the browser, and the typed demonstration remains available as a fallback.

The file-backed setup is ready for one Node.js application instance. If EverOnn is later deployed across multiple writable instances, point them at coordinated shared storage or introduce a database at that stage.

See `docs/agentic-that-integration.md` for the migration boundary and implementation map.
