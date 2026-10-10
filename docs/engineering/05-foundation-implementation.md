# Project ownership and durable-record foundation

Implemented on the `website-as-a-service` branch. This records the first implementation slice of the [engineering specification](README.md). Subsequent slices add [project discovery](06-project-discovery-implementation.md) and [approved facts/blueprints/Next.js builds](07-facts-blueprints-and-website-builds.md). Unattended workers, broader quality/audit criteria and public publication remain later stages. External PostgreSQL/OIDC/S3 setup is deferred to the final infrastructure stage.

## Available now

`/projects` provides sign-in, tenant workspaces, project creation, three stable design-alternative identities, and private document upload/download. The studio header links to it. Projects use UUID ownership, so businesses with identical names remain separate. Alternative cards explicitly show that no website has been built yet. The existing studio still uses its original generation and saved-site flow; it is not yet attached to these project records.

`db/migrations/0001_platform_foundation.sql` installs users, hashed opaque sessions, tenants/memberships, projects/project grants, alternatives, immutable storage metadata, pipeline/job metadata and audit events in the separate `everonn_platform` schema. Migration content is checksummed; reapplying is idempotent, and editing an already-applied migration fails. Later schema changes must be new migrations.

Request transactions use `SET LOCAL ROLE everonn_platform_app`, a non-superuser, non-BYPASSRLS role, and transaction-local actor/project scope. Forced row security and scoped composite foreign keys protect records. Owners/admins can create projects; explicit project members have view/edit/review/publish grants. Member invitation and grant-management UI are not implemented yet. Access checks read current membership, so revocation affects subsequent requests.

OIDC sign-in uses `openid-client` with discovery, PKCE, state, nonce, issuer/audience validation and explicit ID-token signature verification. The transient flow cookie is encrypted/authenticated and expires after ten minutes. Sessions use random opaque cookies, store only SHA-256 token hashes and expire after eight hours. HTTPS sessions use Secure/HttpOnly `__Host-` cookies. Mutations validate against fixed `AUTH_BASE_URL`, not forwarded Host headers. Logout deletes the session. There is no shared-token shortcut into customer project ownership.

Private files use server-generated project-scoped immutable keys. SQL registration happens only after byte/checksum verification, and downloads authorize the project, recheck integrity, use attachment disposition and never execute uploaded HTML. Local files use exclusive creation; S3 writes request `If-None-Match: *` plus a SHA-256 checksum. Source material is limited to 64 MB per upload. SQL and object storage do not share a transaction; failed registrations can leave private orphan objects for future retention/cleanup tooling. No public signed-download endpoint is implemented.

This foundation installed scoped pipeline/job metadata without execution. The subsequent discovery slice now records actual bounded request-batch execution in those tables. There is no unattended queue/worker; blocked or incomplete records cannot be presented as completed websites. Immutable website builds and the production publication pointer are not implemented yet.

## Local development

```sh
npm run platform:dev
```

Open `http://localhost:3000/projects`, choose **Open local workspace**, create a workspace and a project, then upload a document. This explicit command binds the development server to `127.0.0.1` and enables local PostgreSQL-compatible PGlite storage and filesystem artifacts under ignored `data/platform/`. Set `PLATFORM_DEV_PORT` to use another port. Provider keys in `.env.local` are not rewritten.

Development sign-in uses one fixed local developer identity. It is enabled only by `PLATFORM_LOCAL_MODE=1`, `PLATFORM_DEV_AUTH=1`, a loopback origin and a non-production environment. It cannot select an arbitrary user, and production rejects it even if those flags remain set. Local PGlite mode is intended for one server process; it does not establish production concurrency, backups or external-service readiness.

## Production adapter setup

1. Provision a dedicated PostgreSQL database and migration administrator. Set `DATABASE_MIGRATION_URL` for that administrator and `DATABASE_URL` for the application login. The migration role needs schema and role administration privileges.
2. Run `npm run db:migrate`. Grant the restricted `everonn_platform_app` role to the application login using your database administrator. The application login should have no superuser/BYPASSRLS privileges and no ownership of platform tables. The migration URL is used only by the CLI; requests do not read it.
3. Configure `AUTH_BASE_URL` as the exact HTTPS workspace origin, `AUTH_OIDC_ISSUER`, client ID/secret and a 32-character-or-longer random `AUTH_SESSION_SECRET`. Register `{AUTH_BASE_URL}/api/platform/auth/callback` with the provider.
4. Configure the private S3 bucket, region, optional HTTPS-compatible endpoint and either managed AWS credentials or the explicit access-key pair. Verify conditional-write semantics, least-privilege permissions, encryption, backups and retention with the selected provider.
5. Run service-specific integration/smoke checks before exposing customer accounts. Production PostgreSQL, live OIDC and a real S3 bucket were not configured during this slice; local SQL and provider fixtures do not certify those services.

The original studio's shared-token protection and `/service/...` behavior remain separate. These new project permissions do not retroactively secure, import or publish legacy artifacts. Migration of those records requires explicit owner mapping as described in the database specification. Do not treat this foundation as a multi-tenant conversion of the old generation endpoints.

## Implemented API surface

All routes are under `/api/platform`; responses and private downloads are no-store. No endpoint accepts user/tenant ownership claims in place of a session.

| Method/path                                        | Behavior                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /session`                                     | Current session actor and safe configuration states                        |
| `GET /auth/login`                                  | Begin configured OIDC sign-in                                              |
| `GET /auth/callback`                               | Validate code/identity, set opaque session, return to projects             |
| `POST /auth/development`                           | Explicit local-only fixed developer sign-in                                |
| `POST /auth/logout`                                | Revoke current session and clear cookie                                    |
| `GET /tenants`                                     | Current user's active workspaces                                           |
| `POST /tenants`                                    | Create a workspace and owner membership atomically                         |
| `GET /projects`                                    | Only projects the actor may view                                           |
| `POST /tenants/{tenantId}/projects`                | Authorized project creation plus three alternatives and audit event        |
| `GET /projects/{projectId}`                        | Authorized project, alternative, artifact and job metadata                 |
| `POST /projects/{projectId}/artifacts`             | Authorized bounded binary upload; filename in encoded `x-file-name` header |
| `GET /projects/{projectId}/artifacts/{artifactId}` | Authorized checksum-verified private download                              |

Missing sessions return 401; cross-origin mutations return 403; unauthorized project/record identities return 404; invalid details return 400; oversize uploads return 413; missing service configuration returns 503. Provider/database error details and credentials are not returned to browsers. Distributed rate limits, account onboarding policies, automated retention and operational monitoring remain production work.

## Verification

`npm run test:platform` exercises real PostgreSQL SQL semantics through PGlite: migration repeatability, restricted roles, tenant/project isolation, current membership, composite job references, hashed/expiring/revoked sessions, immutable storage, corrupted/unverified bytes, transaction scope reset and database restart persistence. OIDC fixtures use signed RSA tokens and reject invalid signatures, issuer, audience, nonce and state. S3 command fixtures verify conditional-create requests; they are not a real-bucket probe.

`npm run test:platform:browser` starts an isolated loopback development server with temporary records and checks actual sign-in, workspace/project creation, three unbuilt alternatives, upload/download, reload persistence, anonymous denial, mobile overflow and logout. It saves an ignored mobile screenshot under `artifacts/`. `npm test`, lint/type checks, the production build and the existing browser verifier provide regression coverage. These commands use no paid AI generation calls.
