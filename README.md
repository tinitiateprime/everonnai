# EverOnnAI

EverOnnAI is a multi-tenant platform for service businesses: AI-generated websites, customer chat and voice, service requests, Calendar booking, and owner-managed business knowledge.

## Run locally

```bash
npm install
npm run dev
```

For a new checkout, create `.env.local` using `.env.example`. Configure Gemini for generation and text conversations, Pexels for photography, ElevenLabs for live chat/voice, and Google OAuth for Calendar/Gmail. Keep credentials on the server.

- Marketing: `http://localhost:3000`
- Sign in or register: `http://localhost:3000/login`
- Business dashboard: `http://localhost:3000/dashboard`
- Customer project repositories: `http://localhost:3000/workspace`
- Private previews: generated links in Website Studio
- Published websites: `/sites/[slug]`

The initial platform-owner setup requires `EVERONN_AUTH_SETUP_TOKEN`. Later customer registration creates an isolated workspace. Select HVAC in **Knowledge → Industry intelligence** to use its domain skill; other businesses use general instructions until another domain pack is implemented.

## Website generation

Gemini plans grounded business content and writes original CSS/HTML for three design directions. Website Studio uses short JSON requests: main content/brand, one service content object at a time, photography, each original stylesheet, individual pages, then final validation and private-draft save. Each AI request has a 20-second budget and saved retry/repair state. Temporary provider failures receive at most one additional model round after a saved short cooldown. Known Gemini 3 Flash models use supported low reasoning effort for these bounded units, and known Flash Lite models use minimal effort. All verified facts and selected Markdown instructions remain in context; page prompts omit unrelated service detail copy. Accepted content and pages survive refreshes and server restarts. Resume saved build continues them. The platform validates safe, grounded output and connects booking/chat/voice controls. No template replaces failed generation.

New generations are private drafts. Publishing switches an approved live snapshot and keeps three earlier versions for rollback. Existing publications retain their compatibility renderer until replaced. Test fixtures under `tests/fixtures/` are used only by checks; production generation requires Gemini.

## Customer project repositories

**Project workspace** in each business dashboard connects the customer's own GitHub documentation. Owners/managers can connect public or private repositories; team members can browse and sync only their workspace's connections. The viewer includes filename/path search, Markdown tasks/code, Mermaid diagrams/source, raster images and mobile/light/dark views. Documents are read-only here; edit in GitHub and use Sync.

For private repositories, supply a fine-grained token with Contents read permission. The server encrypts it using the existing `CREDENTIAL_ENCRYPTION_KEY`; no source-folder credentials are imported. PostgreSQL deployments need migration `202610060004_project_repositories.sql`, included in `npm run db:migrate -- --apply`. It was applied and verified on the configured shared PostgreSQL database on 2026-10-06; live verification probes were rolled back. Deploy the updated application code to enable this feature on the hosted site. Local/Netlify storage adapters remain available for their configured runtimes.

## AI instructions and checks

The server explicitly loads the relevant versioned SYSTEM/GUARDRAILS, PLUGINS/MEMORY policies and service/capability SKILL files. SOURCES supplies verified general reference notes and provenance as data; it does not fetch pages or establish company facts. Action availability is task-specific and follows actual Google scopes; the model receives no new execution permission. Website owners/managers can save or clear scoped design choices with revision checks.

EVALS files contain executable case definitions and stay outside customer prompts. `npm run ai:eval` runs the deterministic gate; `npm run ai:eval -- --live` adds two small real Gemini checks with fictional data and isolated metering. Gemini billing must be active for real checks. Full assistant memory, document retrieval and larger audio/model evaluation datasets remain future work.

## Validation

```bash
npm run lint
npm test
npm run ai:eval
npm run build
npm run smoke
```

After a production build, `smoke` starts a disposable local server and checks HVAC website generation, owner revisions, mobile navigation, callback submission, publishing/rollback, visitor safety, and tenant isolation with a local provider fixture. It needs Chrome, defaults to its standard Windows path, and accepts `SMOKE_CHROME_PATH`. It uses temporary stores and makes no paid provider calls. Screenshots are optional: `npm run smoke:hvac -- --screenshots`.

On 2026-10-06, lint, 133 tests, the 16 deterministic AI evaluations and the production build passed. After the user replaced the key, all 18 evaluation cases passed with the working gemini-3.5-flash-lite fallback selected for that test process. The deployed visitor assistant returned HTTP 200 through the same fallback while the configured newer models returned temporary high-demand errors. Real fictional HVAC generation produced three seven-route designs and passed 42 desktop/mobile rendering checks without overflow or broken images. HVAC/customer-repository browser regressions also passed. Full deployed-generation, model/audio, visual and client acceptance remain separate.

Additional focused checks are `smoke:booking`, `smoke:usage`, `smoke:auth-db`, and `smoke:project` (customer repositories, token/scope protection and browser rendering). Useful regression tests stay in `tests/`; ordinary checks do not write screenshots into the project.

The optional `npm run verify:website:live -- --live` makes paid Gemini/Pexels calls for a fictional HVAC business and writes review artifacts under ignored `artifacts/hvac-live/`. `--review-existing` reviews the saved `website.json` without new generation calls. Neither mode changes customer workspaces, publications, or email.

On 2026-10-07, the catalogue-sized generation fix passed 147 tests, 16 deterministic AI evaluations, lint and the production build. The dashboard browser regression recovered an empty gateway response and resumed after reload. A real fictional thirteen-service carpentry build retained accepted units through provider failures and explicit resumes, completed three seventeen-route designs and passed 102 desktop/mobile rendering checks without overflow or broken images. `npm run verify:website:live -- --live --saved-steps --large-catalogue` starts this isolated review; `--live --resume-saved --large-catalogue` continues it. The smaller HVAC review remains available without `--large-catalogue`. These checks do not certify the deployed full workflow, premium design or full client acceptance.

## Persistence and deployment

Configured Supabase PostgreSQL stores workspace, account, and provider records through private relational tables. A writable single-instance local setup can use JSON files; Netlify has its configured Blob adapter. Provider credentials are stored separately and encrypted. Database setup and deployment requirements are documented in the maintained guides.

Interactive generation advances while Website Studio is open; closing it pauses between steps, and the saved build can be resumed. No post-response task or streaming support is required. An unattended worker/general queue, further domain packs, automatic visual evaluation, subscriptions, MFA and password recovery remain future work. Standalone generation/review tools retain their separate configured provider timeouts. Live provider permissions and the complete deployed generation flow require their own verification.

- [Code and implementation guide](CODE_PROFILE.md)
- [Data flow](PROJECT_DATA_FLOW.md)
- [Client technical Q&A](CLIENT_TECHNICAL_QA.md)
- [Usage operations](USAGE_OPERATIONS.md)
- [Migration provenance](docs/agentic-that-integration.md)
