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

Copy `.env.example` to `.env.local` and configure Gemini for website generation and typed AI conversations. Pexels supplies generated-site photography, while ElevenLabs supplies live conversational text and WebRTC voice. Inbox, preview workflow, JSON persistence, QA, and RBAC remain local application features.

The provider variable names intentionally match AgenticThat. Existing , Gemini model and timeout settings, ElevenLabs, Google OAuth, encryption, and Resend credentials can therefore be reused unchanged. EverOnn never copies those values into the browser or `data/everonn.json`.

Website Studio requires Gemini, requests schema-constrained content, normalizes it against the approved service list, and runs unsupported-claim QA before accepting it. If every configured model fails, omits required content, or produces unsafe content, generation returns a visible error and does not silently publish template copy. Each saved project records the Gemini model that generated it.

Google Calendar and Gmail use a real OAuth authorization-code flow at `/api/integrations/google/connect` and `/api/integrations/google/callback`. Access and refresh tokens are encrypted with AES-256-GCM and stored separately in the ignored `data/provider-connections.json` file. Set `EVERONN_CONNECTIONS_FILE` when that encrypted file should live elsewhere.

When  and are configured, the AI Front Desk can start a private WebRTC microphone session using a short-lived server-minted conversation token. The provider key is never sent to the browser. Typed dashboard conversations use Gemini; generated-site chat prefers ElevenLabs and continues with Gemini if its live text session cannot connect.

The file-backed setup is ready for one Node.js application instance. If EverOnn is later deployed across multiple writable instances, point them at coordinated shared storage or introduce a database at that stage.

See `docs/agentic-that-integration.md` for the migration boundary and implementation map.
