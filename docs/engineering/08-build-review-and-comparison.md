# Build review and truthful comparison

Implemented local preview behavior on `website-as-a-service`. Production publication, deployment bindings and release approval remain separate work. PostgreSQL/OIDC/S3 service setup remains deferred.

## Exact-build human reviews

`lib/builds/reviews.ts` records an immutable review against a verified build ID and seal. Reviewers must have current project `review` permission; edit access alone does not grant review. Owners/admins inherit review permission. A reviewer can record a review without receiving edit or publish access. Forced SQL RLS checks actor identity, scope, build readiness and matching seal independently of the UI.

Approval requires notes and explicit review of brand/layout, content/facts, mobile/keyboard use, working features/limitations and differences between alternatives. A reviewer may instead request changes. This is a human attestation; the platform cannot prove that a person actually performed the review. The application does not automatically submit a favorable human review.

Reviews are append-only. The latest decision for that exact build is displayed, while earlier decisions remain in SQL history. Changed output requires a new build and its own tests/review. A review never changes automated verification evidence, approves another alternative or authorizes a production release. Advisory transaction locks and request keys make retries safe; reusing a key with different content returns 409. Review and audit insertion commit together.

Migration `0004_build_reviews.sql` adds the immutable review table, forced RLS and a narrow review-audit policy. Project responses now disclose `canReview` separately from `canEdit`. No new environment variables or external integrations are introduced.

## Evidence report

The workspace offers evidence review and a JSON report download for any sealed candidate, including failed candidates. Reports use the exact snapshot, blueprint, manifest, check result and latest review. The evaluation digest covers the returned report body before its digest field is added. This is a reproducible evidence fingerprint, not a digital signature. Reports are derived from immutable records; SQL remains authoritative.

Reports expose source coverage with its denominator, capture interval and fixture/live provenance; required/exported pages; approved redirects; explicit exclusions; failed/inconclusive tests; reviewer decisions; and limitations. A failed candidate stays blocked even if it contains all expected files.

Claims distinguish:

- **Observed:** exact route inventory, preserved approved text, protected business details, navigation and enquiry behavior supported by the recorded tests.
- **Measured:** compiled artifact bytes. This measures artifact size only.
- **Design judgment:** the reviewer's actual notes and decision, with reviewer/build identity.
- **Predicted:** business outcomes remain unassessed until suitable production evidence exists.

No baseline speed, accessibility score, conversion or SEO measurements exist under a comparable method in this slice. Reports therefore make no improvement percentage or business uplift claim. Captured text after approved contact transformations is the content baseline; original media, private pages and extractor omissions remain limitations. AI design rationales are not treated as verified improvements.

## Stronger preview checks

New build configuration uses instruction version `original-css-family-v2`. Verification records identify suite `website-preview-v2`, the isolated local preview environment, browser version, test time, build and seal. Older records retain their historical suite identity; they are not silently relabeled as having passed newly added checks.

The suite adds route-specific titles, exact displayed facts, navigation reachability, approved 308 redirect responses, 390/768/1440 px visibility/overflow checks, a working keyboard skip link, enquiry keyboard order, backend input rejection and idempotent replay. Required text, business details and enquiry controls are checked for hiding or clipping by ancestors. Keyboard checks cover these journeys; full accessibility compliance and comprehensive manual review are not established.

The trusted scaffold keeps at most six primary header links and provides a complete home-page directory, avoiding a complete route inventory in every header. Internal navigation remains full-document and fixed to the selected build. Enquiry retries reuse the same key for identical content; editing a failed submission creates a new key. Server-side validation and ownership still apply.

CSS parsing now includes custom-property values, rejects unparsed fragments and decodes identifiers when rejecting URL/import/executable constructs. Model CSS cannot bypass the policy by storing a URL in a custom property or encoding an identifier.

## APIs and UI

All routes remain authenticated and use fixed-origin checks for mutations. Prefix: `/api/platform/projects/{projectId}`.

| Endpoint                             | Behavior                                                |
| ------------------------------------ | ------------------------------------------------------- |
| `GET /build-reviews`                 | Latest review per build visible to this project viewer  |
| `POST /builds/{id}/review`           | Record an exact-seal reviewer decision and audit event  |
| `GET /builds/{id}/report`            | Derived comparison/evidence report                      |
| `GET /builds/{id}/report?download=1` | Private JSON attachment with the same evidence contract |

`components/project-build-review.tsx` handles inspection, checklist/notes, review decisions and reports. Starting or selecting a different fact revision clears the previously selected blueprint. Selecting a historical blueprint still uses that blueprint's fixed fact/snapshot revisions, displayed explicitly. The workspace discloses text/media/feature scope and page/artifact limits before approval.

## Validation and remaining work

`tests/website-platform.test.ts` compiles and verifies real Next.js applications using labeled source/design fixtures, checks tablet/keyboard/fact/enquiry gates, rejects encoded/custom-property external CSS, exercises review-only permissions, immutable/idempotent reviews and reports, and proves a clipped replacement cannot inherit earlier readiness/review. `scripts/platform-browser-check.ts` checks the actual review UI, JSON download and reload persistence alongside generation and enquiry flows.

Browser test server output lives in `.next-platform-check`, independently of normal `.next` output. Production `next build` cleans unrecognized subdirectories inside `.next`, so placing test output there interrupted an in-flight test build; the independent directory avoids that collision. Test output is ignored by Git/ESLint and excluded from production tracing. The browser script reports generation states and fails promptly on failed or expired execution instead of waiting for a completion banner. Test processes use separate temporary SQL/object directories and clean their own process trees on normal completion. The legacy browser script also terminates its own Windows server tree.

On 2026-10-10, the separately executed live provider smoke generated three alternatives using the configured provider against `https://example.com`, with actual compilation/browser/backend execution. That three-alternative probe predates the v2 checks. After the v2 changes, a new live alternative generated by the configured Gemini model passed the current compilation/browser/backend suite. These small-source probes do not certify large customer sites or visual quality. `npm run verify:platform:live -- --three` can exercise all three alternatives under the current suite using temporary records. It spends provider quota.

Validation in this change: 72 automated tests passed across the existing regression suite and the compiled-site integration suite; both the original studio and full workspace browser checks passed, including review submission, comparison download and reload persistence. Lint, TypeScript and production compilation passed. A production build completed while the isolated workspace browser test continued successfully. Production tracing includes all four migrations and excludes environment files/private runtime data and test output. The actual local development workspace also returned HTTP 200 for sign-in and authenticated project access.

Remaining broader work includes comparable source audits/performance measurements, permitted source media, richer feature modules, unattended orchestration/cost controls, hardened compilation isolation, production deployment verification, explicit release approval, atomic publication/rollback and operational recovery/load checks. A preview review/report is not a claim that these requirements are implemented.
