# 3. Website generation

Status: proposed generated-project and feature contracts. Current `lib/generator.ts` emits validated HTML documents and `lib/site-pages.ts` supports home plus 12 inner pages. This specification adds an application pipeline alongside a compatibility adapter; it does not change the current runtime skill or remove its safety restrictions.

## Build identity and output manifest

Every candidate is one design alternative's new build revision. The three alternatives share an approved blueprint and business facts; each has its own design system, components, layouts, assets, build seal and evidence. Shared feature modules operate on the same production business data through a controlled backend. Preview data/connections are separate.

Fixed build inputs include snapshot ID/hash, fact-set ID/hash, blueprint revision/hash, generation configuration/hash, alternative ID, parent build ID if any, feature module/configuration versions, instruction artifacts, immutable build request/brief hash, asset manifest and dependency lock. Once inserted, input references never change. Candidate output may advance through persisted tasks until sealing. A sealed build's code/content/output cannot be edited; regeneration/refinement creates a child build.

The finalized external `manifest.json`, stored alongside the archives, has this required shape (UUID/hash labels are illustrative):

```json
{
  "schemaVersion": 1,
  "projectId": "project-uuid",
  "alternativeId": "alternative-uuid",
  "buildId": "build-uuid",
  "format": "nextjs",
  "deploymentMode": "static",
  "inputs": {
    "sourceSnapshotId": "snapshot-uuid",
    "sourceSnapshotSha256": "snapshot-sha256",
    "factSetId": "facts-uuid",
    "factSetSha256": "facts-sha256",
    "blueprintRevisionId": "blueprint-uuid",
    "blueprintSha256": "requirements-sha256",
    "generationConfigurationId": "config-uuid",
    "generationConfigurationSha256": "configuration-sha256",
    "buildRequestSha256": "brief-or-refinement-request-sha256"
  },
  "runtime": {
    "nodeVersion": "pinned-by-generation-configuration",
    "nextVersion": "16.3.8",
    "dependencyLockSha256": "lock-sha256",
    "sourceArchiveSha256": "source-sha256",
    "outputArchiveSha256": "output-sha256"
  },
  "routes": [
    {
      "blueprintPageId": "page-uuid",
      "path": "/",
      "family": "home",
      "outcome": "rendered",
      "contentRecordId": "home-content",
      "sourceCaptureIds": ["capture-uuid"],
      "requiredContentUnitIds": ["business-introduction"],
      "artifactSha256": "page-source-sha256"
    }
  ],
  "features": [
    {
      "key": "enquiry",
      "moduleVersion": "1.0.0",
      "configRevisionId": "feature-config-uuid",
      "protocolVersion": "1",
      "contractSha256": "feature-contract-sha256"
    }
  ],
  "assetsManifestSha256": "assets-sha256",
  "instructionsManifestSha256": "instructions-sha256"
}
```

The source project contains an input/route contract without final archive hashes. Compute source/output archive digests first, then create the external seal manifest; never embed an archive's own digest inside the archive being hashed. Test evidence is also separate from the seal manifest, so new test records do not mutate sealed artifacts.

Route records include all approved routes and redirects, plus explicit exclusions in a separate source mapping. A missing required route is a failed build, never a home-page fallback. Record actual successful model IDs and provider usage in per-task provenance; a configuration's preferred model is not proof of the model used. Do not place credentials or private lead records in a manifest.

## Generated Next.js project

```text
generated-project/
  app/
    layout.tsx
    page.tsx
    not-found.tsx
    [...segments]/page.tsx
    globals.css
    sitemap.ts
    robots.ts
  components/
    site-header.tsx
    site-footer.tsx
    page-families/
    design/
    features/
  content/
    business.json
    pages.json
    navigation.json
    assets.json
  lib/
    content.ts
    routes.ts
    feature-client.ts
  public/
    assets/
  contracts/
    build-inputs.json
    feature-contracts.json
    redirects.json
    provenance.json
  package.json
  package-lock.json
  next.config.ts
  tsconfig.json
```

`app/page.tsx` renders home; the catch-all renders known nested routes from validated content through the selected family component. `generateStaticParams()` enumerates the full non-home route manifest and unknown paths return a real 404. No arbitrary request pathname becomes a content/database query without membership validation. A catch-all is a scaffold choice; explicit route files may be used when a supported feature requires them.

Build-generated content files contain only public approved business content. Private audit evidence, source archives, OAuth state, credentials and owner correspondence stay in the control plane. Content records contain stable IDs and evidence mappings. Legal/policy clauses, names, prices and material claims have preservation requirements; rewriting requires approved policy, not an AI assumption.

The scaffold uses this repository's installed Next.js `16.3.8` as the initial pinned baseline, with exact compatible dependency versions and a reviewed lockfile. Read the matching local guides before implementation or changing versions. `output: 'export'` creates `out`; `output: 'standalone'` is the proposed Node/container package mode. These are build modes for generated projects, not changes to the existing studio's `next.config.ts`.

Use a reviewed dependency allowlist and immutable build image. AI cannot change `package.json`, the lockfile, install scripts, runtime permissions, environment variables or deployment policy without a reviewed configuration revision. Trusted scaffolding owns those files. Original design generation happens in approved component/style/content boundaries.

## Static and application modes

| Concern               | Static mode                                                                                  | Application mode                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Package               | Pre-rendered HTML/CSS/JS under `out`                                                         | Reviewed standalone Node/container output and immutable image digest                                  |
| Routes                | All approved paths enumerated at build time                                                  | Manifest-controlled routes; supported dynamic logic only                                              |
| Enquiries/booking     | Trusted client module calls a separate feature gateway                                       | Same module can use a reviewed server adapter to the feature gateway                                  |
| Private keys/database | None in bundle or browser                                                                    | Workload identity limited to required project/build feature capability; no studio/database admin keys |
| Redirects/headers     | Hosting adapter applies validated redirect/header manifests                                  | Reviewed hosting/runtime adapter applies policy                                                       |
| Images                | Permitted local optimized assets or approved loader; no default runtime optimizer assumption | Reviewed optimizer with constrained asset origins, where configured                                   |
| Assistant             | Build-scoped trusted widget with explicit gateway access                                     | Build-scoped trusted widget/server adapter                                                            |

Static export cannot provide request-dependent route handlers, cookies, Server Actions or other server-only features by itself. A static website with a working enquiry form uses a separately hosted backend and must disclose that deployment dependency in its artifact contract. Unsupported needs select application mode before generation. This follows the installed `static-exports.md` guide and [Next.js static-export documentation](https://nextjs.org/docs/app/guides/static-exports).

No UI-only placeholder may substitute for a required workflow. Configuration-required previews may show truthful availability messages; they cannot pass the required feature gate. CSP and gateway policies permit only reviewed runtime scripts/connect destinations. Legacy HTML CSP and executable-content rejection remain intact for legacy documents.

## Page families and content retrieval

For the service-business milestone, support home, about, service listing, service detail, contact, article listing/detail, gallery and policy families as needed. The approved source site determines the actual inventory. Nested routes such as `/services/ai-consulting` are preserved or explicitly redirected; current one-segment `PAGE_SLUG` constraints apply only to the legacy adapter.

Generate one high-quality family system per alternative and populate every approved record. A family component does not establish coverage unless every required record/route is present, linked and verified. Families may share components within an alternative; differences among alternatives must cover composition, typography, hierarchy/navigation and page presentation, with independent human review.

Replace complete-site use of `compactDiscovery` with authorized page-specific retrieval. Each task receives its blueprint requirements, corresponding content units, fixed facts, allowed asset IDs, relevant parent/navigation context and feature contracts. If evidence exceeds model context, split into indexed chunks/tasks and merge deterministically. Persist source-to-output mappings and any omissions. Do not silently turn a context limit into content loss.

Owner-entered facts can override extracted evidence only through a versioned owner decision/fact set. Conflicting contacts/prices/claims require resolution before the applicable gate. Existing capture truncation remains explicitly recorded until full evidence is available. An owner-approved scope reduction creates a new blueprint revision; it never edits an in-progress build's manifest.

## Feature registry and runtime contract

The registry consists of maintained implementations plus schemas and tests. AI selects supported modules and designs their surrounding UI; it does not invent backend endpoints. Each registry entry specifies:

```text
key, moduleVersion, protocolVersion
inputSchema, outputSchema, publicConfigSchema
requiredCapabilities, allowedDeploymentModes
previewConnectionRequirements, productionConnectionRequirements
componentContract, runtimeAdapter, configurationHash
acceptanceChecks, operationalHealthChecks, compatibilityPolicy
```

Initial modules:

| Module                         | Existing foundation                                                   | Required new behavior                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `enquiry`                      | Assistant callback capture in `lib/booking.ts`                        | Browser form schema/server validation, durable project-scoped leads, abuse controls, idempotent submit and notification outbox      |
| `booking.google`               | `lib/booking.ts`, `lib/google.ts`, OAuth and appointment-time helpers | Trusted UI adapter, resource/environment identity, cross-worker reservation, ambiguous-result recovery and exact response semantics |
| `assistant`                    | Existing ElevenLabs/Gemini integration                                | Project/build knowledge resolution, preview/production policy, supported tool versions and build-scoped capability                  |
| `search.local` (when approved) | No complete-site search backend                                       | Index all approved public content for that build; validate query/results and route membership                                       |

The first milestone need not include search unless the blueprint requires it. Payments, portals and CMS write workflows require their own modules/contracts before becoming supported features.

Proposed public feature gateway contracts:

| Endpoint                                                            | Input and success condition                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /public/sites/{siteId}/builds/{buildId}/capabilities`          | Allowed public configuration and current availability; excludes credentials/private data                  |
| `POST /public/sites/{siteId}/builds/{buildId}/enquiries`            | Validated contact/message plus request key → lead ID and separately reported notification state           |
| `POST /public/sites/{siteId}/builds/{buildId}/booking/availability` | Supported service/resource and exact time window → current provider-backed availability                   |
| `POST /public/sites/{siteId}/builds/{buildId}/booking/appointments` | Validated identity/slot/consent/request key → confirmed provider event or explicit pending/conflict/error |

`siteId` is a public site identity resolved server-side, not an unchecked tenant slug. A caller cannot select arbitrary credentials, resource IDs or production mode. Public form traffic has server validation, rate/abuse controls and narrowly allowed origins. Anonymous production visitors use only active/grace-period approved build capabilities. A separate expiring release-verification grant can exercise an inactive prepared production deployment solely through its owner-approved test plan/resource; ordinary preview or public clients cannot obtain that grant. Authenticated or signed preview access resolves isolated preview bindings, regardless of a client-supplied environment field.

An `Idempotency-Key` is scoped to project, environment, feature and canonical request body. Repeating the same key/body returns the same accepted result; a different body returns 409. Secrets use server-side connections/workload identity and never public capability tokens. Notification failure does not erase a saved enquiry or imply that no appointment exists.

Immutable feature configuration pins non-secret behavior such as offered services, booking duration and time zone. Operational data such as slots, new leads and credential health remains live. Credential rotation may update a secret reference without changing business facts or code. Breaking API/configuration changes require a new module/config/build revision and compatibility checks for active/rollback builds.

## Isolation and generated code controls

Build/test generated code in a restricted environment separate from the studio and feature services. Use a fixed image, nonprivileged user, CPU/memory/time/disk limits, a fresh directory and a constrained dependency-fetch mechanism. Source-website browser inspection continues through guarded network fetching. Build sandboxes cannot read `.env.local`, source service credentials, private control-plane files or the production database; block metadata/private-network access at the infrastructure egress boundary too.

Treat crawled text, source scripts and model output as untrusted. Content is evidence, never worker instructions. Validate archive paths, symlinks, imports, dependencies, inline executable payloads and external destinations before compiling. Scan output for secrets and unapproved origins. Runtime containers receive only reviewed feature capabilities; isolation is required even if a source scan passes.

Serve preview applications on a separate origin from the studio, with no studio cookies or privileged parent-window access. Embedded preview frames use a reviewed sandbox/permissions policy; interactive previews can also open top-level on that separate origin. Microphone permissions for the trusted voice widget remain explicit. Preview deployments are access controlled and `noindex`; production indexing follows owner-approved metadata and hosting policy.

## Refinement, memory and reusable artifacts

A design edit forks from a parent build while retaining its snapshot/fact/blueprint/configuration references and storing a new immutable request artifact/hash. A business fact, required route, feature or acceptance-policy change first creates approved new input revisions. Compare dependency hashes to reuse unaffected components/content objects, but assemble a new full manifest and run the new exact-build gates. Shared header/navigation/feature changes can affect every page; do not assume only the edited file needs checking.

Freeze actual skill/prompt content as instruction artifacts when generation configuration is created. Current `readWebsiteSkill()` reads a live repository file; the new pipeline cannot depend on instructions changing halfway through a run. Preserve legacy single-document instructions until the new output validator and isolation path exist. Specialized stage instructions may be introduced with the pipeline; Markdown does not determine success.

Generate `MEMORY.md` from persisted records as a concise summary of input IDs, approvals, coverage, failures and next actions. It contains no secrets and is not authoritative progress. Workers resume from job/build records even when memory is missing or stale.

## Completion and export

Deliver source archive plus lockfile, output/image digest, route/content/asset manifests, feature deployment dependencies, provenance, test evidence and build-specific preview URL. A downloadable static bundle is self-contained only for permitted packaged assets; live features still require their gateway. Application exports document their runtime requirements. Never describe a ZIP as a functioning deployed backend.

Retain legacy HTML/ZIP exports and `/service/...` links through explicit mappings. The new static/application export uses validated nested paths, real 404 behavior and complete route inventories. Refer to [quality and publication](04-quality-and-publication.md) for completion, activation and rollback; generating a bundle never publishes it.

## Required implementation checks

Compile and run real generated source for the milestone, not just mocked provider output. Check nested and unknown routes, all content records, required claims/contacts, large evidence chunking, asset rights/availability, dependency-lock rejection, secret scans, sandbox egress, preview/studio isolation, gateway tenancy, fixture/live separation, configuration-required behavior and shared-component regression after edits. Test both static export with gateway-backed features and the supported application adapter. Existing HTML validation is valuable regression coverage and cannot alone establish application correctness.
