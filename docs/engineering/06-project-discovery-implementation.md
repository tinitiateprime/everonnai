# Project discovery and immutable source snapshots

Implemented on `website-as-a-service`, following the ownership/storage foundation. This records the discovery portion of step 2. [Owner-approved facts, immutable blueprints and generated application builds](07-facts-blueprints-and-website-builds.md) are now available in the subsequent slice. Audit scoring, unattended workers and public publication remain future work.

## Available behavior

Create a project with its public source URL in `/projects`, then choose **Start new scan**. The server reads the project's stored URL; the browser cannot inject a different crawl URL, tenant identity, source pages or network policy into a scan request. Authorized editors can pause, resume, increase the page limit, retry skipped pages and freeze source snapshots. Viewers can review scan history, page outcomes, snapshots and captured content but cannot change them.

The workspace requests sequential bounded batches while open. While crawling and when reviewing a snapshot it shows only page counts (captured, pending, skipped, page limit and frozen coverage); since 2026-10-10 it no longer lists every internal page or offers a per-page captured-content viewer. The inventory and full captured evidence remain available privately through the API (`GET /snapshots/{id}`, `GET /snapshots/{id}/pages/{captureId}`, scan `pages`) and feed facts, blueprints and the intelligence report. Each batch uses the existing crawler and network guards. Closing the workspace stops subsequent requests; a server request already in flight may finish its bounded batch before its disconnect is observed. Reloading offers explicit resume from saved progress. This is request-driven execution, not an unattended worker queue. Job/run records record actual discovery execution. Fact/blueprint approval and request-stage website generation are connected in implementation slice 07; unattended orchestration remains later work.

The crawler retains robots/sitemap/internal-link traversal, guarded optional Chromium rendering, public DNS/address validation, pinned connections, redirect checks and bounded response reads. Its default initial cap remains 500 captured HTML pages, extendable to 2,000. The 12,000-URL frontier and three-times-page-limit attempt bound remain. Project batches use `CRAWL_BATCH_PAGES`, `CRAWL_CONCURRENCY` and `CRAWL_BATCH_SECONDS`, with duration capped at 45 seconds; the frozen configuration is recorded when a scan is created. The platform route now declares a 300-second hosting duration for the subsequent generation/verification stages. The host must support Node, optional Chromium and this request duration.

Coverage is explicit: captured, pending and skipped URLs; reasons, page limits, warnings and capture interval. A finished traversal can have gaps; it cannot produce a complete-coverage snapshot without an explicit partial-snapshot acknowledgment. Even complete scoped discovery does not prove business facts, source feature functionality or generated-website completion. URL inventory covers the accepted frontier, not every excluded link: external origins, account pages, files and query/filter URLs are outside scope, with limitations recorded in each snapshot.

## Storage and identities

`db/migrations/0002_project_discovery.sql` adds:

| Table              | Responsibility                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crawl_runs`       | Owned input/configuration, request idempotency key, monotonic revision, fenced lease, checkpoint reference, coverage/error state and discovery job/pipeline relationships                 |
| `page_captures`    | Immutable accepted URL outcome, requested/final URL, response status, capture/render times, response-body/text hashes, extractor version, private artifact references and bounded summary |
| `source_snapshots` | Immutable scan-revision reference, manifest artifact/hash, scope, coverage, capture interval and creator                                                                                  |
| `snapshot_pages`   | Immutable snapshot URL membership with captured/skipped/pending outcome and a capture reference constrained to the same project and scan                                                  |

All tables enforce forced RLS using current actor membership plus server-selected transaction scope. Foreign keys include tenant/project identity. Application updates are limited to mutable operational columns; evidence/snapshot UPDATE and DELETE additionally fail through database triggers. No endpoint exposes administrative SQL or accepts ownership claims from the client.

Private object storage contains:

- The complete response body accepted by the 2 MB network limit, with its SHA-256 hash. Oversized responses fail; they are not silently shortened.
- Optional rendered HTML, bounded to 3 MB, with a separate rendering timestamp.
- Versioned extraction evidence with the full normalized page text and existing bounded metadata/contact/link/design extraction. The full text's SHA-256 hash is recorded in SQL.
- Immutable checkpoint artifacts containing the frontier/visited set and coverage metadata. Captured page summaries are reconstructed from SQL rather than duplicated in every checkpoint.
- Immutable snapshot manifests containing ordered URL outcomes, capture identities/hashes/times, configuration scope and coverage.

`SourcePage.text` remains a 12,000-character summary for the legacy studio and bounded planning interfaces. `extractPage(..., { fullText: true })` supports the separate project evidence archive. Raw HTML is downloadable only as a private attachment, never executed in the workspace; full text is rendered as escaped React text. Images are references, not archived binaries. Contact/structured metadata extraction is evidence, not a verified fact set. Source objects are hidden from the private-document list.

Each object uses a server-generated immutable project key. Upload and read-back checksum verification happen before a leased SQL transaction registers the object and capture/checkpoint. An upload or registration failure cannot count a page as accepted. SQL/object storage cannot commit together: failed/repeated attempts may leave private unregistered blobs, and retention/orphan cleanup remains operational work.

## Interruption and concurrency guarantees

Scan creation accepts a UUID request key; repeated creation with the same project/key returns the same scan and discovery job. SQL advisory project locks plus a partial unique index prevent simultaneous running scans for one project. Each batch claims an increasing token with a 120-second lease. Heartbeats renew it and observe pause requests. Capture/checkpoint/finalization transactions authorize current edit access and check token, status and expiry while locking the scan row.

Expired execution is reclaimed before replacement work starts. The workspace displays interrupted execution and offers resume using the database's lease state, independent of the client's clock. A late process cannot overwrite a newer lease holder's state. Accepted captures remain immutable; resume reconstructs summaries from SQL, removes already accepted URLs from the frontier, and merges their links. The initial frontier is saved before accepting the first page. Thus captures committed after the last checkpoint survive process death without being fetched again. Persistence failures requeue work rather than masquerading as ordinary skipped source pages; concurrent page reads settle before recovery checkpointing.

Pause preserves accepted pages and the pending frontier. Source failures retain explicit skipped outcomes. **Retry skipped pages** retries eligible failures; robots-blocked URLs are preserved for review rather than overriding crawling restrictions. A fresh scan is required to refresh already accepted content. Configuration/evidence mode remains fixed for an existing scan.

Snapshots require an inactive scan and at least one accepted page. Partial coverage requires `{ allowIncomplete: true }`. Snapshot creation reads the fixed revision, uploads/verifies its manifest, then checks that revision again in a locked SQL transaction before inserting snapshot membership and audit evidence. A competing resume/scan update yields 409. Retrying a freeze for the same scan revision returns its existing snapshot. Continuing or refreshing a source cannot modify an earlier snapshot. Page evidence reads require actual membership in the requested snapshot, not just possession of a capture UUID.

## Implemented APIs

Prefix: `/api/platform/projects/{projectId}`. Existing session/origin/access checks apply, with private no-store responses.

| Method/path                                     | Contract                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /discovery-runs`                           | Latest 50 scans visible to the project viewer                                      |
| `POST /discovery-runs`                          | `{ requestKey: UUID }`; creates a queued discovery run from the stored project URL |
| `GET /discovery-runs/{runId}`                   | Persisted status, accepted count, coverage and lease state                         |
| `GET /discovery-runs/{runId}/pages?offset=0`    | Current URL outcomes, 100 per page                                                 |
| `POST /discovery-runs/{runId}/batch`            | `{ extend?: boolean, retrySkipped?: boolean }`; one bounded batch                  |
| `POST /discovery-runs/{runId}/pause`            | Ask the active batch to stop safely                                                |
| `POST /discovery-runs/{runId}/snapshots`        | `{ allowIncomplete?: boolean }`; freeze this inactive revision                     |
| `GET /snapshots`                                | Latest 100 snapshots for the project                                               |
| `GET /snapshots/{snapshotId}?offset=0`          | Integrity-checked frozen metadata and page membership, 100 per page                |
| `GET /snapshots/{snapshotId}/pages/{captureId}` | Integrity-checked full extraction evidence for a member capture                    |

Cross-project/nonexistent identities return 404, invalid inputs 400, concurrent/stale state 409, insufficient/unacknowledged coverage 422 and storage/network execution failure 503. Source/provider/database errors and credentials are not sent directly to browsers. A failed batch can leave accepted progress; its status/error and retry controls remain visible.

## Verification and production limits

`npm run test:platform` includes real SQL/PGlite and private filesystem storage checks: idempotent creation, full text beyond 12,000 characters, hashes/times, interruption, upload failure, lease overlap/expiry/late writers, snapshot immutability, tenant/viewer restrictions, retry coverage, corruption and process-style restart persistence.

`npm run test:platform:browser` starts isolated temporary storage and checks actual workspace routes and UI: scan/pause/partial freeze, count-only discovery display (no page list or viewer), full evidence via the private API, reload/resume, completed freeze, immutable old snapshots, anonymous denial, mobile sizing and logout. It also simulates expired lease metadata to verify the client recovery controls; actual expiry/reclamation and late-writer protection are covered by SQL tests. Crawling uses the explicitly labeled deterministic fixture. That fixture activates only through local mode plus both server-side test flags, never from a client request or in production; snapshots record `evidenceMode: fixture`.

`npm run verify:discovery:live -- https://example.com` separately uses real guarded network/browser crawling with temporary SQL/object storage. The 2026-10-10 probe captured one page, zero skipped/pending, complete within scope, then verified its frozen manifest and page evidence. It uses no AI keys and leaves no customer records. This small live probe is not a large-site load test.

Live PostgreSQL deployment, customer OIDC and a real S3 bucket still require service-specific validation. Distributed quotas, object-retention cleanup, database/object backups, isolated worker egress and large-site load testing remain production work. This slice does not connect project snapshots to legacy generation or certify the full SaaS platform as production complete.
