# EverOnn AI Website as a Service: engineering specification

Status: local ownership/storage, discovery, an initial public-site intelligence report, owner-approved facts, immutable blueprints and three compiled/verified Next.js alternatives implemented. Broader production contracts remain proposed; PostgreSQL/OIDC/S3 setup is deferred to the final infrastructure stage.

Read [the current work handoff](CURRENT-WORK-HANDOFF.md) before continuing. [Public-site intelligence](09-site-intelligence-implementation.md) documents the newest modules/endpoints/evidence and their limits. Live intelligence advice, deeper interaction/design coverage, a report-to-approved-blueprint bridge, unattended workers and public publication remain pending.

[Exact-build human reviews and comparison reports](08-build-review-and-comparison.md) are also implemented locally. Preview approval, automated verification and production release approval remain separate identities. Reports expose the available evidence and missing measurements; production publication/rollback remains planned.
Baseline: branch `website-as-a-service`, commit `128a2ecf2a89be0fa04decc976eda3b63668fc3e`, inspected 2026-10-10 (Asia/Calcutta).

This specification defines the implementation against the repository baseline. The [foundation](05-foundation-implementation.md), [project discovery](06-project-discovery-implementation.md) and [facts/blueprints/Next.js builds](07-facts-blueprints-and-website-builds.md) implementation records identify available behavior and verification limits. The generated application subset now includes complete approved route coverage, exact-build functional checks and private immutable previews. Unattended worker queues, broader quality/comparison criteria and production publication remain planned. No provider credentials or customer secrets are part of these documents.

## Read the four specifications

| Specification                                            | Defines                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [Database and storage](01-database-and-storage.md)       | Entities, column contracts, ownership, immutable inputs, artifacts, integrity and migration             |
| [Job orchestration](02-job-orchestration.md)             | Dependency graph, persisted tasks, retries, leases, cancellation, resuming and budgets                  |
| [Website generation](03-website-generation.md)           | Generated Next.js project, page families, feature contracts, runtime isolation and legacy compatibility |
| [Quality and publication](04-quality-and-publication.md) | Exact-build evidence, acceptance gates, previews, approvals, atomic publication and rollback            |

The documents use the same identities and states. Examples are proposed interfaces or SQL fragments, not installed schemas, routes or executable migrations.

## Product contract and first milestone

One authorized existing website URL leads to discovery, reviewable evidence, a verified improvement blueprint, three distinct complete website alternatives, independently verified previews and a truthful comparison report. Production publication is a separate authorized operation.

The first milestone covers one real service business: its approved public content pages, preserved business facts and policies, a real enquiry workflow, notifications, and Google booking if required and configured. All three alternatives must implement the same approved functional scope. Commerce, authenticated customer portals, arbitrary backend reconstruction and bulk publishing are later extensions. Page quotas and budget limits must be disclosed before approval; they cannot silently reduce the blueprint.

Non-negotiable rules:

1. Every required blueprint route and feature passes its applicable gates. Accounted-for source URLs alone do not establish implementation completeness.
2. Required features work through supported modules. Missing configuration cannot be represented as a successful live workflow.
3. Improvement reports distinguish measured results, human design judgments and predicted business effects.
4. Build inputs are fixed: source snapshot, fact set, blueprint revision, generation configuration, feature versions and non-secret feature configuration revisions.
5. Generation and editing produce new candidates. They cannot mutate an approved or published build.
6. Only an authorized publication transaction changes the production reference, together with an audit event.

## Baseline before the foundation implementation

The studio at `/` uses browser IndexedDB drafts, server environment provider keys and an optional shared studio token (required for generation in production). There are no account memberships or tenant permissions. The current Node app generates HTML/CSS, not Next.js source projects. `/service/{business}/{1|2|3}` directly serves the latest successful artifact at that slug and version; generation and refinement can replace it immediately.

Discovery already has filesystem checkpoints, continuation, frozen discovery records and robots/network checks. It defaults to 500 successful HTML pages, can continue up to 2,000, and uses 40-page/75-second batches by default. `SourcePage.text` is limited to 12,000 characters and media/metadata are bounded. A frozen crawl is consistent captured input, not a simultaneous capture of the whole source website.

Three initial home designs are generated; a separate full-site operation plans up to 12 inner pages. Missing-page links can fall back to home. Generated documents reject forms and arbitrary scripts. A trusted assistant is supplied separately. Google Calendar/Gmail booking exists through the assistant when connected; this is not a generated contact-form backend. File and booking locks coordinate only within one Node process. Optional Chromium inspection can return a warning when unavailable. These behaviors require deliberate migration before meeting the new completion and publication contracts.

## Module decisions

Retain means preserve an existing capability and its regression coverage; it does not certify production readiness. Extend means add contracts or adapters. Replace applies to the stated implementation path, not necessarily the entire file. Create means new code or infrastructure.

| Existing module or surface                                                            | Decision                                             | Concrete treatment                                                                                                                                           |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib/network.ts`                                                                      | Retain / Extend                                      | Preserve URL validation, public-address checks, DNS pinning, redirects and resource bounds; add tenant crawl policy and isolated-worker egress controls      |
| `lib/crawler.ts`, `lib/crawl-limits.ts`                                               | Extend                                               | Keep robots/sitemap/internal-link discovery, browser rendering and checkpoints; add durable URL outcomes, per-page capture times/hashes and configured scope |
| `lib/extract.ts`                                                                      | Extend                                               | Keep contact, asset, structured-data and design extraction; archive bounded full evidence separately and emit provenance/content units                       |
| `lib/discovery-store.ts`                                                              | Extend / Replace storage path                        | Preserve snapshot/checkpoint semantics; use tenant-scoped SQL records and immutable object storage instead of unowned UUID files and process-local locks     |
| `lib/types.ts`, `lib/input.ts`                                                        | Extend                                               | Keep legacy schemas; add separately versioned project, snapshot, facts, blueprint, build and feature contracts                                               |
| `lib/source-context.ts`                                                               | Replace complete-site context path                   | Keep bounded summaries for legacy output; retrieve exact page/feature evidence and expose omissions for the application pipeline                             |
| `lib/openrouter.ts`, `lib/gemini.ts`                                                  | Retain / Extend                                      | Keep provider/error/capability abstraction; pin resolved model/configuration metadata and record attempt usage                                               |
| `lib/pexels.ts`                                                                       | Extend                                               | Preserve verified photo metadata and credits; persist permitted assets, hashes and rights metadata rather than relying solely on process caches              |
| `lib/prompts.ts`, `lib/website-skill.ts`, `ai/capabilities/website-building/SKILL.md` | Extend                                               | Preserve legacy HTML contract; introduce versioned application-stage contracts and frozen instruction artifacts                                              |
| `lib/generator.ts`                                                                    | Replace orchestration / Extend provider primitives   | Keep bounded provider calls/repair ideas; durable stage workers generate components, content and page families from a blueprint                              |
| `lib/site-pages.ts`                                                                   | Retain legacy / Replace application route path       | Keep HTML/ZIP helpers; use a full route manifest, native application links and explicit missing-route failures                                               |
| `lib/validation.ts`, `lib/visual-check.ts`                                            | Extend                                               | Preserve legacy guards; add project/compiler, content, route, feature and multi-viewport gates; required unavailable checks are inconclusive                 |
| `lib/site-store.ts`                                                                   | Replace production storage                           | Preserve legacy import/reading adapter; new builds use immutable artifacts, SQL relations and deployment references                                          |
| `lib/site-editing.ts`                                                                 | Replace new-build editing path                       | Edits fork candidate builds; fixed fact/blueprint changes create new input revisions                                                                         |
| `lib/site-serving.ts`, `app/service/[business]/[version]/**`                          | Extend compatibility / Replace production resolution | Keep mapped legacy URLs; published routing resolves an approved immutable deployment, independent of generation                                              |
| `lib/assistant.ts`, `lib/assistant-embed.ts`, assistant routes/components             | Extend                                               | Retain provider connections and trusted widget; resolve exact project/build knowledge, capability policy and preview/production environment                  |
| `lib/booking.ts`, `lib/google.ts`, `lib/google-oauth.ts`, `lib/appointment-time.ts`   | Retain / Extend                                      | Preserve validation, time handling, OAuth and provider operations; add project/resource identity, distributed reservations and recoverable effects           |
| `lib/integrations-store.ts`                                                           | Replace persistence / Retain encryption behavior     | Project/environment credentials and operational records move to secure storage; token rotation remains independent of build content                          |
| `lib/api.ts`                                                                          | Extend / Replace shared-token ownership              | Preserve bounded bodies, server-only keys and origin checks; account/project authorization and distributed quotas govern new endpoints                       |
| `lib/browser-store.ts`                                                                | Extend                                               | Keep local drafting convenience; bind drafts to user/project and treat server records as authoritative                                                       |
| `components/studio.tsx`, `components/booking-panel.tsx`                               | Extend                                               | Display source coverage, blueprint review, three alternatives, build progress, configuration, exact-build evidence and explicit publication                  |
| `app/api/{discover,plan,generate,refine}/**`, `app/api/site-pages/**`                 | Extend legacy / Create project endpoints             | Maintain migration compatibility; new job endpoints return quickly and read authorized persisted inputs                                                      |
| `tests/*`, `scripts/browser-check.ts`, live verifier scripts                          | Retain / Extend                                      | Preserve meaningful regressions; add isolation, crash/retry, full-site and publication tests; label mocked and live evidence separately                      |

The proposed module boundaries remain targets. Current implementation includes `lib/platform/`, `lib/auth/`, `lib/projects/`, `lib/storage/`, `lib/discovery/`, `lib/knowledge/`, `lib/builds/`, `lib/intelligence/` and migrations 0001–0005. Facts/blueprints share `lib/knowledge/`; compilation, verification, review and the initial enquiry contract are under `lib/builds/`; source inventory/audit reports are under `lib/intelligence/`. Steps 1–4 now have a locally verified route/content/enquiry implementation; the broader criteria in this specification, especially comparison metrics, additional feature modules, operational workers and publication, are not all complete. See the implementation records for the exact supported scope.

## Implementation order and exit criteria

| Step                             | Deliverable and exit criterion                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Ownership and durable records | Two test tenants cannot access each other's projects, jobs or artifacts; migrations/storage contracts pass; existing URLs have an explicit migration strategy          |
| 2. Capture and blueprint         | One real source yields traceable page outcomes, immutable captures/facts and an approved blueprint with per-route content/feature criteria                             |
| 3. One complete vertical slice   | Enquiry module prepared first; one candidate application builds, submits an enquiry in its isolated preview and passes exact-build checks; worker crash resumes safely |
| 4. Three full alternatives       | All approved routes and features implemented across slots 1–3; distinct design review; independent sealed deployments, evidence and preview URLs                       |
| 5. Publication and rollback      | Authorized compare-and-swap activation, audit history, stale-request rejection and failure recovery pass while the old production build remains usable                 |

Quality and ownership are present from step 1; these steps do not postpone them until after generation. A complete three-alternative delivery and a production-ready individual build are separate conditions.

## Deployment decisions

The initial contracts assume PostgreSQL, Redis-backed BullMQ execution, S3-compatible object storage, an OIDC authentication adapter and isolated Node/container application deployments with a publication resolver. The queue transports work; SQL records decide state. Static output is also supported through the hosting adapter described in the generation specification.

Before production deployment, record the chosen OIDC provider, hosting adapter, storage provider/region, secret manager, backup policy, privacy retention periods and budget/scale targets in a deployment decision record. Local adapters can exercise the contracts without a live customer deployment. Any alternative infrastructure must preserve the ownership, durability, isolation and publication invariants in these specifications. The implementation record and `.env.example` document the variables currently read by the foundation.

## Technical references

Next.js rules were checked against this installation's `node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md`, `17-deploying.md` and `02-guides/static-exports.md`. The installed version is `16.3.8`; future generated scaffolds must pin their runtime and read its corresponding guides before changes. Static export excludes request-dependent server features, so server-backed feature behavior needs a separate runtime contract.

The specifications also reference primary documentation for [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html), [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs), [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html) and [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing). Recommendations and domain schemas here are EverOnn design decisions, not guarantees supplied by those tools.
