# EverOnn code profile

This is the practical guide to the EverOnn codebase. Use it to answer three questions quickly:

1. Where does a feature start?
2. Which internal and external API calls does it make?
3. What data does it read or change?

For request-by-request diagrams, read [PROJECT_DATA_FLOW.md](PROJECT_DATA_FLOW.md). For meeting-ready answers, read [CLIENT_TECHNICAL_QA.md](CLIENT_TECHNICAL_QA.md).

> Keep this document factual. “Connected” means the code calls a real provider. “Demo only” means the screen works visually but has no production backend.

## 1. System in one sentence

EverOnn is a Next.js application with Supabase-backed workspace and authentication stores on Amplify, Gemini for generation and text reasoning, Pexels for website images, ElevenLabs for live voice/chat, and Google OAuth for Calendar booking and Gmail notifications.

Accounts, business data, encrypted Google connections and provider usage use separate entity tables in the existing Supabase project's private `everonn` schema. Existing `public`, `agentic_that` and Supabase Auth data are not migrated. JSON files and Netlify Blobs remain supported for their runtimes when no PostgreSQL connection is configured.

## 2. Main technology

| Area | Implementation |
| --- | --- |
| Web application | Next.js 16 App Router, React 19, TypeScript |
| Styling | Tailwind CSS 4 plus project CSS files |
| Icons | Lucide React |
| Main business data | Private `everonn` business_profiles/contacts/leads/appointments/conversations tables with PostgreSQL; shipped `data/everonn.json` seeds only a missing primary record; JSON/Netlify Blobs without a database |
| Authentication | Scrypt password hashes in `everonn.users` and hashed opaque sessions in `everonn.auth_sessions`; JSON/Netlify Blobs without a database |
| Provider usage | Separate metering tables in private `everonn` in the existing Supabase project when configured, Netlify Blobs, or ignored local `data/usage/` for a writable single server |
| Provider credentials | Environment variables and AES-256-GCM encrypted Google connections in `everonn.provider_connections`; encrypted files/Blobs without a database |
| AI text and structured generation | Google Gemini REST API |
| Website photography | Pexels REST API |
| Live browser voice/chat | ElevenLabs Conversational AI |
| Scheduling and notifications | Google Calendar and Gmail APIs through OAuth |
| Tests | Node test runner through `tsx` |

### Customer Project Workspace

Every authenticated business workspace has a **Project workspace** dashboard link to `/workspace`. Team members can browse and sync that workspace's connected GitHub documentation. Owners/managers with `business:configure` can connect and disconnect repositories. Page/API scope always comes from the authenticated actor; repository IDs or browser workspace headers cannot select another customer's records.

`GET /api/project-workspace` lists only safe repository summaries. With `repositoryId`, it returns that repository's catalog; `path` reads a registered Markdown/Mermaid blob, and `asset` proxies a registered raster image. `POST` connects (`action: connect`) or syncs (`action: sync`); `DELETE` disconnects with the current repository revision. Mutations require the existing same-origin check. All responses are private/no-store; tokens and ciphertext never enter summaries, catalogs or documents. Disconnect removes this application's connection and credential only.

`features/project-workspace/github.ts` calls fixed `https://api.github.com` repository/tree/blob endpoints using REST version `2026-03-10`, with bounded responses, a 20-second request timeout and redirects disabled. Public repositories can be anonymous; a customer-supplied token supports private repositories or higher limits. A clean root URL, optional branch and documentation folder select the source. Only Markdown/Mermaid and supported raster assets inside the selected folder enter the catalog; generated directories and symlinks are skipped. Imports are limited to 300 documents, 500 image assets, 2 MB per preview and 12 repositories per workspace. Truncated GitHub trees fail explicitly. Blob SHAs keep the indexed document versions stable until manual sync. Rate limits, revoked tokens, oversized documents and network failures show useful errors. No clone or background polling job is added. [GitHub trees](https://docs.github.com/en/rest/git/trees#get-a-tree) and [blobs](https://docs.github.com/en/rest/git/blobs#get-a-blob) document the required Contents read permission.

`lib/project-repository-store.ts` stores separate repository rows in private PostgreSQL `everonn.project_repositories`, workspace-specific CAS-protected Netlify Blobs, or ignored `data/project-repositories.json` on a writable single local server. `EVERONN_PROJECTS_FILE` can override the local path. Authenticated tokens use the existing AES-256-GCM helpers and `CREDENTIAL_ENCRYPTION_KEY`, bound to the workspace/repository IDs. No platform-wide GitHub token or source project's credential file is imported. PostgreSQL insert/update/disconnect conditions preserve concurrent changes and enforce tenant keys, duplicate locations and the repository limit; browser/service API roles cannot access the table. Amplify continues to require durable storage.

The additive migration is `supabase/migrations/202610060004_project_repositories.sql`; `npm run db:migrate -- --apply` includes it after the core migration and verifies that other-project data/metadata remain unchanged. On 2026-10-06, this migration was applied to the configured shared PostgreSQL database. The transactional migration verified unchanged data/metadata for 95 other-project tables. A separate rolled-back probe verified repository insert/read/update/disconnect, encrypted payload round trips, stale-write rejection and cross-workspace isolation, with no retained probe records. Row-level security and denial of table/function access for anon, authenticated and service_role were verified; the existing credential encryption key is configured. Updated application code still needs deployment before the hosted dashboard gains this feature. The page shows a service-unavailable message if storage is unavailable.

`components/project-workspace/` adapts the four useful tree/Markdown/Mermaid viewer components from local `project-management` (`@npmaccount990/project-workspace` 0.6.0), with an EverOnn shell and connection dialog. It offers repository selection, filename/path search, task counts, code copying, relative document/image links, diagram/source viewing, light/dark and mobile navigation. Rendering sanitizes Markdown and uses strict Mermaid security. Repository files are read-only here; edits stay in GitHub. Viewing a repository's `SKILL.md` does not execute it or replace the platform's AI skill packs. No standalone server, GitHub App installer, source credentials, clone cache, build files or unrelated source tests are imported. Mermaid's KaTeX dependency is pinned to patched 0.18.2 with a scoped package override.

`tests/project-workspace.test.ts` verifies GitHub URL/file guards, provider limits/errors, encrypted credential scope, local/SQL persistence, conditional writes and private-table permissions. `npm run smoke:project` uses mocked GitHub and disposable account/workspace stores to test public/private connections, customer/team isolation, sync, Markdown/images, diagrams and desktop/mobile navigation. A separate read-only live probe also fetched a public GitHub repository manifest and README without storing a connection. Customer private tokens and deployment still need their own verification.

### Provider usage meter

The owner/manager `/dashboard/usage` shows workspace-scoped Gemini requests/tokens, ElevenLabs voice/chat conversations, reported credits/USD, and estimated Gemini token costs. All chargeable attempts, including retries and output rejected by QA, remain in the ledger. Provider metadata reads do not count as feature consumption. Local clarification, marketing demos, and browser speech synthesis make no provider calls.

| Module / route | Responsibility |
| --- | --- |
| `features/usage/gemini.ts` | Durable pending record before the provider request; actual `usageMetadata`, HTTP result, and optional provider response ID |
| `features/usage/delivery.ts` | Three write attempts, normalized response journal, replay, and a process-memory fallback during complete storage outages |
| `features/usage/elevenlabs.ts` | Credential setup metrics; verified agent/user identity; paginated discovery; adaptive retries with no 24-hour cutoff |
| `features/usage/webhook.ts` | Raw-body HMAC/timestamp verification, workspace attribution, transcript stripping, durable acceptance, and duplicate-safe delivery |
| `features/usage/worker.ts`, `instrumentation.ts` | Bounded unattended reconciliation, journal recovery, billing synchronization, heartbeat; Node timers only for continuously running servers |
| `features/usage/pricing.ts` | Dated standard text rates, cached input and thinking, long-context tiers; USD estimates kept separate from provider bills |
| `features/usage/billing.ts` | Optional read-only BigQuery billing export for an explicitly assigned, workspace-dedicated Google project; currencies/credits retained |
| `features/usage/import*.ts`, `scripts/import-usage.ts` | Administrative, explicitly attributed history import; dry run by default; stable provider IDs repair existing requests without double-counting |
| `lib/usage-store.ts`, `lib/usage-supabase.ts`, `lib/usage-postgres.ts` | Event/session/journal/billing namespaces and provider claims; private PostgreSQL or optional Data API; UUID conditional updates across instances |
| `lib/supabase-ca.ts` | Public provider CA for database certificate/hostname verification; contains no application credential |
| `lib/app-records.ts`, `scripts/migrate-everonn-database.ts`, `supabase/migrations/202610040003_everonn_relational.sql` | Entity tables, shape-preserving app views/functions, conditional revisions and atomic consolidation with other-project data/metadata checks |
| Historical application/usage migrations and `scripts/*usage-database.ts` | Bootstrap dependencies, connection/probe verification; app/usage migration commands now consolidate into `everonn`; no AgenticThat migrations or runtime DDL |
| `scripts/migrate-local-usage.ts` | Dry-run/explicit-apply transfer of existing local usage; ownership guards and deduplication retained |
| `features/usage/summary.ts`, `features/usage/health.ts` | Timezone totals, missing-metric counts, chart coverage, background heartbeat, verified webhook receipt, queued-write counts |
| `GET /api/usage` | Actor-resolved workspace and `usage:view` RBAC; no opaque tracking identities or provider credentials in responses |
| `POST /api/usage/sync` | Same-origin owner/manager refresh, including journal recovery and up to ten eligible sessions |
| `POST /api/usage/elevenlabs/session` | Opaque callback ticket; actual provider identity must match; no client-supplied charges |
| `POST /api/usage/elevenlabs/webhook` | Signed provider callback; 2 MB streaming body limit; failures return retryable 503 |
| `POST /api/usage/jobs`, `features/usage/job-auth.ts` | Server bearer credential or short-lived HMAC with an atomic durable nonce claim; bounded worker without browser sessions |
| `lib/usage-scheduler.ts`, `scripts/configure-usage-scheduler.ts`, `supabase/migrations/202610040001_everonn_usage_scheduler.sql` | One Supabase Cron job; encrypted Vault config; signed pg_net requests; scoped retention, collision checks, transactional verification and explicit enable/disable |
| `infrastructure/usage-amplify.json`, `amplify.yml` | EventBridge/Lambda schedule and logs only; server environment preparation includes Supabase credentials |
| `scripts/write-amplify-env.mjs` | Validates live origin/storage settings before deployment, preserves literal-dollar secrets in SSR configuration, and forces durable storage/external scheduling |

Gemini totals are measured; cached input is already part of prompt tokens. Gemini USD is a labelled estimate based on verified model rates, including thinking output and cache discounts. The default `list-price` mode does not infer that an API key is paid. Unknown models or incomplete counts remain unpriced. Actual Google charges require a separate billing export connection; they are reported project totals, not invented feature-level invoice amounts. Agent-managed LLM charges remain in ElevenLabs provider conversation billing.

ElevenLabs setup requests are separate from conversations. The SDK receives an opaque server-issued `userId`. Normal callbacks, discovery and signed webhooks verify agent/user attribution. Unused tickets continue discovery with slower intervals after one hour/day; errors back off up to one hour. Complete conversation charges are stable-ID updates. Administrative legacy imports can assign selected provider-verified conversations without a former userId; this exception is restricted to server-created import sessions and never accepted from browser metrics. Global provider claims prevent assigning a response/conversation to multiple workspaces or features.

Historical imports are explicitly marked so they cannot invent zero-usage days before live tracking. Delayed webhooks retain newer direct provider metrics and request an authoritative recheck, even for a previously complete ticket.

The UI includes a numeric chart scale and recorded values, untracked-day shading, missing-metric indicators, separately labelled estimated/reported costs, and synchronization health. The page still refreshes every 15 seconds and offers manual synchronization; background jobs and webhooks allow recovery without an open page.

Storage priority is configured Supabase, Netlify Blobs, then ignored local JSON. PostgreSQL uses only fixed `everonn` objects: separate events, sessions, outbox, claims, billing, worker state, nonce and webhook receipt tables, with a union usage view for existing store callers. Indexed keys, workspace columns and fresh UUID revisions preserve pagination and atomic compare-and-set behavior. `SUPABASE_DB_URL` uses certificate/hostname-verified TLS, no prepared statements/pipelining and at most two usage connections per instance. The optional Data API retains the `everonn_usage` compatibility profile; its views/functions reach these same tables. Other schema names/public keys are rejected. Broken configuration never silently falls back, and serverless runtimes require durable storage before paid requests. Metering rows contain no prompts, transcripts, provider keys or customer details.

Apply `npm run db:migrate -- --apply` before deploying the relational adapter. It locks only recognized EverOnn stores, preserves payloads/revisions/timestamps, and atomically switches old-schema names to compatibility views/functions. PostgreSQL access does not change Data API exposure. Browser roles have no access to `everonn`; service_role can meter only and cannot read application/authentication/provider tables. ElevenLabs still needs the live webhook and provider secret; optional BigQuery billing needs its own export credentials. Local tests do not activate external services.

On 2026-10-03 the dedicated schema was applied to the supplied existing Supabase project; TLS, permission and conditional-write checks passed without changing existing project metadata, and one local usage event was transferred. On 2026-10-04 Amplify deployment 13 activated signed jobs after server settings were corrected. Live checks verified the worker's Supabase connection, job authorization, concurrent nonce rejection (200/409) and webhook HMAC verification. Supabase Cron is enabled and an actual scheduled HTTP 200 was observed. After the existing key received Agents Write permission, the ElevenLabs HMAC hook was attached to the configured agent with retries, transcription events and JSON format. Provider reads verified the attachment, retained conversation access and unchanged other agent/shared workspace settings. Google billing export is not connected; a setup probe does not establish actual post-call delivery.

The Supabase scheduler enables previously absent pg_cron/pg_net extensions and adds exactly one job and one namespaced Vault secret. These provider-managed objects live outside `everonn`; existing application tables, shared extension settings/grants, other jobs, other Vault entries and Data API exposure remain unchanged. Its function/request history stay in the private usage schema, with execution denied to browser/API roles. The permanent secret is absent from Cron commands and pg_net's public request queue: PostgreSQL signs timestamp/UUID/method/path using the existing pgcrypto extension. The app allows three minutes of age/30 seconds future skew, consumes each nonce before work and rejects replays. The next minute recovers a failed invocation with a fresh nonce. Pending HTTP requests suppress overlapping dispatch; seven-day pruning is restricted to this job's history, request IDs and nonce claims. Enable verifies the deployed signed endpoint first; reconfiguration pauses the job. The AWS template remains an alternative, not a second concurrent scheduler.

Verification is in `tests/usage.test.ts`, `tests/usage-reliability.test.ts`, `tests/usage-supabase.test.ts`, `tests/usage-scheduler.test.ts`, `tests/amplify-env.test.ts` and `scripts/smoke-usage.ts`. Tests cover recovery, signed/duplicate webhooks, old-session discovery, imports, billing scope/currencies and mobile chart behavior. PostgreSQL-engine tests verify migrations, retained existing sample data/permissions, conditional writes, pagination, scheduler collisions, scoped retention, unchanged other jobs/secrets and compatibility of real pgcrypto signatures with Node verification. Smoke checks concurrent signed jobs accept one nonce only. Mocked HTTP tests verify Data API profiles, row caps and sanitized errors. Amplify tests verify rejection of missing storage and round-trip secret preservation without build-role credentials. Smoke stores override all Supabase variables to protect the shared project. Browser/provider responses are mocked; separately authorized live checks are documented in [USAGE_OPERATIONS.md](USAGE_OPERATIONS.md).

Path alias: `@/something` means a file starting at the project root, configured in `tsconfig.json`.

### Application persistence on Amplify

`lib/app-records.ts` queries only fixed `everonn` objects through certificate-verified PostgreSQL. Users, hashed sessions, invitations, business profiles, services, knowledge, team members, contacts, leads, conversations, messages, appointments, website projects, integration status and encrypted Google connections each have their own tables. Rows retain optional/nested JSONB fields; generated columns expose IDs, names, email, roles, status and metrics without duplicating mutable values. Foreign keys link workspace data and user/session scope. Complex website specifications remain JSONB within each project row.

The `app_records` aggregation view reconstructs existing API shapes. Invoker write functions normalize one snapshot atomically after an insert-only or matching UUID revision; errors roll back every entity change. Array positions preserve ordering. Authentication shares a CAS boundary for multi-user operations, while each workspace has its own boundary; callbacks retry conflicts up to eight times. Legacy registration can reserve a workspace before its profile is saved; reservations are excluded from workspace listings. Existing cookies, scrypt hashes, lockouts, invitations and AES-256-GCM connection ciphertext retain their values.

The fixed schema contains RLS-protected tables with no browser access. The service role has metering permissions only; application data uses the private database connection. No Supabase Auth, shared API exposure, AgenticThat data or credentials are modified. `scripts/migrate-everonn-database.ts` checks other-project table contents and object/permission metadata inside its transaction; SQL compares all original app/usage payloads, revisions and timestamps before switching stores. Old schema names become compatibility views/functions for rolling deployment. `legacy_*` tables are restricted snapshots, never active stores. Mismatches or an unrecognized occupied `everonn` schema abort migration.

The primary business seed is inserted only if absent; deploys do not reset accounts or import ignored local/Netlify data. Amplify requires durable PostgreSQL and refuses file fallback. Authentication/RBAC remain application-owned; email verification, password recovery and MFA are not added.

`tests/everonn-relational.test.ts` verifies complete round-trip preservation, named rows, permissions, scope rejection, CAS, alias deletion, registration reservations and safe reruns. Scheduler tests verify consolidation preserves the job, secret and request history, and reconfiguration writes the new tables. `npm run smoke:auth-db` runs real production signup/login/workspace routes with file writes blocked, then restarts a disposable PostgreSQL engine to check saved accounts and sessions. It never contacts shared Supabase or paid providers.

## 3. Best reading order

Read these files in this order when learning the product:

1. `features/everonn/types.ts` — every important business data shape.
2. `data/everonn.json` and `data/workspaces.json` — the primary workspace and isolated self-registered customer workspaces.
3. `features/everonn/workspace-provider.tsx` — browser state, loading, autosaving, and refresh.
4. `lib/json-workspace-store.ts` — server-side persistence and validation.
5. `features/auth/session.ts` and `lib/auth-store.ts` — signed-in actor, sessions, passwords, invitations, and role checks.
6. `components/dashboard/everonn-dashboard.tsx` — role-aware dashboard and its feature entry points.
7. `features/voice-agent/engine.ts` — shared business-aware receptionist rules.
8. `features/website-studio/` — website generation, QA, and images.
9. `features/integrations/lead-automation.ts` — lead-to-Calendar/Gmail automation.
10. `app/api/` — HTTP boundaries used by the browser.

## 4. Folder responsibilities

| Path | Responsibility |
| --- | --- |
| `app/` | Pages, layouts, public routes, preview routes, published sites, and API route handlers |
| `components/` | Browser UI: dashboard, marketing UI, generated-site renderer, and assistants |
| `features/everonn/` | Domain types, demo seed, starter workspace, browser workspace provider, request-ID lead upserts, and preservation of server-owned lead state |
| `features/website-studio/` | Gemini prompt/schema, output normalization, QA, project creation, and Pexels selection |
| `features/voice-agent/` | Receptionist prompt, contact extraction, Gemini replies, appointment extraction, and timezone conversion |
| `features/integrations/` | Google OAuth, Calendar/Gmail clients, a per-workspace automation queue, and a testable automation core with a durable workspace lease |
| `features/auth/` | Authentication types, password hashing, session helpers, role capabilities, and workspace-scope guards |
| `lib/` | Workspace/auth JSON persistence, provider readiness, and encrypted credential storage |
| `data/` | Primary workspace JSON plus ignored customer-workspace, auth, and encrypted provider-connection files |
| `tests/` | Unit and integration-level behavior tests |
| `scripts/` | Browser smoke test for the main product journey |

## 5. Page and UI routes

| URL | Main file | What it does |
| --- | --- | --- |
| `/` | `app/page.tsx` | EverOnn marketing homepage |
| `/product/*`, `/industries/*`, `/pricing`, etc. | `app/[...slug]/page.tsx` | Static marketing/detail pages |
| `/login` | `app/login/page.tsx` | First-owner setup, credential sign-in, or a new customer's isolated workspace registration |
| `/join/[token]` | `app/join/[token]/page.tsx` | Accepts a one-time team invitation and creates an account |
| `/dashboard` | `app/dashboard/[[...section]]/page.tsx` | Authenticated, role-aware owner/manager/agent/viewer dashboard |
| `/dashboard/knowledge` | `components/dashboard/everonn-dashboard.tsx` | Edits the central business profile, services, and approved knowledge |
| `/dashboard/ai-agent` | same dashboard component | Tests Gemini text or ElevenLabs voice and captures leads |
| `/dashboard/website` | same dashboard component | Generates, previews, approves, and publishes the customer website |
| `/dashboard/settings` | same dashboard component | Account password, provider status, and owner-only team access controls |
| `/preview/[token]/*` | `app/preview/[token]/...` | Private, `noindex` generated-site preview |
| `/sites/[slug]/*` | `app/sites/[slug]/...` | Server-rendered published customer website |

`components/app-chrome.tsx` decides which shell surrounds a page:

- marketing pages receive the EverOnn header, footer, and marketing demo chat;
- dashboard, login, join, and preview pages receive the product shell without marketing chrome;
- published `/sites/*` pages are rendered without loading the private browser workspace.

Only dashboard routes mount `WorkspaceProvider`. The dashboard waits for a successful private-workspace load and shows a retry error on load failure instead of displaying the demo seed as customer data. The dashboard page verifies the server session before rendering, so marketing, login, join, and public website pages do not request private workspace data.

## 6. Internal API call map

### Workspace

| Method and route | Called from | Work performed | Data changed |
| --- | --- | --- | --- |
| `GET /api/workspace` | `WorkspaceProvider`, smoke test | Reads JSON, adds live provider connection status, disables caching | None |
| `PUT /api/workspace` | `WorkspaceProvider` after a 450 ms debounce | Validates workspace ID, preserves server-owned request/automation fields and Google appointments during stale saves, prevents publish-state regression | Whole workspace JSON |
| `HEAD /api/workspace` | Diagnostics | Reports persistence type in `X-EverOnn-Persistence` | None |

The implementation is `app/api/workspace/route.ts`. All methods require a valid server session. Writes compare changed workspace sections and require the corresponding role capability before `lib/json-workspace-store.ts` saves them.

### Authentication and team access

| Method and route | Called from | Work performed |
| --- | --- | --- |
| `GET /api/auth/session` | Diagnostics/client checks | Returns setup state and the current actor, never the session token |
| `POST /api/auth/setup` | First visit to `/login` | Verifies the production setup token, creates the first owner, and sets the session cookie |
| `POST /api/auth/register` | “Create a new account” on `/login` | Creates a separate owner account and empty business workspace, then sets the session cookie |
| `POST /api/auth/login` | `/login` | Verifies the scrypt password hash, applies lockout/rate limits, and sets the session cookie |
| `POST /api/auth/logout` | Dashboard header | Revokes the server session and clears the cookie |
| `POST /api/auth/password` | Dashboard Settings | Verifies the current password, changes it, revokes other sessions, and rotates the current session |
| `POST /api/auth/invitations` | Owner Settings | Creates a seven-day, one-use, non-owner invitation URL |
| `GET/POST /api/auth/invitations/[token]` | `/join/[token]` | Reads invitation metadata and creates the invited account/session |

The browser cookie contains a random opaque token. Only its SHA-256 hash is stored. Passwords use Node scrypt with a unique random salt. State-changing routes enforce same-origin requests, and server routes call `requireActor()` rather than trusting browser-supplied role data. Public registration always creates a unique workspace; joining an existing business still requires an owner-generated invitation.

### AI assistant and voice

| Method and route | Called from | Internal path | External call |
| --- | --- | --- | --- |
| `POST /api/assistant/message` | Dashboard text agent and generated-site Gemini fallback | Access check → rate limit → `generateAssistantReply()` | Gemini `models/{model}:generateContent` |
| `GET /api/voice/session` | Dashboard settings | Returns whether ElevenLabs key + agent ID exist | None |
| `POST /api/voice/session` | Dashboard AI agent | Workspace header check → build dynamic business variables | ElevenLabs conversation token + signed URL endpoints |
| `POST /api/site-assistant/session` | Private or published customer website | Preview-token/published-slug check → visitor rate limit → dynamic business variables | ElevenLabs conversation token + signed URL endpoints |

Shared instructions come from `features/agent-runtime/prompt-composer.ts`, which loads versioned Markdown from `ai/`. Website generation, Gemini assistant replies, appointment extraction, and ElevenLabs session variables use the same system/domain/capability boundaries. Pure caller extraction stays in `features/voice-agent/engine.ts`; server-only voice composition lives in `session-prompt.ts`. Gemini receives skill instructions as `systemInstruction`, and business facts as structured context. Text safety checks precede booking clarification.

### Lead capture and follow-up

| Method and route | Called from | Work performed | Data changed |
| --- | --- | --- | --- |
| `POST /api/site-assistant/lead` | Dashboard agent and generated-site assistant | Validates access/details, upserts progressive request details by requestId; finalize:false saves only, final submission runs automation | Contacts, leads, appointments, automation state |
| `POST /api/integrations/google/automation` | Manual/server retry path | Re-runs automation for an existing lead; optionally validates and saves an explicit service/date/time choice before processing | Lead automation and possibly appointment |

`features/integrations/lead-automation.ts` is the orchestrator. It can make three provider calls:

1. Explicit `appointmentRequest` fields select an active service, date, and time without AI. For conversational scheduling, Gemini returns exact customer quotes for service/date/time; independent validation rejects invented timestamps, unsupported services, and ambiguous preferences. Ordinary callback messages need no booking extraction.
2. Google Calendar first checks the deterministic event ID for recovery, then checks `primary` availability and inserts only when availability is verified. Missing/error freeBusy data fails safely. Disconnected or busy calendars retain the customer's chosen time as an unconfirmed request.
3. Gmail sends one owner notification per completed request when connected and enabled. `gmailAttemptedAt` is persisted before the send. Sent, pending, and uncertain deliveries are never automatically sent again; ambiguous delivery requires checking Gmail Sent before a manual resend.

`lead-automation.ts` queues work within each server process. `lead-automation-core.ts` obtains a five-minute durable workspace lease before provider calls; Netlify uses conditional Blob updates. A busy worker returns a saved-request/retry message. Local file writes are serialized within one process; local JSON is not a distributed database. Confirmed events are retained for human review when later request details change.

The dashboard Appointments view shows the original service request, customer details, selected date/time/timezone, provider status, and Google event link. Operators can collect missing details with blank service/date/time controls. The website assistant offers the same explicit controls after contact capture and reports confirmation only from the lead API response.

### Website Studio

| Method and route | Called from | Work performed | Data changed |
| --- | --- | --- | --- |
| `GET /api/website-studio` | Status/diagnostics | Reports providers, concepts, and publishing gates | None |
| `POST /api/website-studio` | Dashboard Website section | Authenticate → canonical facts/memory → Markdown → Gemini content → Pexels → three Gemini HTML/CSS artifacts → validation/repair/QA → guarded draft save | Website project only; optional progress stream |
| `GET/PUT/DELETE /api/agent-runtime/memory` | Website design editor | Read/save owner/manager design preferences and chronological requests; clearing a selected scope requires its current revision | Workspace `aiMemory` |
| `POST /api/website-studio/status` | Website workflow buttons | Enforces the next legal state and publishing requirements | Website status and selected concept |

Website status must move in order:

`generated → claimed → verified → approved → published`

Publishing requires passing QA and selecting `editorial`, `momentum`, or `aura`.

### HVAC skill runtime and generated website code

`BusinessProfile.skillId` explicitly selects `general` or `hvac`; optional `domainSkillIds` composes registered domains. Existing profiles without a selection use general capabilities. New workspaces select HVAC in Knowledge; the HVAC fixture selects it explicitly. Other industry packs remain future work.

`ai/SYSTEM.md`, shared/domain guardrails, and capability Markdown supply reusable behavior. The loader uses allowlisted paths, version validation, SHA-256 digests, and production caching. API output tracing includes `ai/**/*.md`. Generation records the exact skill versions. Website building version 1.3.0 instructs actual HTML/CSS generation with no predefined layout choices, explicitly rejects invented credentials, and distinguishes actual main/H1/nav/action tags from similarly named classes or ordinary contact links. Structural repair feedback includes the affected route, actual main/H1 counts and every missing requirement; validation still rejects incomplete pages. Eval Markdown describes scenarios; executable checks cover the implemented invariants rather than claiming exhaustive live-model evaluation.

Owners/managers save approved, tenant-scoped website memory at workspace or stable `main-site` project scope through `PUT /api/agent-runtime/memory`. Brief, exact colors, typography/spacing/imagery hints, priority service, optional hidden sections, accepted/rejected choices, and twenty chronological requests are retained with optimistic revisions. The old hero/service layout picker is removed. Legacy memory fields are accepted for compatibility as presentation hints; they no longer select render templates. Project snapshots override workspace defaults. Visitor chat cannot write memory or change shared skills; assistant context excludes website preferences.

Generation has two stages: `ai-generator.ts` requests grounded content/brand/SEO/media planning, with one validation repair per model using the original output and exact failed checks. `code-generator.ts` runs three independent concepts concurrently, each with one active small request: original CSS plus Home, then batches of at most three remaining pages reusing that design system. This caps provider concurrency at three and avoids requesting an entire large catalogue in one response. Code calls allow 16,384 output tokens (including provider thinking) to avoid truncated homepage/style output. Timeout/network/transient HTTP failures try up to three configured Gemini models for the affected batch; a successful fallback remains preferred for that concept. Each batch permits one validation repair, receiving completeness/routes/grounding problems together. Its response schema requires the exact page count, while independent validation also checks unique route coverage. Completed batches are retained in memory within the current request, and an unrecoverable concept failure cancels other active code calls. Final assembly rechecks exact whole-site coverage and grounding. There is no durable/resumable generation job across process loss. Persistent errors identify failed checks or concept/routes. All calls, repairs, fallbacks and rejected output are metered. Pexels resolves approved assets before code generation; no-photography skips images.

`generator.ts` grounds customer copy, including SEO, service content, image descriptions, parsed HTML text/accessibility labels and strings in CSS declarations. Internal design rationale, image-search queries and structural class/ID names are not customer claims. Real unsupported credentials and placeholder copy still block acceptance; this distinction does not relax HTML/CSS execution checks.

Website Studio requests `Accept: application/x-ndjson` from the same authenticated POST endpoint. The route checks origin, role and workspace before opening a no-store stream, sends progress through content/media/page batches/final save, and emits fifteen-second heartbeats. It sends a final result only after canonical facts/memory/draft comparison and persistence succeed. Streaming failures use an error event; authorization failures retain their HTTP status. Non-stream clients retain the original JSON result. `progress.ts` parses UTF-8/chunk boundaries and refuses incomplete streams as success. Progress does not remove hosting request-duration limits or create a background queue.

`WebsiteSpec.code` stores per-concept original CSS, Home/Services/About/Contact and each active service's HTML, page titles/descriptions, the successful code model IDs for each concept, and a validation timestamp. The generation-level model identifies the content planner. `normalizeWebsiteCodeBatch()` applies the same HTML/CSS guards to exact requested subsets; full concept normalization still requires every route. Extracted inline-style class names use absolute site page indices to remain unique across batches. Concept labels are comparison identifiers, not layout templates. `code-validation.ts` uses parse5 and CSS Tree ASTs: allowlisted semantic HTML, exact required routes/services, real contact links, approved asset keys, unique IDs, complete navigation, main/H1 and platform actions; no executable HTML, handlers, embeds, inputs, invented URLs, rendered inline styles, CSS URL/import/font loading, or dependency execution. Benign inline declarations from provider output are parsed with the same CSS guards and moved into generated classes before strict HTML validation; resource-loading or malformed declarations are rejected. CSS selectors always receive a descendant prefix, keyframes receive concept prefixes, and a paint/layout containment wrapper isolates the generated surface from application controls. Validation rejects unsafe output rather than executing it.

`private-website-preview.tsx` prepares validated HTML/CSS on the server; `website-page.tsx` hydrates platform actions without running generated JavaScript. Booking opens the real callback/appointment form and calls the validated lead endpoint with idempotent request IDs. Chat/voice CTAs open the existing assistant. The application stylesheet contains integration controls and preview notices, not new-site page layouts. The dashboard iframe shows the actual generated page. Public pages are server-rendered with generated page metadata; private previews remain noindex. Private knowledge/rules are removed from client assistant profile props.

Saved pre-code publications use the explicitly isolated `legacy-website-preview.tsx` / `legacy-preview.css` compatibility reader until the owner publishes a replacement. There is no deterministic HTML/CSS fallback in new production generation. Deterministic content and browser fixtures moved to `tests/fixtures/`.

Generation reads canonical saved profile/memory and compares those plus the old draft before saving; concurrent changes return 409 and provider failure preserves the old draft. It creates a new private token while retaining the public slug. `publishedWebsite` is an immutable release snapshot (project plus presentation facts); `websiteProject` is the current draft. Regeneration preserves the live release. Ordered claim/verify/approve/publish revalidates code/QA and checks generation facts have not changed, then atomically switches the live pointer and retains three prior published releases. The status endpoint supports authorized rollback with an expected live-release ID. Preview/public chat and lead access use `site-access.ts`, so a live site works while a separate draft is pending; server-side assistant and booking still use current canonical facts. Generic workspace autosaves cannot write memory, drafts, publications, or release history, even with forged future timestamps.

These fields round-trip through the existing private workspace envelope and project payload; no additional SQL migration is required. Automatic learning/promotion, automatic memory extraction, additional industry packs, surgical page editing, arbitrary generated JavaScript, arbitrary LLM tool execution, and background generation jobs are not implemented. Current limits: sixteen services, 55,000 characters per HTML page, 40,000 CSS characters per concept, and 900,000 characters total code. Requests run synchronously; hosted request duration limits must accommodate content generation/fallback and every sequential page batch/repair within three concurrent concepts. A 13-service catalogue produces 51 pages and can take several minutes. Structural checks cannot guarantee visual excellence, universal factual accuracy, or full accessibility; owner review remains necessary.

`npm run smoke:hvac` uses disposable local accounts and a Gemini fixture to exercise batched generation and streamed progress, original HTML/CSS rendering, desktop/mobile navigation, the real callback form, visitor safety, remembered revisions, live/draft separation, ordered publishing/rollback, tenant isolation, revision conflicts and stale saves. No paid provider/shared database is contacted. `npm run smoke` aliases this same isolated check, replacing the obsolete live-workspace smoke script. Screenshots are opt-in with `npm run smoke:hvac -- --screenshots` and written to ignored `artifacts/hvac/`; normal smoke runs leave no project artifacts. The fixture forwards browser API traffic through its non-browser client because the build's configured public origin may differ; origin policy has independent tests. `npm run verify:website:live -- --live` explicitly makes paid Gemini/Pexels calls for a fictional HVAC profile, stores an isolated usage ledger, saves generated artifacts under `artifacts/hvac-live/`, and checks every page at desktop/mobile sizes. It never changes an account, customer workspace, published site, shared database or email. `--review-existing` validates and reviews the saved fictional `website.json` without new generation calls. The tool stores the final artifact, screenshots and browser review only; one-off raw provider-response replay code and logs have been removed. The exact page-count array constraints follow the [Gemini Schema reference](https://ai.google.dev/api/generate-content#Schema). Useful unit tests and provider fixtures remain under `tests/` and never serve as production templates.

### Runtime Markdown, references, actions and evaluations

`skill-registry.ts` allowlists the runtime assets. `skill-loader.ts` reads bounded, versioned files and records SHA-256 digests. `prompt-composer.ts` includes SYSTEM/GUARDRAILS, PLUGINS/MEMORY policies, selected capability skills and explicit domain skills in the system instructions for website content/code, Gemini chat, appointment extraction and ElevenLabs session context.

The domain SOURCES file is read separately into a reference-data catalog. HVAC URLs must match the approved HTTPS origins; credentials, query strings, fragments and duplicate references are rejected. Registered reference notes have bounded summaries, verification dates and exact source provenance; malformed/unknown fields or unregistered note URLs fail closed. Three HVAC notes were verified against EPA/CDC/DOE primary pages on 2026-10-06, including replacement of the obsolete DOE URL. Their text enters reference data with `contentProvided:true` and `fetchedAtRuntime:false`, never the system instruction. They cannot establish company services, credentials, prices or guarantees. The application does not fetch linked pages at runtime; full document retrieval remains future work.

`tool-registry.ts` builds a task-specific APPLICATION_WORKFLOWS catalog. Chat/voice routes derive availability from the authenticated business's Google scopes and notification setting. Calendar read access alone does not advertise appointment creation; booking availability requires free/busy and event-write scopes. Unknown connections disable the provider workflows. Gemini safety/clarification happens before connection resolution; failed optional connection lookup leaves workflows unavailable. Scope mismatches fail closed. These are application-managed workflow descriptors, not Gemini function declarations, plan entitlements or execution grants. Existing endpoints retain their role, validation, confirmation and provider-result checks; the full schema-driven LLM executor/entitlement framework is not implemented by this change.

MEMORY.md governs the existing approved website-preference records. Writes and model context reject invalid scopes, duplicate records, excessive request history, unknown preference fields and recognised credential/private-key patterns. Only website tasks receive those preferences. DELETE `/api/agent-runtime/memory` requires same-origin, owner/manager permission, explicit scope and current revision; it forgets that scope's record, retains the other scope and does not change the published release. Website Studio exposes a clear-saved-choices control and shows history for the selected scope. Full assistant long-term memory, expiry/DSR and automatic memory extraction remain future work; no SQL migration is needed for this endpoint.

EVALUATION_FILES is separate from the production instruction allowlist. The four EVALS documents contain typed JSON case blocks; the loader rejects missing blocks, unknown checks, malformed data and duplicate IDs. `npm run ai:eval` executes 16 deterministic runtime/grounding/memory scenarios and reports two real-provider cases as skipped. `npm run check` includes this gate. `npm run ai:eval -- --live` uses a fictional profile, isolated temporary usage storage, capped configured-model fallbacks and no customer/provider-connection changes for two small Gemini response checks. It never feeds the evaluation datasets into customer prompts. After the user replaced the key on 2026-10-06, the deployed visitor assistant returned HTTP 200 using gemini-3.5-flash-lite. Configured 3.8/3.7 models returned transient high-demand errors; the explicit live evaluation passed all 18 cases with the working fallback selected only for that test process. These cases do not complete the specification's full 150/500-scenario, SIP-audio, visual or client-acceptance gates.

The renewed fictional HVAC website check first exposed an incomplete-page repair failure. After the structural feedback/skill update, real Gemini/Pexels generation produced three seven-route designs. All 42 desktop/mobile page checks passed without viewport overflow or broken images. Generated artifacts stay in ignored `artifacts/hvac-live/`, and usage stays isolated from customer records. This is rendering/grounding evidence, not premium-design approval or proof of the whole generation request on Amplify; manual design review and deployed-generation verification remain separate.

### Google connection

| Method and route | Called from | Work performed |
| --- | --- | --- |
| `GET /api/integrations/google` | Dashboard Settings | Returns configuration, connection/scopes, and exact callback URI |
| `GET /api/integrations/google/connect` | Connect button | Creates signed OAuth state + nonce cookie and redirects to Google |
| `GET /api/integrations/google/callback` | Google OAuth redirect | Verifies state/cookie, exchanges code, encrypts tokens, updates integration flags |
| `DELETE /api/integrations/google` | Disconnect button | Revokes the Google token, removes stored credentials, clears flags |

## 7. External provider calls

| Provider | Exact use | Code |
| --- | --- | --- |
| Gemini | Multi-page website JSON (`maxOutputTokens: 16384`) | `features/website-studio/ai-generator.ts` |
| Gemini | Grounded assistant reply (`maxOutputTokens: 600`) | `features/voice-agent/gemini.ts` |
| Gemini | Appointment intent JSON (`maxOutputTokens: 2048`) | `features/voice-agent/appointment.ts` |
| Pexels | Landscape photo searches for hero, gallery, and each service | `features/website-studio/media.ts` |
| ElevenLabs | Short-lived conversation token for WebRTC voice | `app/api/voice/session/route.ts`, `app/api/site-assistant/session/route.ts` |
| ElevenLabs | Signed WebSocket URL for live text conversation | `app/api/site-assistant/session/route.ts` |
| Google OAuth | Consent, code exchange, refresh, and revoke | `features/integrations/google-oauth.ts` |
| Google Calendar | Verified `freeBusy`, deterministic event recovery, and event insert/get | `features/integrations/google.ts` |
| Gmail | RFC 2822 message sent through `users/me/messages/send` | `features/integrations/google.ts` |

Gemini model order, timeouts, and retries come from `lib/provider-config.ts`. Website generation tries configured models in order. Appointment extraction tries at most the first two.

## 8. Data and secrets

### Business data

`EverOnnWorkspace` in `features/everonn/types.ts` contains:

- one `BusinessProfile`;
- contacts, leads, conversations, and appointments; leads may include requestId, collecting/complete state, full customer request text (up to 12,000 characters), explicit appointmentRequest, and provider automation markers; appointments retain UTC start/end, booking timezone, and requestDetails;
- an optional expiring automationLock used only by the server;
- one generated `WebsiteProject`;
- integration display state;
- team members.

The same `BusinessProfile` feeds website generation, Gemini chat, ElevenLabs dynamic variables, appointment extraction, and customer-facing content. Changing knowledge affects voice/chat immediately after save; the website must be regenerated to receive new pages/copy/images.

### Secret data

Secrets never belong in workspace JSON files.

- API keys and OAuth client credentials live in `.env.local` locally or host environment variables.
- Google access/refresh tokens are AES-256-GCM encrypted by `lib/provider-credentials.ts`.
- Local encrypted tokens live in ignored `data/provider-connections.json`.
- Netlify runtime uses a separate encrypted Blob store.
- Password hashes, session-token hashes, and invitation-token hashes live in ignored `data/auth.json` locally or the `everonn-auth` Blob store on Netlify. Raw passwords and raw session tokens are never stored.

## 9. Environment variable ownership

| Variables | Used by |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Authoritative public HTTP(S) origin for state-changing API checks behind a hosting proxy; falls back to the request URL when unset |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Website generation, chat, appointment extraction |
| `GEMINI_WEBSITE_MODEL(S)` | Ordered Gemini model selection |
| `GEMINI_WEBSITE_TIMEOUT_MS`, `GEMINI_WEBSITE_CODE_TIMEOUT_MS`, `GEMINI_WEBSITE_RETRY_DELAY_MS` | Content timeout (150s default, 10–240s), code timeout (150s default, 30–240s), and content model fallback delay |
| `PEXELS_API_KEY` | Generated-site images |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_WEBHOOK_SECRET` | Live voice/chat, conversation reads, signed post-call delivery |
| `SUPABASE_DB_URL`, `SUPABASE_USAGE_SCHEMA` | Private PostgreSQL application/usage tables in fixed `everonn`; `everonn_usage` remains an optional compatibility Data API profile |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (legacy `SUPABASE_SERVICE_ROLE_KEY`) | Optional server-only Data API fallback when no DB connection string is configured |
| `USAGE_CRON_SECRET`, `USAGE_BACKGROUND_MODE`, `USAGE_REQUIRE_DURABLE_STORAGE` | Authenticated scheduled worker, local timer mode, storage enforcement |
| `GEMINI_BILLING_TIER` | Explicit paid/free or labelled list-price estimate |
| `GEMINI_BILLING_*` export variables | Dedicated project/table/service/workspace/timezone and read-only service-account credential for actual Google charges |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth |
| `CREDENTIAL_ENCRYPTION_KEY` | Token encryption and signed OAuth state; minimum 32 characters |
| `PHONE_FRONT_DESK_FOLLOW_UP_ENABLED` | Gmail owner notification switch; defaults to enabled |
| `EVERONN_DATA_FILE` | Optional local workspace JSON path |
| `EVERONN_WORKSPACES_FILE` | Optional local JSON path for additional self-registered workspaces |
| `EVERONN_CONNECTIONS_FILE` | Optional local encrypted token-store path |
| `EVERONN_AUTH_FILE` | Optional local authentication JSON path |
| `EVERONN_AUTH_SETUP_TOKEN` | Required in production before creating the first owner account |

Runtime details that commonly cause confusion:

- `features/auth/request-origin.ts` compares browser `Origin` with `NEXT_PUBLIC_APP_URL` when configured, otherwise with the request URL's origin. Only an exact HTTP(S) origin matches; client-supplied `Host` and `X-Forwarded-*` headers cannot add trusted origins. Requests without an `Origin` header retain the existing non-browser behavior.
- On Amplify, the build writer passes the public origin, server-only setup token and existing `SUPABASE_DB_URL` into `.env.production`. It requires private PostgreSQL and forces `EVERONN_REQUIRE_DURABLE_STORAGE=true`. Apply `npm run app:db:migrate` before deploying the application storage change.
- `GOOGLE_OAUTH_REDIRECT_URI` is not read; the callback is derived from the request origin or Netlify `SITE_NAME`.
- `GOOGLE_CALENDAR_SERVICE_ACCOUNT_BASE64`, `RESEND_API_KEY`, and `AUTH_EMAIL_FROM` are reported by provider-readiness code, but no current product flow uses those providers.
- `NETLIFY` and `NETLIFY_BLOBS_CONTEXT` are host-provided switches that select Blob persistence.

## 10. What is real and what is demonstration-only

### Connected implementation

- Isolated multi-workspace JSON load/save with validation and serialized writes.
- Gemini website generation, grounded chat, and appointment extraction.
- Pexels image search and selection.
- ElevenLabs browser voice/live site chat when configured.
- Private previews, multi-page generated sites, QA gates, and dynamic publication.
- Contact/lead capture and Google Calendar/Gmail follow-up.
- Google OAuth with encrypted refresh tokens.
- Credential login, separate new-customer registration, HttpOnly server sessions, password changes, first-owner setup, secure invitation acceptance, and API-level RBAC.
- Role-aware dashboard navigation and actions for owner, manager, agent, and viewer.

### Demonstration or incomplete production boundary

- The preview UI accepts the special `/preview/demo` alias when a project exists; assistant API access still requires the project's real private token.
- Marketing `components/everonn-chat.tsx` intentionally uses hardcoded product-demo replies. It is not the generated customer website assistant.
- Marketing `components/lead-form.tsx` shows success locally but does not send or save the submission.
- Subscription billing is not integrated; the Billing screen states that invoices, plan charges, and metered usage are unavailable.
- Team invitations create real accounts when accepted, but the owner must currently copy and send the invitation URL; email delivery is not connected.
- New-customer registration is rate limited, but signup email verification and an external anti-bot challenge are not connected yet.
- Self-service forgotten-password recovery and MFA are not implemented. Signed-in users can change their password in Settings.
- Contacts can be created from the dashboard with validated callback details and persisted through the workspace API.
- In-memory API rate limits reset when the server process restarts and are not shared between instances.
- Local file JSON is suitable for one writable server instance. Netlify uses strongly consistent Blob records for the primary workspace, additional workspaces, auth, and credentials.

## 11. Safe change checklist

When changing a feature:

1. Update its type in `features/everonn/types.ts` first.
2. Update JSON validation and persistence if the storage shape changes.
3. Keep provider secrets on the server; never use them in client components.
4. Preserve workspace, preview-token, or published-slug access checks.
5. Add or update tests for normalization, scope, idempotency, and failure behavior.
6. Run `npm run lint`, `npm test`, and `npm run build`.
7. Update this file when routes, modules, providers, environment variables, or implementation status change.
8. Update `PROJECT_DATA_FLOW.md` when a request path or stored-data flow changes.

## Request regression checks

`npm test` covers progressive capture, sent-email preservation, ambiguous Gmail delivery, competing workers, missing/invented times, timezone transitions, busy/disconnected/cancelled appointments, and event recovery. `npm run smoke:booking` (after a production build) starts a disposable local server with separate workspace/auth/credential files and all live providers disabled, then checks the actual dashboard and published assistant at desktop/mobile sizes. It never exercises a live Gmail send or Calendar insert.

The primary US Carpentry workspace uses carpentry services documented in its saved description and Asia/Kolkata for its Hyderabad location. Identified Northstar profile details, sample customer records, sample appointment, and sample team members were removed; unsupported after-hours sample knowledge was unapproved. Existing real Google appointments retain their original booking timezone and show a review notice when it differs from the current business timezone. The saved workspace currently contains a legacy published website. It remains available while replacement HTML/CSS designs are generated and reviewed privately.

Both voice session routes use server-only `features/voice-agent/session-prompt.ts`; client booking results remain in `session-context.ts`. The existing ElevenLabs template reads faq_notes rather than approved_instructions, so the full approved receptionist rules are supplied through both variables. Calendar/handoff/duration/language fields now match the remote template. Website and dashboard voice tools use the real lead endpoint result; booked=true requires a confirmed Calendar appointment. The configured provider key allows reading the remote agent but its prompt update request returned HTTP 401, so remote configuration was left unchanged and the supported existing dynamic-variable contract is used.

Dashboard Inbox filters now select real subsets, and authorized operators can update lead status. Contacts can be added with callback validation and their details/call/email links can be opened. The notification icon opens Inbox. Billing shows its unconnected state without fictitious subscription prices, usage, or invoice dates. Customer Settings no longer exposes the demo-reset action. Latest customer phone/email/name corrections are extracted, and newer contact records survive stale browser autosaves.
