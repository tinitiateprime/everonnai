# Current work handoff

Checkpoint date: 2026-10-10 (Asia/Calcutta). Repository: `tinitiateprime/everonnai`. Branch: **`website-as-a-service`**. Local checkout: `C:\Users\tinit\Downloads\everonnai-website-as-a-service`. The push containing this document is the continuation checkpoint; use its commit from Git history. Earlier baseline: `128a2ecf2a89be0fa04decc976eda3b63668fc3e`.

The user requested a checkpoint/push and a truthful continuation handoff because this session was running out of context. This checkpoint contains implemented local platform work plus an initial public-site intelligence pipeline. It is **not a claim that the complete production product is finished**. Continue this code rather than replacing the architecture or rebuilding the crawler.

## User priority and product contract

The immediate priority is: **one public website URL -> comprehensive source collection within disclosed scope -> clear inventory of what exists -> evidence-backed UX/SEO/accessibility/feature/design assessment -> prioritized improvement report with acceptance criteria**. The report must explain unread/unassessed areas and distinguish observations, measurements, inferences, design judgments and predicted outcomes.

The broader product remains: frozen evidence -> approved business facts -> immutable approved improvement blueprint -> three distinct, complete, working multi-page Next.js alternatives -> verification tied to each exact build -> private customer previews and demonstrated improvements -> separately authorized atomic publication/rollback.

Non-negotiable constraints:

1. **PostgreSQL/OIDC/S3 external service setup is deferred until the very last infrastructure stage.** Continue using local PGlite and private files. Existing adapters stay in place.
2. No incomplete website is labeled complete. Every required blueprint page/feature has an implementation outcome and passes its applicable exact-build gate.
3. No fake functionality. Original UI presence does not establish a working backend. Generated features use supported implementations; missing configuration and untested integrations are disclosed.
4. No unsupported speed, accessibility-compliance, ranking, conversion or sales claims. Private/blocked/query/action pages and crawler limits cannot be hidden behind “all pages.”
5. SQL is authoritative. Immutable snapshots, approved fact sets, blueprints, builds and accepted evidence preserve their fixed identities/hashes. Source capture is not simultaneous across pages.
6. Generation/testing of a new candidate must not affect any approved/published version. Publication will be a separate explicit audited atomic operation.
7. Preserve existing guarded crawling, private storage, ownership checks, working legacy behavior and meaningful regressions.

## What exists now

| Area | Implemented local behavior | Important limitation |
| --- | --- | --- |
| Ownership/storage | `/projects`, tenants/projects/memberships/grants, hashed sessions, forced SQL RLS, immutable checksum-verified private artifacts, PGlite/local-file adapters | Live PostgreSQL/OIDC/S3 setup is not done; local auth/storage are disabled in production |
| Discovery | Existing network-safe robots/sitemap/link crawler; private full HTML/text, page hashes/timestamps, bounded resumable batches, frozen snapshots, explicit partial acknowledgment | 500 successful HTML pages initially, continuation up to 2,000; frontier/resource/robots/rendering exclusions disclosed; no guaranteed private/backend discovery |
| Facts | Source-supported business name/email/phone/address/hours candidates, conflicts, owner decisions, new immutable approved revisions | This is not yet a complete business knowledge graph; intelligence business-data candidates are not automatically approved facts |
| Blueprints | Explicit render/redirect/exclude outcomes for source URLs, required content mapping, immutable approved revision, unresolved/content-losing outcomes blocked | Audit report recommendations are not yet bound to owner-approved blueprint requirements |
| Three alternatives | Trusted Next.js source, provider-generated safe CSS/layout, real static exports, fixed inputs/configuration, source/output ZIPs, immutable revisions/seals | Current supported feature is enquiry; broader interactive modules/media work remain; static private previews are not public deployment |
| Verification | Exact-route/text/fact/title checks, reachability/redirect/404 checks, 390/768/1440 layouts, keyboard journeys, actual enquiry validation/idempotency | Browser unavailable blocks readiness; structural checks do not prove superior design, complete accessibility compliance or business gains |
| Feature/review/report | Actual project enquiry inbox; isolated test enquiries; immutable exact-build human reviews and truthful evidence/comparison JSON | No connected generated email/booking success, comparable original/generated performance baseline or production release approval |
| Intelligence | All accepted captured pages assessed; static/rendered inventories, CSS/computed design tokens, screenshots, Axe, selected UX/SEO/feature checks, cited prioritized action report and optional provider advice, including plain-language growth advice (`site-growth-advisor` skill) with owner-correction memory and immutable advice revisions | Live advice validated on one small site and one 28-page report; full design-system/interaction/backend understanding and advice quality on complex sites remain unfinished |

The original studio at `/` and public `/service/{business}/{1|2|3}` HTML generator remain a separate legacy path. Do not use its single-document limits as the specification for the newer `/projects` pipeline. Legacy voice/Google booking integrations do not automatically become generated project feature modules.

## Where to continue

Read `AGENTS.md` first. Before changing Next.js framework code, read the relevant installed guide in `node_modules/next/dist/docs/`; the installed version is **16.3.8**, including async route params. Update `CODE_PROFILE.md`, `PROJECT_DATA_FLOW.md` and `CLIENT_TECHNICAL_QA.md` when behavior/contracts change.

Engineering records:

- `docs/engineering/01` through `04`: broader target contracts, not all implemented behavior.
- `05-foundation-implementation.md`: auth, ownership, storage and local setup.
- `06-project-discovery-implementation.md`: crawl/freeze/evidence contracts.
- `07-facts-blueprints-and-website-builds.md`: supported fact/blueprint/compiler/feature/verification slice.
- `08-build-review-and-comparison.md`: exact-build human reviews and scoped claims; prior validation history.
- `09-site-intelligence-implementation.md`: current intelligence modules, evidence, APIs, scope and limitations.

Main files:

- `lib/platform/{config,database,migrations,http}.ts`, `lib/auth/`, `lib/projects/`, `lib/storage/`: platform and access/storage boundaries.
- `lib/discovery/{contracts,service,testing}.ts`, existing `lib/{crawler,network,extract}.ts`: capture and snapshots.
- `lib/knowledge/{contracts,service}.ts`: facts and blueprints.
- `lib/builds/{design,compiler,service,verification,reviews,review-contracts}.ts`: supported builds/features/reviews.
- `lib/intelligence/{contracts,extract,browser,aggregate,adviser,service}.ts`: newest work.
- `components/project-intelligence.tsx`, `project-workspace.tsx`, `project-discovery.tsx`, `project-engineering.tsx`, `project-build-review.tsx`, `app/projects/workspace.css`: workspace UI.
- `app/api/platform/[...segments]/route.ts` delegates to `lib/platform/http.ts`; new intelligence paths use `/api/platform/projects/{id}/intelligence-runs` with detail, batch, report, page assessment and screenshot routes.
- `tests/site-intelligence.test.ts`, `tests/project-discovery.test.ts`, `tests/platform.test.ts`, `tests/website-platform.test.ts`, `scripts/platform-browser-check.ts`: regression evidence.

Migrations **0001-0005** exist. `0005_site_intelligence.sql` adds runs/page assessments and sealed-evidence rules. Local requests auto-apply newly added checksummed migrations; production uses explicit migration CLI. **Never edit an already applied migration**; add the next migration for schema changes. Some local databases may already have 0005.

## New intelligence execution details

Runs fix snapshot ID/hash, rules version, live/fixture mode and configured provider/model. Stage 0 accepts two page assessments per batch; stage 1 aggregates/obtains optional advice; stage 2 seals complete or partial. Lease is 240 seconds, heartbeat five seconds. Accepted page/report writes check lease token/expiry. Resume skips accepted assessments. Final report status is `complete_within_scope` or `partial`; this describes assessment coverage, not site quality or production readiness.

Browser context is anonymous. Frozen document HTML is replayed, while allowed CSS/JS/fonts/images/read requests are fetched with public-address validation and resource limits. Screenshots are 390/768/1440 px; Axe scans desktop/mobile. Budget: 180 requests, 24 MB, 65 seconds per page. Original forms/booking/checkout/login are not submitted; unsafe requests are blocked. Fresh resources have their own timestamps and may differ from frozen document evidence. Single-run proxy timings are not comparable original-site field performance.

Original feature markers remain `observed` or `inferred`, with backend `not_tested`. Only native `<details>` state changes are exercised so far. Design inventory contains tokens and coarse feature/semantic component grouping, not a reconstructed original component library.

Advice reuses existing configured provider adapters. Fixture mode disables it. Recommendations must use known evidence IDs, but still need semantic/human review. Actual model/usage are recorded. Missing/failed provider advice leaves the deterministic report available and discloses the advice gap.

**Context-aware website designer (2026-10-10).** Builds use `instructionVersion: context-theme-v3`: the `website-designer` skill, page excerpts, and the pinned owner brief (`inputs.guidance`: growth-advice agent prompt/gaps + corrections) drive each alternative's context read and theme; a Chromium layout check (`lib/builds/design-check.ts`) with one repair round guards against squeezed/overflowing layouts. See record 07. Pending: fonts are device-installed only (no web fonts/images in generated CSS), and source captured text can include navigation noise such as "Skip to content" that the trusted template renders verbatim.

**Growth advice and memory (2026-10-10).** The adviser also follows `ai/capabilities/site-growth-advisor/SKILL.md` and returns `advice.growth`: what the site lacks to attract customers, how the EverOnn agent will enhance it, and the agent prompt, with cited evidence and applied correction IDs. Owner corrections are append-only project memory (`advice_corrections`, migration **0006**) sent to every later advice call; regenerating advice for a sealed report creates an immutable `advice_revisions` row/artifact pinned to the report hash and correction IDs (idempotent request key, max 20 per report). The sealed report is never rewritten. UI: `components/growth-advice.tsx` at the top of the report Overview. Live probe: `npm run verify:advice:live -- <url> [maxPages]` (temporary records; spends provider credit). Validated live on example.com (complete within scope, Gemini Pro via OpenRouter, correction applied in the regenerated prompt) and in the workspace UI on an existing 28-page report.

Execution is request-driven while the UI is open, with persisted resume. SQL jobs do not mean an unattended queue worker is connected. Complete/partial evidence is immutable; reassessment creates a new request-key run.

## Validation at this checkpoint

- **Passed:** latest `npm run lint` and `npm run typecheck`.
- **Passed:** `npm run test:platform:browser`, including existing frozen 16-page source -> intelligence report -> cited findings/page screenshot/actions -> all three real compiled/verified alternatives -> human review -> enquiry/inbox -> reload/access/mobile/logout.
- **Passed:** direct intelligence suite (two tests), and latest full-suite intelligence cases. Real SQL/private files/Chromium/Axe; fixture source/resources, no live AI advice.
- **Passed:** final `npm test` — 74 tests, 0 failures; final `npm run build` — Next.js 16.3.8 production build and route collection completed.
- Earlier slice: 72 tests, both legacy/workspace browser suites and production build passed. Earlier live generation probes passed against `example.com` (three alternatives before verification v2; one new Gemini alternative after v2). These are website-generation probes, not proof of current live intelligence advice or a large customer site.
- **Passed (2026-10-10 continuation):** `npm run lint`, `npm run typecheck`, `npm test` (76 tests, 0 failures, including the extended intelligence suite: advice memory/revisions, append-only corrections, revision cap/immutability, cross-project denial, expired-lease failure fencing; and `tests/growth-advice.test.ts` with a simulated OpenRouter), `npm run test:platform:browser` (passed with the growth-advice panel in the report Overview), live `npm run verify:advice:live -- https://example.com 5`, and manual workspace UI growth-advice generation on a 28-page report.
- **Not yet verified:** a scripted new-URL single-button UI regression (the live probe covers URL -> crawl -> snapshot -> report -> advice through the service layer, not the button path), the correction form clicked in a browser (covered by service tests and the live probe), advice quality on complex sites, complex real customer sites, hundreds/thousands of pages under current intelligence budgets, every safe widget state, production adapters/public deployment/load/restore.

The browser suite uses isolated `.next-platform-check`; normal dev/build use `.next`. Both are ignored appropriately; private data is under ignored `data/platform/`. Do not put test output back inside `.next/platform-check`, which production cleanup can delete. Fixtures are enabled only by explicit local/server flags. Compilation/backend execution is real, but fixture design output is not evidence of live model design quality.

## Pending work, in priority order

1. **Finish and validate the URL-to-report slice.** Add a dedicated UI regression for a fresh project URL -> crawl/continuation -> snapshot -> full report, including explicit partial acknowledgment and reload/resume. The temporary-record live advice probe exists (`npm run verify:advice:live`) and passed on example.com; repeat it on a larger permitted multi-page site and review advice quality/cost. Consider passing growth-advice corrections into blueprint requirements (item 5). Recheck misleading completeness labels against missing browser/resource evidence.
2. **Harden current persistence/limits before expanding claims.** The failure catch in `lib/intelligence/service.ts` now requires a live unexpired lease (done and tested 2026-10-10). Still validate zero-capture snapshots, repeated starts and larger reports, memory/object-size budgets, provider usage/cost limits, deadline/resume consistency, and disclosure of every nested truncation cap. Existing accepted page/report writes are already fenced.
3. **Improve real feature/design understanding.** Add safe menu/tab/gallery/navigation state observations with action allowlists and blocked mutations, richer landmark/layout/component geometry and visible-state diagnostics. Consolidate business/entity/service/contact evidence across pages, preserving conflict/provenance. Keep backend execution explicitly untested unless separately authorized and supported. Test JS-heavy pages and replay limitations; do not label blocked resource states as source defects automatically.
4. **Make the report easier to review.** Improve large-report navigation/pagination/filtering, accessible tab keyboard behavior, retry/refresh/unmount handling, source citations and clear original-vs-replay evidence. Add printable/export formats if needed. Preserve full private page evidence; avoid silently summarizing away required content.
5. **Connect findings to the approved blueprint.** Reference an exact sealed intelligence run/report hash in a new immutable blueprint revision. Require owner decisions for actionable findings and map accepted actions to page/feature acceptance criteria. Generation must retain current source/fact fidelity, all required routes, fixed revisions and exact-build gates.
6. **Complete broader delivery capabilities.** Build supported feature modules before generating their UI; integrate permitted source media and genuinely configured email/booking flows; add unattended orchestration, cancellation/retries, quotas/cost controls, stronger compiler isolation and comparable source/build measurements with bounded repair loops. Preserve truthful claims and exact-build evidence.
7. **Implement explicit public release and rollback.** Separate release approval from preview reviews, verify deployment artifacts/feature bindings, atomically switch the active approved build with audit and concurrency checks. Failed deploys/new generation must leave the previous active website available. Test failure recovery before real publication.
8. **Last: production PostgreSQL/OIDC/S3 setup and deployment operations.** Connect chosen real services, validate adapter behavior and ownership end to end, backups/restore, distributed limits, hosting bindings and operational readiness. Do not make this the first task in the next session.

## Commands and local precautions

```sh
npm ci
npm run browser:install
npm run platform:dev
npm run lint
npm run typecheck
npm test
npm run test:platform:browser
npm run test:browser
npm run build
node --import tsx --test tests/site-intelligence.test.ts
npm run verify:discovery:live -- https://example.com
npm run verify:platform:live -- --three
```

Use `npm ci` only when dependencies need restoring. Browser installation is needed only if Chromium is absent. `test:platform` currently selects the three older platform test files; `npm test` and the direct command include the new intelligence suite. No intelligence-live CLI exists yet. The last live command above is website generation and spends provider quota. Do not run it merely to demonstrate deterministic report extraction.

Preserve `.env.local`; do not print secrets or commit environment/private runtime/generated artifacts. Read `.env.example` for names/defaults. Server keys remain server-only; generated compiler subprocesses use an allowlisted environment. Do not expose workspace cookies/provider keys to source pages or submit original customer forms during inspection. Never bypass network public-address checks or use client flags to enable fixture output.

A user local dev server may already run on port 3000. Check before starting another; do not kill a user-owned server. Tests manage their own temporary server/data. One earlier interrupted browser fixture directory remains at `C:\Users\tinit\AppData\Local\Temp\everonn-platform-browser-N9UeDf`: recursive shell cleanup was blocked by automatic approval review. It is outside the repository and not part of this push; do not bypass that rejection. New test runs clean their own temporary data normally.

## Copy-paste instruction for the next ChatGPT/Codex session

> Continue EverOnn AI in repository `tinitiateprime/everonnai`, branch `website-as-a-service`, from its latest pushed checkpoint. Read `AGENTS.md`, `docs/engineering/CURRENT-WORK-HANDOFF.md`, `09-site-intelligence-implementation.md` and the living architecture guides before changing code. Our immediate goal is a reliable public-URL-to-evidence-backed inventory/audit/improvement report. Finish the pending work in the handoff priority order and use the existing crawler, network safety, snapshots, local platform and intelligence pipeline. Do not restart the architecture. Keep PostgreSQL/OIDC/S3 external setup until the very last stage. Preserve immutable source/fact/blueprint/build identities, honest coverage gaps, real supported features and exact-build verification; no invented backend success or unsupported improvement claims. First inspect current code/status and checkpoint validation, then complete the fresh-URL UI regression and live intelligence-advice validation and harden the listed lease/limits issues. Continue useful implementation autonomously, update the three living guides, run meaningful checks and report exactly what is implemented, tested, unverified and pending. Preserve `.env.local`, never print/commit secrets, and read the installed Next.js docs before framework edits. Public publication remains a separate authorized release operation.
