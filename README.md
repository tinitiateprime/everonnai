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

The file-backed setup is ready for one Node.js application instance. If EverOnn is later deployed across multiple writable instances, point them at coordinated shared storage or introduce a database at that stage.

See `docs/agentic-that-integration.md` for the migration boundary and implementation map.
