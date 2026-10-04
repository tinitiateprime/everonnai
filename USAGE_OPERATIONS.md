# Provider usage deployment and recovery

All active EverOnn application and metering data is organized into separate tables under the existing Supabase project's `everonn` schema. The same private connection is used; no new AWS credential, Supabase project or exposed API schema is required. Supabase Cron and the signed ElevenLabs webhook remain configured. Scheduled HTTP success proves worker execution; verified post-call receipt requires an actual matched provider delivery. Optional Google billing export is not connected. Migration and deployment verification for this change appears below.

## Local operation

`npm run dev` starts the usage worker through Node instrumentation every minute. For a continuously running production Node server, set `USAGE_BACKGROUND_MODE=in-process`. Never use timers as the scheduler for Amplify/serverless instances. To run a separate worker:

```powershell
npm run usage:worker -- --once
npm run usage:worker
```

Use `EVERONN_USAGE_DIR` for local writable storage. The worker does not generate AI responses or voice sessions: it reads conversation metadata, replays normalized journal entries, and optionally reads Google billing. Setup/generation calls require a durable initial record before contacting the provider. Failed final writes do not issue another paid request.

## Existing Supabase project: one EverOnn schema

In Supabase **Table Editor**, refresh the page and select **everonn** in the schema dropdown. The existing owner is in **users**; EverOnn accounts are not Supabase Auth users.

| Data | Tables in everonn |
| --- | --- |
| Business/workspace | workspaces, business_profiles, business_services, knowledge_items, team_members, workspace_integrations |
| Accounts | users, auth_sessions, invitations |
| Customer operations | contacts, leads, appointments, conversations, conversation_messages |
| Generated websites | website_projects |
| Google OAuth | provider_connections (encrypted values) |
| Metering | usage_events, usage_sessions, usage_outbox, usage_claims, billing_reports |
| Background delivery | usage_worker_state, usage_job_nonces, usage_webhook_receipts, usage_system_records, worker_requests |
| Storage control | record_revisions, schema_migrations |

Each entity has its own row. JSONB payloads preserve optional/nested properties, while stored generated columns expose IDs, names, email, role/status, token totals, credits and other useful fields. Those columns are derived and read-only; edit business/account data through the application so validation, scope checks and conditional revisions run. Complex website content remains JSONB per project. Hashes and encrypted connection data are private.

Run `npm run db:migrate` for read-only status; use `npm run db:migrate -- --apply` to consolidate recognized EverOnn stores. Existing `app:db:migrate` and `usage:db:migrate` commands invoke this complete migration. Fresh setup bootstraps earlier migrations, then consolidates. Do not rerun historical SQL directly after consolidation because its old names are now views.

The transaction locks only EverOnn stores, splits existing entity/usage rows, verifies exact JSONB payloads, revisions and timestamps, then switches aliases atomically. Existing owner passwords, sessions, invitations and encrypted provider connections retain their values. It compares other-project table-content fingerprints plus schema/table/column/constraint/function/policy metadata inside the transaction; mismatches roll back. AgenticThat tables, data, privileges, Auth and exposed schema settings are never migrated.

The former `everonn_app` and `everonn_usage` names contain compatibility views/functions only, so older deployments work during rollout. Active tables all belong to `everonn`. Restricted `legacy_app_records`, `legacy_usage_records` and, when previously scheduled, `legacy_worker_requests` preserve migration snapshots; the app never writes them. The current Cron command/name and Vault secret are retained. Its private function and request history use `everonn`; reconfiguration recognizes the relational schema.

Browser roles are denied access; service_role has metering access only and cannot read users, sessions, customer data, credentials or backups. All physical tables enable RLS. Application writes use the existing server PostgreSQL connection and invoker functions. Amplify remains read-only on disk; durable storage is mandatory.

The primary seed is inserted only when absent. Deployment does not reset migrated accounts or business data; ignored local/Netlify accounts/connections are not imported automatically. Keep the existing first-owner setup token configured; it is used only before an owner exists. Normal customer registration needs no token. Consolidation does not add password recovery, email verification or MFA.

Validation uses disposable PostgreSQL-engine fixtures for round trips, CAS, scope errors, alias deletion, permissions, collisions and safe reruns. Scheduler tests cover the unchanged job/secret and reconfiguration. `npm run smoke:auth-db` exercises real production signup/login/workspace routes with blocked file writes and a database restart; it never contacts shared Supabase or paid providers.

### Migration and deployment evidence

On 2026-10-04 migration `202610040003` was applied to the supplied production database. Exact record payloads, revisions and timestamps passed the migration's round-trip comparison. The existing owner, two hashed sessions, three contacts, three leads, two appointments, one conversation and four usage events were preserved. Table-content fingerprints and object/permission metadata for 95 tables across `public`, `agentic_that` and Supabase `auth` stayed unchanged in the transaction. All RLS/privacy checks passed. The existing Cron job remained active; requests after the migration returned HTTP 200. The real usage create/read/update/stale-write/delete probe passed and removed its own test record.

All 95 unit tests, lint, the production build and `smoke:auth-db` passed for the relational change. Amplify deployment verification is pending; the existing deployed adapter continues working through compatibility views/functions. No AWS environment change is required.

Preferred configuration is a private PostgreSQL connection, with a transaction-pooler URL from the existing project's **Connect** dialog for Amplify. Copy its actual host/user rather than constructing them; percent-encode reserved characters in the password. Prepared statements and pipelining are disabled, TLS verifies the hostname/certificate using the public Supabase database CA plus system roots, and each server instance uses at most two usage connections and two application connections. A session-pooler/direct connection can also run the migration where supported by your network.

```dotenv
SUPABASE_DB_URL=the-existing-project-postgresql-connection-string
SUPABASE_USAGE_SCHEMA=everonn_usage # compatibility Data API profile; physical tables are in everonn
```

After saving these server-only variables, run:

```powershell
npm run usage:db:migrate
npm run usage:db:check -- --probe
npm run usage:db:import-local
npm run usage:db:import-local -- --apply
```

The migration only changes the new schema, with RLS enabled and no `anon`/`authenticated` schema, table or function access. The function is `SECURITY INVOKER`, not an elevated function. Private PostgreSQL access does not require changing Exposed schemas or other project settings. The connection check verifies the migration; `--probe` writes, reads, checks stale-write rejection and removes only its fresh test record. Local import retains source files, merges events/sessions through the existing ownership/deduplication guards, derives provider claims, and replays normalized outbox entries. It does not import an old worker heartbeat as evidence that the new backend is healthy.

The existing SUPABASE_USAGE_SCHEMA setting can remain in Amplify; PostgreSQL always targets fixed everonn tables after consolidation. An optional Data API fallback uses `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (legacy `SUPABASE_SERVICE_ROLE_KEY` supported) when `SUPABASE_DB_URL` is absent. For this path only, run the same migration in SQL Editor and **add** `everonn_usage` to Exposed schemas, keeping all existing entries. Never grant browser roles access. New secret keys use the `apikey` header; legacy server JWTs also use bearer authentication. All HTTP calls explicitly select the usage schema. Secret/API keys cannot themselves create database schemas.

Configured Supabase is preferred over Netlify Blobs or local files. An incomplete or unreachable configuration raises an error; it does not silently send paid requests while saving to another backend. Listings use indexed literal prefixes and keyset pagination, including when the Data API's row cap is below the requested page size. Conditional writes use a fresh UUID revision to prevent stale changes or delete/recreate races across instances.

Metering and application data use separate tables in private everonn. EverOnn and AgenticThat have separate schemas and permissions while sharing the Supabase project's capacity and plan limits. No AgenticThat data is copied into EverOnn.

On 2026-10-03, the supplied PostgreSQL connection was verified against the same project as the configured Supabase URL. The dedicated migration was applied successfully; RLS and denied browser-role access were verified on the real database. A real create/read/update/stale-write/delete probe passed and removed its own record. The existing `public`/`agentic_that` object/permission metadata fingerprint stayed unchanged. One existing local usage event was transferred, retaining its source file. These checks verify the usage backend connection; they do not imply that Amplify was redeployed or the external scheduler/webhook/billing export was activated.

## AWS Amplify deployment

The production origin is `https://main.d2b3qy6tcyxz0p.amplifyapp.com`, with Amplify app ID `d2b3qy6tcyxz0p`, branch `main`, region `us-east-1`. Use that origin without a trailing slash in production; keep localhost for local development. On 2026-10-04 the actual Amplify environment was corrected and deployments 11/12 succeeded. Deployment 12 includes the provider-generated webhook secret and a rotated scheduler secret. Live checks passed: `/api/usage` and unauthenticated jobs return 401, an authorized job returns 200 with no reconciliation error, unsigned webhooks return 401, and a signed non-usage probe returns 200 without creating usage or a verified-delivery receipt.

Deployment 13 published GitHub commit `8e516969b2bce71be247e951c1936ec26e6af333`, adding the single-use signed jobs. Its build/deployment succeeded and live concurrent verification passed (200/409). Supabase job 1 was enabled after verifying that deployed endpoint; its first automatic request at 2026-10-03 20:04 UTC (2026-10-04 01:34 IST) completed with HTTP 200 and no timeout/transport error.

Three consecutive scheduled requests at 20:04, 20:05 and 20:06 UTC returned HTTP 200. The stored heartbeat finished at 20:06:05 UTC with no error. Real checks also verified denied browser schema access, denied service-role execution of the scheduler function, and absence of the permanent credential in the Cron command and its queued requests.

The current scheduler uses Supabase Cron, described below. [infrastructure/usage-amplify.json](infrastructure/usage-amplify.json) remains an optional AWS alternative. Do not enable both. The supplied IAM user can update/redeploy Amplify but AWS denied `cloudformation:CreateUploadBucket` while uploading the template, and IAM inspection also lacked permission. No stack, Lambda or EventBridge schedule was created. Console sign-in worked; CLI sign-in's 400 error was not needed to deploy the application.

The stack creates an EventBridge schedule, a Lambda that calls the authenticated usage job once a minute, and its log group/role. The Lambda has only log permissions and no provider or database keys. Its secret matches the app's `USAGE_CRON_SECRET`. Storage is the existing Supabase project; no usage bucket or SSR storage role is created.

In Amplify, open this app's **Hosting > Environment variables**, edit the values for `main`, and set the following. The schema has already been applied to the supplied project; do not run the other application's migrations.

```dotenv
NEXT_PUBLIC_APP_URL=https://main.d2b3qy6tcyxz0p.amplifyapp.com
SUPABASE_DB_URL=the-existing-project-transaction-pooler-connection-string
SUPABASE_USAGE_SCHEMA=everonn_usage
USAGE_REQUIRE_DURABLE_STORAGE=true
USAGE_BACKGROUND_MODE=external
USAGE_CRON_SECRET=the-same-server-secret-as-the-scheduler
GEMINI_BILLING_TIER=list-price
```

Copy `SUPABASE_DB_URL` and `USAGE_CRON_SECRET` directly from the ignored local `.env.local`; the scheduler secret was rotated on 2026-10-04 and synchronized with Amplify and Vault. Do not add quotes around values in the Amplify console. The private PostgreSQL path does not require `SUPABASE_URL` or `SUPABASE_SECRET_KEY` in Amplify and leaves the existing Data API settings alone. Amplify now requires `SUPABASE_DB_URL` for application accounts/workspaces as well as usage; the usage-only Data API fallback is not sufficient for this host.

Keep `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `EVERONN_AUTH_SETUP_TOKEN`, and the existing model/media/Google settings configured for the features being used. For Google OAuth, register `https://main.d2b3qy6tcyxz0p.amplifyapp.com/api/integrations/google/callback` in Google Cloud; the app derives its callback from the public application origin. Keep `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` consistent with the existing connection setup. Do not copy a localhost app origin into production.

[amplify.yml](amplify.yml) invokes `scripts/write-amplify-env.mjs` to copy only application variables, including the server-only Supabase connection, into ignored `.env.production` before building. This is necessary because Amplify build variables are not automatically passed to Next.js SSR. The writer preserves literal dollar signs in secrets, excludes the build role's AWS credentials, and does not print values. It stops the build if the live HTTPS origin or Supabase settings are missing, or if the schema differs from `everonn_usage`. It always sets usage/application durable storage and the external worker mode. If pushing triggers a build before the environment is configured, correct the settings and redeploy the latest commit.

If deliberately switching to the AWS alternative, first disable Supabase Cron. Create the CloudFormation stack with the production origin for `ApplicationUrl` and the same local secret for `UsageCronSecret`, acknowledge its IAM role, and enable the schedule only when the deployed endpoint is ready. Use an ignored parameter file or the console's NoEcho secret field. An AWS administrator must supply the missing deployment permissions. Setting Amplify variables alone creates no scheduler.

The Usage screen should report a successful background run within a few minutes. Inspect Supabase job/HTTP status below, or CloudWatch for the AWS alternative. Failed jobs preserve a heartbeat/error state. `/api/usage/jobs` accepts POST with a server bearer credential or a valid short-lived HMAC signature. Browser cookies and workspace parameters grant no job authorization. The worker processes at most ten eligible sessions per invocation and at most 100 journal snapshots. More backlog is processed on later runs.

Accounts, workspace changes and encrypted Google connections use private PostgreSQL in everonn whenever SUPABASE_DB_URL is configured. Amplify forces EVERONN_REQUIRE_DURABLE_STORAGE=true and rejects local file fallback. Apply npm run app:db:migrate before deploying this adapter; no extra AWS connection value is needed. Do not enable file fallback in a serverless runtime to work around missing Supabase configuration: the metering pre-write intentionally stops paid calls that could not be recorded.

AWS resources have ordinary Amplify and, if the alternative stack is enabled, Lambda/EventBridge/CloudWatch charges. Supabase scheduling shares the existing project's database capacity; the app remains hosted on Amplify.

## Supabase Cron: automatic usage recovery

`npm run usage:scheduler` is a server-side administrator command using the same certificate-verified private database connection. It never loads AgenticThat migrations. Configuration is dry-run/status by default:

```powershell
npm run usage:scheduler -- --status
npm run usage:scheduler -- --apply --install-extensions --origin https://main.d2b3qy6tcyxz0p.amplifyapp.com
npm run usage:scheduler -- --enable --origin https://main.d2b3qy6tcyxz0p.amplifyapp.com
npm run usage:scheduler -- --disable
```

`--apply` configures exactly one job, `everonn_usage_worker_v1`, paused until `--enable` verifies a signed request against the deployed app. Reconfiguration pauses it again. `--install-extensions` explicitly enables missing `pg_cron`/`pg_net`; it refuses occupied unrecognized extension schemas. Both extensions were previously absent and were installed on 2026-10-04. Existing Vault and pgcrypto extensions are prerequisites and are not replaced. Never disable/drop these shared extensions to stop this one job.

The production job is currently enabled and has been observed invoking the Amplify endpoint successfully. These commands are for status/recovery; do not run `--apply` routinely, because reconfiguration pauses the active job. After changing its credential, update Amplify and redeploy, reconfigure Vault with the new matching value, then verify/enable again.

The scheduler migration targets `everonn.worker_requests` and an invoker function after consolidation; legacy names remain compatibility aliases, denied to browser/service API roles. It also adds one encrypted, namespaced Vault configuration and one Cron job. Cron/HTTP extension objects live in their provider-managed `cron`/`net` schemas; scheduling therefore adds metadata outside the usage schema while leaving existing application tables and Data API exposure unchanged. Setup checks collisions, browser access and before/after metadata for `public`/`agentic_that`, other jobs and other Vault entries inside a transaction. The real configuration check confirmed existing metadata remained unchanged.

Supabase manages `pg_net` queue permissions. **The permanent scheduler secret never enters that queue or the job command.** The private usage function reads Vault and computes a SHA-256 HMAC for a timestamp, fresh UUID nonce, POST method and exact jobs path. Only the three signed headers enter the queue. The app validates the signature, rejects timestamps older than three minutes or over 30 seconds ahead, and atomically claims the nonce in durable storage before running. Concurrent/replayed signatures return 409. The bearer path remains available for the AWS alternative and administrator checks.

The job runs every minute, skips requests still pending within their 65-second HTTP deadline, and retries on later ticks after an outage. It retains seven days of its own request IDs, nonce claims and job execution history; cleanup never targets another job. HTTP response records use pg_net's existing retention. `--status` shows this job's SQL runs and HTTP status codes without headers, secrets, provider content or raw error bodies. A successful SQL run means the HTTP request was queued: check HTTP 200 and the app heartbeat to establish successful reconciliation. Pausing the Supabase project pauses its scheduler as well.

## ElevenLabs automatic post-call delivery

In the configured ElevenLabs agent's workspace overrides, connect a **post-call transcription** webhook to:

```text
https://main.d2b3qy6tcyxz0p.amplifyapp.com/api/usage/elevenlabs/webhook
```

Use HMAC authentication and set the provider-generated secret as `ELEVENLABS_WEBHOOK_SECRET` in Amplify, then redeploy so SSR receives it. This is a different secret from `USAGE_CRON_SECRET`. Preserve existing workspace webhooks/integrations when adding this endpoint. Transcription webhook retries should be enabled. The API key used for recovery needs conversation list/read access for the configured agent. A localhost callback cannot receive provider deliveries.

On 2026-10-04 webhook `495e7cd7a3c94a1a9218a01c1051ec7e` (EverOnn usage (Amplify)) was created with HMAC and retries enabled; its secret is saved only in ignored local/server settings. After Agents Write permission was enabled on the existing key, attaching this ID under **the configured agent's** `platform_settings.workspace_overrides.webhooks` returned HTTP 200. A subsequent provider read confirmed the ID, `transcript` event and `json` format. Other agent settings and the shared workspace configuration remained unchanged; conversation list/read access also returned HTTP 200. A fresh signed non-usage probe returned HTTP 200 from the deployed endpoint without recording a delivery. No paid voice call was generated for setup. Scheduled provider metadata reads remain the unattended recovery fallback. Verify real delivery by completing a voice conversation through this application and checking **Last verified post-call delivery** after ElevenLabs finishes its analysis. Updating permissions on the same key requires no new AWS environment value.

The endpoint verifies raw-body HMAC-SHA256 with constant-time comparison and rejects timestamps more than 30 minutes old or one minute into the future. It streams at most 2 MB, validates the opaque user identity and agent, strips transcript/customer fields, and journals normalized metrics before acknowledgement. Duplicate deliveries use the same conversation identity. Late payloads cannot overwrite newer direct provider charges and request another authoritative check, including for a completed ticket. Unknown/unassigned conversations are ignored; signed webhook data from a shared agent cannot automatically authorize another workspace's usage.

Setting a secret shows verification as configured. **Last verified post-call delivery** appears only after a valid matched event actually arrives. Scheduled metadata reads remain a fallback if the browser closes or a webhook is lost. Tickets older than 24 hours remain eligible, with slower discovery after an hour/day and error backoff up to one hour. Provider fields absent after completion remain unavailable.

## Gemini estimates and actual billing

`GEMINI_BILLING_TIER` accepts `list-price` (default), `paid`, or `free`. List-price displays a labelled paid-tier estimate without assuming the account's billing tier. Supported rates are pinned to official standard text prices checked on 2026-10-03; known date changes and long-context thresholds are handled. Estimates include uncached/cached prompt tokens and generated/thinking output once. Unknown models, missing counts, tool charges and unsupported dates are unpriced. They exclude tax, discounts, cache-storage hours and other provider products. An estimated feature cost is not an invoice.

For actual reported Google charges, configure Cloud Billing export to BigQuery for a project deliberately dedicated to this workspace. Provide a separate read-only service account with BigQuery Job User on the query project and Data Viewer on the billing dataset. Configure:

```dotenv
GEMINI_BILLING_SERVICE_ACCOUNT_BASE64=base64-of-service-account-json
GEMINI_BILLING_TABLE=query-project.dataset.billing_export_table
GEMINI_BILLING_PROJECT_ID=the-dedicated-gemini-project
GEMINI_BILLING_SERVICE_ID=the-gemini-service-id-from-your-export
GEMINI_BILLING_WORKSPACE_ID=the-verified-workspace-id
GEMINI_BILLING_TIME_ZONE=Asia/Kolkata
```

Do not assign a shared project's whole bill to one customer. The service ID is deliberately explicit rather than guessing a billing service name. Query values are bound parameters; the table identifier is validated. The worker refreshes hourly, with a maximum scan of 1 GB per query and a 25-second request deadline. The report covers exported rows within the last 365 days and groups by the configured timezone and native currency. Costs include provider billing credits/refunds. Billing is a separate reported-project panel because export totals do not reliably attribute charges to individual application features. Late Google updates can change past totals; failures retain the last successful report and show an error. Final invoices remain a provider artifact.

## Recover historical or missing usage

`npm run usage:import -- path-to-manifest.json` validates and previews without writing. Add `--apply` after checking workspace, feature and provider attribution. Run with the same configured storage as the deployment. These are administrator filesystem commands, not public APIs or browser-supplied counters. They never generate paid AI calls.

For Gemini, prepare normalized records from retained provider logs/exports:

```json
{
  "version": 1,
  "workspaceId": "verified_workspace_id",
  "records": [{
    "eventId": "existing_request_id_if_repairing_a_timeout",
    "responseId": "actual_provider_response_id",
    "startedAt": "2026-10-03T09:00:00.000Z",
    "feature": "website_chat",
    "model": "gemini-3.8-flash",
    "httpStatus": 200,
    "usageMetadata": { "promptTokenCount": 120, "candidatesTokenCount": 40, "thoughtsTokenCount": 30, "totalTokenCount": 190 }
  }]
}
```

Omit `eventId` only for a historical request that has no ledger entry. An existing record must match workspace, feature, model, start timestamp and any recorded provider identity. Conflicting counts are rejected. Stable response IDs and global assignment claims prevent counting an import twice or assigning it to another request/workspace. Re-running a partly saved batch is safe. Historical imports remain marked as partial coverage: they do not invent zero-usage days around an isolated old record. No prompt/response content is persisted.

For older ElevenLabs conversations, deliberately assign selected provider IDs:

```json
{
  "version": 1,
  "provider": "elevenlabs",
  "workspaceId": "verified_workspace_id",
  "feature": "dashboard_voice",
  "agentId": "your_configured_agent_id",
  "conversationIds": ["actual_provider_conversation_id"]
}
```

The importer fetches those IDs using provider read access. Already identified conversations must match their existing workspace/feature ticket. Legacy records without a userId require the administrator's explicit attribution and receive an internal reconciliation session. A repeat import reuses it. Global provider claims reject cross-workspace or conflicting feature assignment. Missing provider fields remain null and can be rechecked later.

Gemini GenerateContent does not retain logs by default. If a timeout lost its response and no provider log/export exists, exact token counts cannot be recovered. Provider logging, when separately enabled in AI Studio, stores prompts/responses and has retention limits; this application does not enable it implicitly. No system can reconstruct usage the provider never retained or infer reliable historical features from a shared key alone. Similarly, simultaneous total storage failure and process loss can lose final response metadata. Pending records and untracked/missing chart states make these gaps visible.

## Verification

```powershell
npm run lint
npm test
npm run build
npm run smoke:usage
npm run smoke:booking
```

Smoke tests use disposable stores and mocked provider responses. Usage smoke checks real API routes, unattended job authentication/recovery, signed duplicate webhooks, exact fixture values, tenant isolation, numeric charts and mobile layout. Set `SMOKE_USAGE_ARTIFACTS=keep` to retain screenshots. Port 3000 is the default and must match the build's public app origin.

On 2026-10-04 all 84 tests, lint, production build and usage smoke passed for the signed-scheduler change. Smoke verification includes simultaneous signed requests: one succeeds and the other returns 409. PostgreSQL-engine tests use real pgcrypto signatures with the Node verifier and retain unrelated fixture jobs, Vault entries, application data and privileges. Live deployed verification is recorded separately above.

The read-only real ElevenLabs check confirmed a completed configured-agent record with integer credits, float USD cost and integer duration. Its absent historical userId demonstrates why old history needs explicit attribution. The isolated tests create no real voice session, provider configuration, AWS resource or Google billing connection. Separately authorized production setup changed Amplify variables/deployments, created the ElevenLabs webhook and configured Supabase Cron as described above; no paid AI response or voice call was generated for setup.

References: [Amplify SSR environment variables](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-environment-variables.html), [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas), [server keys](https://supabase.com/docs/guides/getting-started/api-keys), [Cron scheduling](https://supabase.com/docs/guides/cron/quickstart), [HTTP queue](https://supabase.com/docs/guides/database/extensions/pg_net), [Vault](https://supabase.com/docs/guides/database/vault), [ElevenLabs post-call webhooks](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks), [Gemini prices](https://ai.google.dev/gemini-api/docs/pricing), [Gemini logging](https://ai.google.dev/gemini-api/docs/logs-datasets), and [Google billing export](https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery).
