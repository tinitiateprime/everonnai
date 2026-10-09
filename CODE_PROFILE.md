# WAAS code profile

This branch is an independent extraction of Website Studio, not the complete EverOnn platform. Production generation calls Gemini and optional Pexels; there is no template fallback. Restaurant automation, CRM, project repositories, Google OAuth and ElevenLabs execution routes are excluded.

| Module | Implemented responsibility |
| --- | --- |
| app/page.tsx, components/studio.tsx | Operator login, business editing, design brief, saved generation, previews, approval and rollback |
| app/api/waas/v1/[...path]/route.ts | Versioned server API; bearer key or operator session required |
| features/waas/auth.ts | Timing-safe key checks, signed eight-hour HttpOnly session, exact-origin checks for cookie mutations |
| features/waas/input.ts | Allowlisted profiles, 1–16 services, verified facts, HTTPS client action URLs |
| features/waas/service.ts | Site records, preferences, revision checks, build adapter, explicit approved publication, release recovery |
| features/website-studio/ | Original content/design/page generation, persistent checkpoints, leasing, QA and HTML/CSS validation |
| features/agent-runtime/, ai/ | Versioned instruction loading, general/HVAC guidance and scoped preferences; instructions confer no external execution rights |
| features/waas/render.ts | Validated HTML pages, correct private/live routes, CSP, action URLs and portable HTML export |
| lib/record-store.ts | Atomic single-process file writes or PostgreSQL transactions and row locks |
| lib/database.ts, database/schema.sql | Client-provided PostgreSQL, verified TLS, separate private waas schema; no database provision |
| features/usage/, lib/usage-store.ts | Durable pending Gemini events, token estimates, finalization outbox and replay on usage reads |
| sdk/ | Packable dependency-free server SDK with types, build/resume loop and management helpers |
| examples/ | Server integration, iframe and safe multi-page export |

Sites store the extracted business workspace shape plus action links and an optimistic edit revision. Internally workspaceId is the site ID; contacts, conversations and appointments start empty and have no client-facing backend in this package. Checkpoints, previews, release IDs and published snapshots remain server-owned.

The API key controls every site in this installation. Each client can deploy its own installation; a shared installation must be reached through a client backend that authenticates users and maps allowed site IDs. A supplied site ID alone is never a customer authorization mechanism.

Public pages are plain HTML without scripts. The selected published project and profile are snapshots; ordinary business edits and regeneration do not replace live content. Configured client action URLs are current site configuration and take effect immediately; rollback restores design/content, not those URLs. Export contains relative .html navigation, CSS and external stock-photo URLs. It needs no Node/React runtime, database or provider keys.

Environment settings are in .env.example; no browser-public secret variables are used. Production storage defaults to PostgreSQL, with explicit local storage opt-in for one server. Docker runs Next's standalone output with traced Markdown and static assets. Apply the schema using the source checkout before deploying the runtime image.

Only tests and smoke checks use fictional businesses, generated provider fixtures or embedded PostgreSQL. These never become production generation fallbacks. The production smoke server uses isolated temporary storage and no paid provider calls. See README.md and docs/API.md for setup and the API contract.

On 2026-10-09, a real Gemini/Pexels check with a fictional single-service carpentry business completed three designs with 15 validated pages, approved an isolated release and exported five HTML pages. Twenty Gemini requests were metered. This verifies provider generation using that configured account/model; it does not certify another client's quota, hosting or database. scripts/verify-live.ts requires explicit --live; source environment can optionally be selected with --env-dir and test model with --model. All test records are temporary and removed afterward.
