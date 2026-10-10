# 4. Quality and publication

Status: broader acceptance and production activation contracts. The local project flow implements [exact-build application verification](07-facts-blueprints-and-website-builds.md) plus [human preview reviews and truthful evidence reports](08-build-review-and-comparison.md). Production publication references, release approvals, deployment verification and the broader criteria below remain proposed. These requirements are not claims of tests already passed.

## Identity, readiness and completeness

Verification attaches to `buildId + sealSha256 + blueprintRevisionId + policySha256 + suiteVersion + environment`. Artifacts, source/fact references, feature versions and runtime bindings must agree. A newer edit, blueprint or configuration cannot reuse a green badge from an older build.

Execution status (`planned`, `preparing`, `generating`, `assembling`, `sealed`, `failed`, `cancelled`) is separate from derived readiness:

| Readiness             | Meaning                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `development_preview` | Safe isolated output is inspectable, but required work, checks or configuration remain; limitations displayed                            |
| `verified_preview`    | All required preview routes/content/workflows pass against the sealed build in its isolated environment; fixture/live provenance visible |
| `release_ready`       | Exact production deployment/configuration satisfies applicable gates and has current human release approval                              |
| `revoked`             | An approval, artifact, security or capability condition invalidates release eligibility; historical evidence retained                    |

Readiness is evaluated from records, not an editable Markdown note or a model's completion statement. Generation success, successful compilation, a preview URL and a high audit score each establish only their own facts.

Every required blueprint route must have its specified implementation and tests. If 45 rendered routes are required, 35 rendered routes plus ten pending records fail. An approved consolidation/redirect changes the immutable blueprint requirements; recording a missing page as excluded during generation does not satisfy them. Source coverage, approved scope coverage and target implementation coverage are separate displayed counts with explicit denominators.

Three-alternative delivery requires one qualifying sealed build in each distinct slot, using the same agreed blueprint/fact scope, passing applicable preview gates and visual-distinction review. A customer may authorize publication of one individually release-ready alternative; such publication does not make an unfinished three-alternative delivery complete.

## Acceptance criteria

Criteria are schema-validated and fixed in the approved blueprint. Each has target ID, check key/version, severity, applicability, expected value/threshold, test method and evidence requirement. Check outcomes are `pass`, `fail`, `inconclusive` or justified `not_applicable`. Required missing/unavailable checks are inconclusive and block the corresponding gate.

### Page and source-mapping gates

| Check                | Passing condition                                                                                                                             | Evidence                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Route implementation | Every required rendered route returns its correct content; approved redirects use the specified status/target; unknown routes return real 404 | Crawled deployment route inventory and response assertions                                             |
| Navigation           | Zero broken required internal links/anchors; no missing-page fallback; all required routes reachable through approved navigation/sitemap      | Link graph and browser navigation outcomes                                                             |
| Content mapping      | All mandatory source content units represented on their assigned route or approved consolidation; explicit exclusions approved in blueprint   | Source-to-target unit mapping plus checks of actual rendered output                                    |
| Protected facts      | Required names, contacts, service details, prices and material claims match the fixed fact set; no unsupported facts introduced               | Deterministic expected-value checks and review of nontrivial claims                                    |
| Policies             | Required policy/legal clauses preserved according to the owner-approved transformation rule                                                   | Clause inventory/diff and owner review; model similarity alone insufficient                            |
| Assets               | Required media loads and has correct approved identity/attribution; no invented team/work claims                                              | Asset manifest, load results, rights metadata and credit visibility                                    |
| Metadata             | Route-specific title/description, canonical policy, headings, language and applicable structured data reflect real content                    | Parsed document/schema checks and production-host configuration                                        |
| Responsive behavior  | At 390, 768 and 1440px, required content/actions visible and usable; no unintended page overflow above 1px                                    | Screenshots and browser geometry/action results; intentional accessible scroll areas tested explicitly |
| Accessibility        | Required automated checks pass, keyboard interactions work, and stipulated manual review completes                                            | Tool/version results, keyboard journeys and reviewer record                                            |

A source-to-output annotation is not proof that content is visible or truthful. Validate the resulting DOM/content, independently compare expected protected facts, and use human review where semantics/policy fidelity cannot be verified deterministically. Extractor omissions remain limitations; verification cannot reconstruct missing private or truncated evidence by guessing.

### Feature gates

Test every generated alternative's actual UI, not only the shared feature module's unit tests.

| Feature                | Passing preview contract                                                                                                                                                          | Additional production requirement                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Enquiry                | Valid submission saved exactly once under project/preview; invalid submission rejected; duplicate request returns same lead; UI reports save and notification outcomes truthfully | Designated live test verifies real persistence/notification provider as required; production recipient configured           |
| Booking                | Service/time-zone validation, availability, consent, reservation, duplicate/ambiguous-response handling and conflict presentation pass on designated test resource                | Owner-approved live test connection/resource plan and current configuration; `confirmed` only with provider-confirmed event |
| Search, if required    | Index covers approved public routes/content; expected queries return correct navigable results; no private evidence leakage                                                       | Production index/build identity and deployment binding match                                                                |
| Assistant, if required | Answers use the build's fixed facts, supported contacts/services and allowed tools; cancellation/errors handled                                                                   | Current provider connection and environment-correct capabilities; fallback never claims unavailable tool success            |

Mocked Google/mail/provider responses establish application behavior under those fixtures. They cannot demonstrate a real customer account connection. Live test records include environment, resource, time, provider outcome and authorized cleanup policy, while redacting personal data/secrets. Verification does not submit arbitrary original-site forms or create transactions without an approved plan.

A required feature with missing configuration cannot pass. An optional unavailable feature may be omitted with the blueprint's agreed behavior and an explicit report. A functional result must distinguish accepted persistence, confirmed provider effect, notification failure and unknown state; a success-colored button is not evidence.

### Build and deployment gates

1. Fixed input IDs/hashes match approved snapshot, facts, blueprint, configuration and features. All referenced artifacts exist and their checksums agree.
2. Reviewed dependency lock, type/compile/build checks and output policy pass. Generated code stays within the sandbox/import/origin policy and contains no secrets.
3. Every required page and feature gate passes. Critical/required failures and inconclusive checks remain blockers. Changing scope requires a new blueprint/build, not a manual success toggle.
4. The deployed artifact digest matches the build seal. Health, deep links, 404s, gateway calls, runtime bindings and static/application hosting behavior pass on the actual adapter.
5. Automated accessibility checks are supplemented by specified human/keyboard review. No blanket WCAG compliance claim is inferred from an axe scan; see [Playwright accessibility guidance](https://playwright.dev/docs/accessibility-testing).
6. Human design review assesses hierarchy, brand fit, copy organization, images, mobile behavior and meaningful differences between alternatives. Record reviewer identity, build seal, outcome and reasons.
7. Any blueprint performance/asset budgets pass under the declared profile. Review nonblocking warnings and tradeoffs explicitly; required budgets cannot be waived against the same approved contract.
8. Production origins, public metadata/robots/sitemap policy and feature connections are configured. Protective preview `noindex` is expected and does not establish production indexing behavior.
9. Release approval references the exact gate evaluation, artifact digest and production bindings. Approval cannot be inherited by a child build.

Candidate per-unit checks can run before sealing to guide repairs. Final acceptance runs against the assembled sealed deployment. A post-seal repair produces a new build with new evidence. If mandatory browser/tool execution is unavailable, the new pipeline reports inconclusive; the legacy optional-browser warning behavior stays confined to legacy generation.

## Measurement and comparison report

Capture baseline and alternative measurements with tool/browser versions, device/viewport, CPU/network profile, location, test routes, timestamps and fixture mode. Use at least three comparable runs for timing metrics and report median plus spread. A comparison made under materially different hosting/cache/network conditions carries that limitation; unsupported comparisons remain inconclusive.

Performance thresholds belong to blueprint criteria in native units (for example LCP milliseconds, CLS, JavaScript bytes), approved before generation. Lighthouse scores are supplementary lab observations; they do not demonstrate field behavior or increased sales. Keep lab observations separate from any later production analytics. Review performance variance using [Lighthouse performance scoring](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring).

Each report item records:

```text
findingId, sourceEvidenceIds, implementedChangeIds
buildId, sealSha256, criterionIds, testResultIds
claimKind: measured | observed | design_judgment | predicted
baselineValue, newValue, units, methodology, confidence, limitations
```

Examples: a tested broken link repaired is an observed/verified change; faster lab LCP is a measured result under its profile; premium visual quality is a reviewer judgment; more enquiries is a prediction until suitable post-release analytics support it. Report regressions and missing baseline evidence. Do not manufacture improvements from unsupported claims or hide failed criteria.

## Preview and publication identities

Each sealed build has an isolated, read-only, access-controlled preview URL such as `https://{previewHost}/projects/{projectId}/builds/{buildId}/`. Development previews clearly show limitations; verified previews display their exact evidence identity. Alternative cards select a build explicitly. Editing starts a new candidate and never overwrites an approved preview.

There is one production publication channel per project in the milestone. Its `active_deployment_id` selects a prepared immutable deployment from any one of the three alternatives. A project can have many builds and deployments; only that reference determines production traffic. Historical preview URLs remain distinct from the production domain.

Public routing resolves the active pointer through a narrow serving operation, never a general tenant-data query. For the first implementation, resolve against the authoritative database without cached HTML/pointer decisions; send production HTML with `Cache-Control: no-store`. Immutable assets use build-qualified URLs/digests and may be cached. Keep all active, in-flight and retained rollback assets/deployments available.

One response uses one sealed deployment throughout. Its assets and feature calls are pinned to that build. The hosting adapter must also pin Next.js client navigation/RSC requests to the same deployment through a signed routing context or build-qualified URLs; if it cannot, use full-document navigation. Do not route old client payloads to a different runtime implicitly.

## Prepare before activation

Deployment provisioning is outside the publication transaction. Upload/provision the complete sealed output, configure narrowly scoped runtime feature bindings, check digest/health/routes, run production-applicable verification and obtain exact-build release approval before attempting a switch. Never deploy by overwriting the directory or image currently serving production.

An object upload, infrastructure deployment and PostgreSQL transaction are separate systems. The atomic guarantee is the authoritative publication-reference change plus audit event, after the candidate is prepared. It is not a claim of a distributed transaction or an instantaneous change in every browser/CDN location. In-flight requests can finish on the previous complete build.

## Atomic publication transaction

Proposed endpoint: `POST /api/projects/{projectId}/publications/production` with target deployment ID, expected channel revision, request idempotency key and reason. Publisher permission is required. Initial publication may create a channel with null active reference at revision 0. Client-supplied tenant identity, approval status or a bare build ID cannot bypass prepared deployment checks.

1. Authenticate and authorize the actor/project. Load the prepared target by scoped identity. Reject stale/failed/mismatched build seals, missing/revoked approvals, unhealthy deployment, incompatible runtime bindings or missing required production configuration.
2. Begin a SQL transaction; lock the channel and recheck membership/approval/eligibility under the appropriate row locks. Compare the requested revision. Record target health/config evidence within the policy's approved freshness interval; do not hold locks during provider/network calls.
3. If the same request key already committed with the same payload, return the original event. Different payload or an unexpected revision returns 409 without changing traffic.
4. Update the pointer and increment revision, insert `publication_events` and the cache/notification outbox event in the same transaction. Any failure rolls everything back.
5. Return the committed event/current revision. If the HTTP reply was lost after commit, a retry/read retrieves that result and does not perform another switch.

Illustrative transaction, not an installed procedure:

```sql
BEGIN;
SELECT active_deployment_id, revision
FROM publication_channels
WHERE tenant_id = :tenant_id AND project_id = :project_id AND name = 'production'
FOR UPDATE;

-- The service checks authorization, target seal/approval/readiness and request key.
-- :previous_deployment_id is the value read under this same lock.
UPDATE publication_channels
SET active_deployment_id = :target_deployment_id, revision = revision + 1
WHERE tenant_id = :tenant_id AND project_id = :project_id
  AND name = 'production' AND revision = :expected_revision
RETURNING id, revision;
-- Zero returned rows: rollback and return 409. No event is inserted.

INSERT INTO publication_events (
  id, tenant_id, project_id, channel_id, from_deployment_id,
  to_deployment_id, expected_revision, new_revision,
  request_key, actor_user_id, action, reason, created_at
) VALUES (
  :event_id, :tenant_id, :project_id, :channel_id, :previous_deployment_id,
  :target_deployment_id, :expected_revision, :new_revision,
  :request_key, :actor_user_id, :action, :reason, now()
);
-- Insert the unique publication outbox event here too.
COMMIT;
```

Use scoped foreign keys/constraints plus a narrowly authorized service operation. SQL row locking coordinates concurrent switches; see [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html). Transactions that revoke relevant approvals/membership must participate in the same lock discipline. A worker finishing generation has no permission to execute publication.

Future CDN/edge routing adapters must document pointer propagation and cache invalidation. During propagation only complete prepared builds may serve, with consistent build-qualified assets. If an adapter cannot meet the agreed routing/cache contract, it cannot qualify for publication. DNS changes are setup operations and are not used as the atomic build switch.

## Rollback and operational compatibility

Proposed rollback endpoint uses the same transaction and permission checks, with `action = rollback`, target retained deployment, expected revision and reason. An older approval alone is insufficient: artifact availability, current health, supported gateway protocol, production configuration and security eligibility must still pass. Revoked or incompatible targets cannot be activated.

Rollback changes the website deployment reference. It does not erase enquiries, undo calendar events, revoke newer facts in the owner's project, or downgrade shared databases. Use additive/backward-compatible feature/backend changes across the supported rollback window. Credential rotation is independent of code, while unsupported feature contracts or changed non-secret behavior require new revisions and evidence.

A failure before transaction commit keeps the previous reference. A committed switch followed by an origin incident is a separate operational event: alert and perform an authorized rollback when a valid target exists. The milestone has no implicit automatic rollback policy. Reconciliation reads the channel and event history; it never guesses activation from queue status or partially completed deployment steps.

## Required verification before implementation is accepted

| Scenario                                                     | Expected result                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Blueprint requires 45 rendered routes; only 35 exist         | Required coverage fails; no complete/release-ready label                                 |
| Required enquiry/booking configuration missing               | Feature gate blocked; limitation shown; no fake success                                  |
| Edited code attempts to reuse old tests/approval             | Seal/config mismatch rejects readiness/publication                                       |
| Audit tool/browser unavailable                               | Required check inconclusive; optional comparison limitation explicit                     |
| Generation or editing runs while production serves           | Published digest/content remain unchanged                                                |
| Two publishers use the same expected revision                | Exactly one switch commits; the other gets conflict                                      |
| Pointer update succeeds but event insertion fails            | Entire transaction rolls back; old publication remains                                   |
| Switch commits but API reply is lost                         | Idempotent retry returns the same publication event                                      |
| Deployment upload/provisioning/health fails                  | Target never receives production traffic                                                 |
| Navigation/assets continue during switch                     | Each response/client context uses a coherent complete build; old assets remain available |
| Cross-project build/deployment supplied                      | Authorization/scoped FK rejection; no data or traffic change                             |
| Rollback target has incompatible gateway/current credentials | Reject or requalify before activation; no blind rollback                                 |
| Preview form/book flow exercised                             | Only preview data/designated resources affected                                          |
| Original is faster or baseline incomparable                  | Regression/limitation reported; no unsupported improvement claim                         |

Retain existing HTML, discovery, storage, booking and browser tests as migration regressions. Add database/concurrency/storage/worker integration checks and real generated-application acceptance. Mocked tests and live probes are recorded separately. Running provider-funded tests or production smoke operations follows the configured budget and authorized test plan; writing this specification performs none of those actions.
