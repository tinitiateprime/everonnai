# Public-site intelligence: current implementation

Status: implemented locally on `website-as-a-service`, 2026-10-10. This is an evidence-backed public-site assessment, with disclosed scope and gaps. It does not establish complete understanding of every original interaction, private backend or design component. See [the continuation handoff](CURRENT-WORK-HANDOFF.md) for remaining work and validation provenance.

## Implemented workflow

In `/projects`, the new website intelligence panel can start or resume discovery from the project URL, continue bounded crawl batches, freeze a source snapshot and inspect that snapshot. Partial discovery requires an explicit acknowledgment. The panel can also inspect an existing frozen snapshot after refreshing its source/history list.

Every accepted HTML capture is parsed from its complete archived HTML, separately from the legacy 12,000-character summary. Each page gets a private immutable assessment, references and optional guarded Chromium observations. Aggregation produces a private sealed JSON report with page inventory, features, assets, design tokens, navigation, findings, priorities, improvement actions and acceptance criteria. The UI has Overview, Pages, Features, Design, Findings and Improvement plan views, plus per-page details/screenshots and JSON download.

Assessment completeness and website quality are separate: `complete_within_scope` means the required assessment finished within the declared snapshot scope. It does not mean the original site has no problems, every possible URL was discovered, or all source functionality works. Missing captures, unavailable browser execution, inspection limits and unread destinations remain gaps and can make the report `partial`.

## Module responsibilities

| Module | Implemented behavior |
| --- | --- |
| `lib/intelligence/contracts.ts` | Versioned run configuration, page inventory, reference/finding types, browser observations, AI advice and sealed report |
| `extract.ts` | Cheerio inventories, business-data candidates, form/feature evidence, media/integration markers, CSS declaration tokens and deterministic metadata/content checks |
| `browser.ts` | Isolated Chromium snapshot replay, bounded guarded public GET resources, screenshots at 390/768/1440 px, computed tokens, Axe scans and limited native disclosure observations |
| `aggregate.ts` | All-page consolidation, source navigation/fragment checks, grouped findings/actions, completeness gaps and assessment methodology |
| `adviser.ts` | Optional configured-provider advice using condensed assessment evidence, the `site-growth-advisor` skill and active owner corrections; schema, evidence-ID and correction-ID validation; real model/usage metadata |
| `components/growth-advice.tsx` | Plain-language growth advice on the report Overview: customer gaps, agent enhancements, copyable agent prompt, evidence, corrections memory and advice regeneration |
| `db/migrations/0006_advice_memory.sql` | Append-only owner corrections (one-way withdrawal; column-level grants plus trigger) and immutable advice revisions, with forced project RLS |
| `service.ts` | Scoped SQL orchestration, idempotent starts, fenced page/report writes, immutable artifacts, integrity checks, private detail/report/screenshot reads |
| `components/project-intelligence.tsx` | Discovery-to-report flow, explicit partial-source acknowledgment, batch progress/resume, report/history UI |
| `lib/platform/http.ts` | Authenticated project endpoints and origin checks; trusted server-only fixture seams |
| `db/migrations/0005_site_intelligence.sql` | Intelligence runs, immutable page assessments, forced project RLS, ownership references and sealed-run protection |

Existing `lib/network.ts`, crawler, discovery snapshots, platform database/storage and provider adapters are reused. The legacy studio and the newer facts/blueprint/build workflow remain separate consumers of source evidence. Intelligence recommendations do not yet become approved blueprint requirements automatically.

## Evidence and observations

The static inventory includes page titles/descriptions/language/canonical/robots/viewport, headings, links/anchors, section excerpts, contact/address/price/JSON-LD candidates, form fields/labels/actions, media/download references, integration markers and CSS colors/fonts/spacing/radii/shadows/layout/breakpoints/custom properties. Business-data candidates are observed source evidence; they are not automatically approved facts.

The browser loads the frozen page document and fetches fresh permitted public resources through the existing guarded network layer. It records resource capture times, byte counts, hashes/outcomes, CSS evidence, a replay DOM and viewport screenshots. Consequently, page evidence and later resource observations can have different timestamps. Replay is explicitly labeled `guarded_snapshot_replay`; it is not a simultaneous original-site capture or an exact original-network performance baseline.

All browser contexts are anonymous and isolated from workspace cookies and provider credentials. Service workers, WebSockets, mutations, unsafe navigation and unsupported resources are blocked. Same-origin read requests are bounded. Original enquiry forms, booking, checkout, login, uploads and external notifications are not submitted. A blocked request is not proof that the source feature is broken.

Axe reports observed violations and inconclusive checks at desktop/mobile widths. Native `<details>` disclosure tests are limited. Other feature/integration markers identify observed or inferred UI capabilities with backend state `not_tested`, rather than certifying execution. Small-control/layout checks distinguish measured geometry from design judgments. Automated accessibility checks do not establish WCAG compliance.

Deterministic findings cover selected SEO metadata, headings, labels/alternative text, malformed JSON-LD, missing source fragments, captured broken-link responses, duplicate metadata, reachability, observed overflow/clipping, failed resources and browser runtime errors. Each finding records its kind, source references, suggested action and acceptance criteria. Some runtime/SEO interpretations require review; intended noindex/canonical choices are not blindly classified as mistakes. Search rankings and conversion gains are not predicted as verified improvements.

## Persistence and execution

SQL is authoritative for tenant/project ownership, fixed snapshot identity, run configuration, accepted assessment membership, counters, stage, lease token and report identity. Private object storage retains assessments, CSS/DOM/screenshots and the final report with verified hashes. Complete/partial sealed reports and accepted page assessments are immutable. A new request key creates a new run; it cannot rewrite earlier evidence.

The existing job/pipeline tables record actual `site_intelligence` work with the run as the job target. Stage 0 accepts pages; stage 1 aggregates and optionally obtains advice; stage 2 is sealed. Batches process two pages, with a 240-second SQL lease and five-second heartbeats. Accepted pages survive interruption and are reused on resume. The browser budget is fixed in the run: 180 requests, 24 MB and 65 seconds per page, three viewport widths. These are limits, not a completeness guarantee.

This remains request-driven execution while the workspace is open. There is no connected unattended worker. The failure-status catch path now requires the same live lease as accepted writes (matching token, `running` and unexpired): a batch that fails or is interrupted after its lease expired leaves the run untouched, and the next claim pauses the expired lease and continues from accepted pages (tested).

Full per-page evidence is retained privately. During aggregation, large section/form/JSON-LD bodies are omitted from the in-memory summary copy, not removed from accepted assessments. Inventory and advice packets are bounded, and disclosed limits make assessment gaps explicit. Some nested field/contact/structured-data caps still need more precise truncation disclosures and large-site stress checks.

## Optional provider advice

Advice reuses the configured OpenRouter/Gemini adapter and fixes provider/model identity when the run starts. Source content is supplied as untrusted evidence. Model recommendations must pass the response schema and reference known evidence IDs. Valid references do not guarantee that a model's interpretation is correct; advice remains a reviewable proposal.

Advice also follows `ai/capabilities/site-growth-advisor/SKILL.md` and returns `growth`: `customerGaps` (what the website is lacking to attract customers, from a prospective customer's view), `enhancementPlan` (how the EverOnn agent will enhance it, tied to those gaps, naming owner input that is needed instead of inventing it), `agentPrompt` (the imperative, site-specific brief the agent works from), cited `evidenceIds` and `appliedCorrectionIds`. Growth evidence IDs must be in the supplied packet; correction IDs not supplied are dropped. Structured advice requests use a 12,000-token output budget.

Owner corrections are project memory: `POST advice-corrections` stores an append-only correction (3–2,000 characters, optional run link); `POST advice-corrections/{id}/withdraw` records a one-way withdrawal. Active corrections (oldest first, at most 200) are passed to the model separately from untrusted website content, as authoritative statements about the business and its priorities that never authorise invented facts. `POST intelligence-runs/{id}/advice {requestKey}` regenerates advice for a sealed report: it re-verifies the report's identity and hash, calls the run's fixed provider/model, and stores an immutable `advice_revisions` row and private artifact recording the report hash and correction IDs used. Repeated keys replay; a key reused for another report is rejected; each report allows at most 20 revisions to bound provider spend. The sealed report and its original advice are never rewritten; the UI shows the newest revision. The workspace shows the correction form only after the agent has generated a website for the project (any `ready` build); this is a display rule, and the correction API does not itself require a build.

The fixture mode disables advice rather than fabricating model output. Missing credentials/catalogue or provider failure produces `not_configured` or `inconclusive` advice while keeping deterministic assessment available. A large advice packet fails explicitly instead of silently omitting page summaries. No new environment variables are required. Live advice was validated on 2026-10-10 with `npm run verify:advice:live -- https://example.com 5` (temporary records, deleted afterwards): 1 captured page, `complete_within_scope`, 1 browser-assessed page, 5 findings, no gaps; run fixed to OpenRouter `~google/gemini-pro-latest`, answered by `google/gemini-3.1-pro-preview` (about 6k tokens, about US$0.03–0.04 per advice call); growth text and prompt cited known evidence. After saving the correction "reference/documentation domain, not a shop", the regenerated revision reported applying it and its prompt excluded prices/bookings/checkout. In the workspace UI, growth advice was generated for an existing 28-page sealed report in 32 seconds. This validates one small site and one larger report, not advice quality across complex sites.

## API contract

Prefix: `/api/platform/projects/{projectId}`. Current project permission, session, fixed-origin mutation checks, integrity checks and private/no-store delivery apply.

| Method/path | Behavior |
| --- | --- |
| `GET /intelligence-runs` | Recent runs for this project |
| `POST /intelligence-runs` | Idempotent start from `{ snapshotId, requestKey }` |
| `GET /intelligence-runs/{id}` | Saved progress and fixed configuration |
| `POST /intelligence-runs/{id}/batch` | Execute next bounded assessment/aggregation batch |
| `GET /intelligence-runs/{id}/report` | Integrity-checked sealed report |
| `GET /intelligence-runs/{id}/report?download=1` | Same report as a private JSON attachment |
| `GET /intelligence-runs/{id}/pages/{captureId}` | Immutable full page assessment |
| `GET /intelligence-runs/{id}/pages/{captureId}/screenshots/{width}` | Accepted private PNG for 390/768/1440 |
| `GET /intelligence-runs/{id}/advice` | Project corrections (including withdrawn) and this report's advice revisions |
| `POST /intelligence-runs/{id}/advice` | Idempotent memory-aware advice revision from `{ requestKey }` (max 20 per report) |
| `GET /intelligence-runs/{id}/advice/{revisionId}` | Integrity-checked advice revision |
| `POST /advice-corrections` | Remember an owner correction `{ body, runId? }` |
| `POST /advice-corrections/{id}/withdraw` | One-way withdrawal of a correction |

The framework dispatcher still declares a 300-second hosting duration. Actual infrastructure request limits must be tested before public hosting.

## Validation and pending scope

`tests/site-intelligence.test.ts` tests actual SQL/files/Chromium/Axe against labeled public-resource fixtures. It covers three-page inventory, raw/rendered evidence, CSS tokens, source form/integration markers, observed accessibility/overflow/broken-link cases, blocked original mutations, resumable batches, lease overlap/expiry, immutable records, reference validity, anonymous/cross-project denial, private screenshots and missing-browser partial outcomes. It also covers correction validation, append-only/withdraw-once enforcement, idempotent and capped advice revisions, revision immutability, cross-project denial and expired-lease failure fencing. It does not call live AI; `tests/growth-advice.test.ts` checks the adviser against a simulated OpenRouter (skill in the prompt, only active corrections sent, 12,000-token budget, growth fields, invented correction IDs dropped, unsupplied evidence or missing growth rejected).

`scripts/platform-browser-check.ts` passed the existing-frozen-snapshot intelligence UI path on a 16-page fixture, all-page report assertions, findings, per-page mobile screenshots and improvement actions, followed by actual three-application compilation/verification, human review, enquiry/inbox, reload persistence and access checks. Its source/design responses are fixtures; SQL, storage, Chrome/Axe, compilation and feature execution are real. The single-button URL-to-new-snapshot-to-report path still needs dedicated UI regression coverage. The final handoff records the final lint/typecheck/full-suite/build results for this checkpoint.

Remaining work includes safe menu/tab/gallery observations, deeper design/component geometry, globally consolidated business knowledge, more complete cap diagnostics, large-site budgets/memory checks, live advice validation, resilient report UX/export, an approved audit-to-blueprint bridge, comparable measurements and bounded improvement loops. Private backend reconstruction, source-media rights, richer connected feature modules, unattended workers, atomic public publication/rollback and production PostgreSQL/OIDC/S3 setup remain later stages.
