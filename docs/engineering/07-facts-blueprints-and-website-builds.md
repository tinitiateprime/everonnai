# Approved facts, immutable blueprints and complete Next.js builds

Implemented alongside project discovery on `website-as-a-service`. The local workspace now covers frozen source → owner-reviewed facts → approved page blueprint → three independently compiled and verified Next.js applications. PostgreSQL/OIDC/S3 deployment and validation are deferred to the final infrastructure stage, as requested. Current development uses persistent PGlite and private local objects.

## Local workspace repair

The reported sign-in 503 was caused by a missing parent directory for `data/platform/database`. `embeddedDatabase()` now creates the directory recursively before opening PGlite. Local initialization errors return a safe category rather than an opaque service error, without exposing paths, database credentials or provider keys. The fix was verified against the running local server. Local requests also apply newly added, checksummed migrations after hot reload; production does not automatically migrate.

## Business facts and approval

`lib/knowledge/` provides immutable fact-set revisions. Extraction reads the selected frozen snapshot and records public email/phone candidates with capture references. Multiple candidates are marked as conflicts. Business name starts from the project name and requires owner confirmation. Address/hours remain explicitly unknown until supplied; the extractor does not invent values or claim independent verification.

The owner reviews every field, confirms entered values and intentionally omits optional unknowns. Approval creates a new fact set; the draft remains intact. Required name and confirmed email have input checks. SQL records preserve the authenticated owner decision and source evidence. Fact-set metadata and documents are immutable. Source-supported extraction and owner confirmation remain distinct concepts.

Approved contact changes replace matching captured email/phone strings when preparing blueprint content. The original captures remain unchanged, and content artifacts record transformations and their approved fact-set identity. Other source text is preserved rather than rewritten by AI. This milestone has five structured public fact fields; additional services, pricing and policy copy remain in complete approved page content, not a general structured fact ontology.

## Blueprint as the build contract

A draft blueprint uses the approved fact set's exact snapshot. Each discovered URL has a proposed path and an explicit outcome: rendered page, redirect, exclusion or unresolved. Captured pages get private full-content artifacts and source capture references. Uncaptured URLs start unresolved and block approval. Exclusions require an owner-entered reason; the UI supports an explicit bulk decision for uncaptured URLs. They are never silently treated as implemented.

Owners review page titles/paths and outcomes. Home must be rendered, active paths must be unique, and redirects must target an approved rendered route. Redirecting captured content is allowed only when its normalized text matches the target; distinct content cannot disappear through a redirect. The initial limit is 2,000 rendered pages. Every approved outcome is retained in a new immutable blueprint revision. Editing requirements creates another revision; existing build references never change.

The current feature contract is an enquiry form backed by the project inbox, version 1.0.0, in private-preview mode. The owner explicitly approves this scope. Email delivery, booking, commerce and authenticated customer workflows are not fabricated or silently substituted. They require later supported modules/configuration and a new approved scope.

## Three application builds

`lib/builds/` stores build revisions per stable alternative, separate from blueprint/fact revisions. Each build fixes snapshot, fact-set and blueprint identities/hashes plus generation configuration, Node/Next version, instruction version and feature version. Actual model and usage are recorded in accepted design provenance. Request keys make build creation idempotent.

Context-aware design (`context-theme-v3`, 2026-10-10): the designer follows `ai/capabilities/website-designer/SKILL.md`, which makes it first read the business's industry, audience and the vibe that will attract them (for example warm and relaxed for a cafe; energetic, clear and credible for education) and express that as three distinct alternatives inside the same appropriate world. Its input is the approved facts, every render page with path/title/family/headings and a 700-character excerpt of its approved text, the owner's improvement brief (growth-advice agent prompt and current-site gaps) and active corrections, plus prior alternatives' context/theme/CSS. At build start, `designGuidance` fixes the brief (newest sealed report's newest available advice revision, else its own advice; source report hash and revision ID; corrections with text) into `inputs.guidance`, and `generation.designSkillSha256` pins the skill; later advice or corrections need a new build. New designs must return `context` (industry, audience, mood, vibe) and `theme` (3–8 hex palette, typography, motif) or are rejected; stored pre-v3 designs without them still validate. Structured design output uses a 16,000-token budget. `lib/builds/design-check.ts` renders each new design in Chromium against the real home title/headings/navigation using the compiler's markup and `baseCss`, at 1440 and 390 px, and rejects horizontal overflow, a squeezed or invisible hero title (<360 px desktop / <240 px mobile, or excessive line count), an unreadable content column, a hidden brand/navigation or body text under 15 px; one repair round sends the measurements back to the model, and a design still failing is rejected (422). If Chromium is unavailable this design-time check is skipped; exact-build verification still runs. `GET builds/{id}/design` returns the design name, rationale, context, theme, layout choices and whether a brief/corrections were applied (no CSS); the workspace shows it per alternative with palette swatches (`components/build-design-note.tsx`).

Live validation (2026-10-10): six designs generated through OpenRouter (Gemini 3.1 Pro and GPT-6.1 Sol alternating by slot) for a crawled cafe/lounge (openhousecafe.in) and an education site (mit.edu) read the context correctly (cafe: moody evening lounge, warm salon, sunny eclectic; education: crisp academic, open laboratory, editorial archive). In the first run, before the layout check existed, 2 of 6 had a squeezed hero; the checker flagged exactly those two and passed the other four. In the re-run with the check, all six passed on the first attempt (21–154 s each). This was a design-render check, not a full compile of those sites.

The stages are persisted and resumable:

1. Design: the existing server-side OpenRouter/Gemini adapter generates original CSS and structured layout choices for the entire approved website. Other alternatives' compositions inform the prompt. Identical CSS/composition is rejected. External CSS URLs/imports and executable CSS constructs are forbidden. Fixture output is available only through explicit local/server test flags and is labeled.
2. Compile: trusted scaffolding creates a genuine Next.js static-export project with home, nested routes, page-family markup, full approved content, navigation, metadata, safe design CSS and a trusted React enquiry component. AI cannot author runtime scripts, dependencies, filesystem paths or backend handlers. Full text is divided without losing long words or late content. All required routes are enumerated; unknown routes are real 404s.
3. Verify: checks run against the sealed output digest, covering every rendered route's complete content, route-specific titles, headings/main, approved facts, navigation reachability, redirects, desktop/tablet/mobile fit and visible content/controls, unknown-route behavior, keyboard journeys, browser runtime, backend validation and actual idempotent enquiry submission. Missing browser execution is inconclusive and blocks completion. Only passing evidence permits `ready`. Suite identity and limits are recorded in [build review and comparison](08-build-review-and-comparison.md).

Each stage claims a fenced, expiring SQL lease, checks current permissions and renews while running. Overlap and late writes are rejected. The UI proceeds through stages while open and supports resuming saved stages after reload/interruption. It offers stop after the current stage. This is persisted request-stage execution, not an unattended worker queue.

Compiler workspaces are isolated temporary directories. The compiler uses only trusted generated JSX and escaped JSON content, an allowlist of existing framework dependencies, a pinned lockfile and a child environment without provider/database credentials. It uses the installed Next.js version with Webpack and two generation workers, then removes its own temporary directory after checking the absolute cleanup path. This is a local compilation workflow; hardened containers, independent worker scheduling and distributed operational controls remain later production work.

Approved content has a disclosed 32 MB aggregate build limit; each source/output object/archive has the 64 MB artifact limit. An exceeded limit fails explicitly. It cannot reduce the page inventory or mark a partial build ready.

## Seals, previews, downloads and enquiries

Compiled source/output files and ZIPs are registered after object checksum verification. An external manifest records fixed inputs, model provenance, route/content coverage, redirects, dependency lock and exact file/object hashes. The manifest is hashed after archive creation, avoiding self-referential digests. Verification records refer to that seal and remain separate from it. SQL triggers reject mutation/deletion of verified builds and immutable inputs/files/evidence.

Private previews are scoped to exact build IDs under `/api/platform/projects/{projectId}/builds/{buildId}/preview/`. Serving checks membership, manifest integrity and selected file hashes. It serves only manifest-listed compiled output, uses no-store/noindex and a CSP allowing trusted compiler-generated scripts and same-origin feature calls. Navigation uses full-document links pinned to that build. New candidates leave earlier previews available. Public publication/rollback is not implemented in this slice.

The generated form validates name/email/message and stores a real enquiry under that exact project/build. UUID request keys prevent duplicate submissions and reject reuse with different content. Inbox reads/submissions require project edit access; viewers can review private previews but cannot write enquiries. Functional verification uses separate test submissions, which are excluded from the owner inbox. No success message claims email delivery or an external booking. Notifications/providers are deferred.

Downloads include the complete Next.js source and compiled static output. They retain their fixed private-preview base path and gateway contract. Deploying them independently requires a separate hosting/gateway binding and redirect configuration; the preview archive is not an automatically published public website.

## Schema and APIs

Migration `0003_facts_blueprints_builds.sql` adds `fact_sets`, `facts`, `blueprint_revisions`, `blueprint_pages`, `website_builds`, `build_files`, `build_checks` and `enquiries`, with forced project RLS, scoped foreign keys, immutable evidence triggers and limited operational updates. Discovery and website generation jobs record actual request execution; future pipeline stages are not represented as complete.

Prefix: `/api/platform/projects/{projectId}`. Existing authentication, fixed-origin mutation checks and no-store behavior apply. Platform requests declare a 300-second hosting duration for provider, compilation and verification stages.

| Method/path                        | Behavior                                                       |
| ---------------------------------- | -------------------------------------------------------------- |
| `GET /knowledge`                   | Fact-set and blueprint revision history                        |
| `POST /fact-sets`                  | Extract draft facts from `{ snapshotId }`                      |
| `GET /fact-sets/{id}`              | Verified document/metadata for this project                    |
| `POST /fact-sets/{id}/approve`     | Explicit decisions for every draft fact; new approved revision |
| `POST /blueprints`                 | Prepare a draft from `{ factSetId }`                           |
| `GET /blueprints/{id}`             | Fixed blueprint document/metadata                              |
| `POST /blueprints/{id}/approve`    | Explicit outcome for every draft page; new approved revision   |
| `GET /builds`                      | Recent immutable build revisions and saved stage state         |
| `POST /builds`                     | `{ blueprintId, alternativeId, requestKey }`                   |
| `GET /builds/{id}`                 | Build identity/state and exact-seal check results              |
| `POST /builds/{id}/run`            | Execute the next saved stage                                   |
| `GET /builds/{id}/preview/{path}`  | Authorized compiled page/asset, redirect or real 404           |
| `GET /builds/{id}/download/{source | output}`                                                       | Authorized ZIP download |
| `POST /builds/{id}/enquiries`      | Validated, idempotent enquiry submission                       |
| `GET /enquiries`                   | Editor's project inbox excluding verification test submissions |

## Verification scope and remaining work

`tests/website-platform.test.ts` opens a database under initially missing parent directories, uses real SQL/object storage, approves immutable inputs, compiles three real Next.js applications and verifies full text beyond 12,000 characters, long words, nested routes, browser checks and the actual enquiry backend. It also covers missing page decisions, cross-project access, immutable SQL records, CSS safety, idempotent requests and credential-free source ZIPs. AI/source responses in this test are labeled fixtures.

`scripts/platform-browser-check.ts` exercises the actual workspace approval/generation UI, three real compilations, private previews, an actual form-to-inbox submission, reload persistence, ownership, mobile layout and logout. Source/AI design use explicit fixtures; compilation, storage, SQL and functional execution are real. Existing studio regressions remain separate.

Production PostgreSQL/OIDC/S3 are deliberately deferred. Exact-build human preview reviews and evidence reports are implemented in [the next slice](08-build-review-and-comparison.md). Comparable source auditing/performance metrics, richer structured facts/features, permitted image archives, unattended workers, distributed quotas, operational restore/load testing and authorized public publication remain broader platform work. Structural/functional verification does not claim increased sales or superior visual design, and a fixture run is not evidence of live model design quality.
