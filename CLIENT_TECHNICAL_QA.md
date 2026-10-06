# EverOnn client technical Q&A

Use this as a meeting cheat sheet. The first sentence under each question is the short answer to say aloud; the rest explains where it happens in code.

For the full code map, see [CODE_PROFILE.md](CODE_PROFILE.md). For diagrams, see [PROJECT_DATA_FLOW.md](PROJECT_DATA_FLOW.md).

## Website generation

### 1. From which API call is the website generated?

**Short answer:** The owner calls `POST /api/website-studio`, with streamed progress in the dashboard. Gemini first plans grounded business content, then generates actual multi-page HTML and CSS for three independent design directions.

The route loads the saved profile and approved scoped preferences, composes Markdown skills, validates the content plan, resolves available Pexels photos, and requests the original website code. Invalid content receives one repair per model with its original output and the exact failed checks; each invalid code batch receives one bounded repair. Persistent failure shows the specific problem and preserves the previous website. A successful request saves a private draft; an existing published version stays live. All provider requests, repairs and rejected output are metered.

### 2. Which exact external AI endpoint is called?

**Short answer:** The server sends a POST request to Google’s Gemini REST endpoint for the selected model.

```text
https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
```

The API key is read on the server from `GEMINI_API_KEY` or the `GOOGLE_API_KEY` fallback. It is not sent to the browser.

### 3. Which Gemini model is used?

**Short answer:** Models are tried in the order configured in `GEMINI_WEBSITE_MODELS`, then `GEMINI_WEBSITE_MODEL`, then `GEMINI_MODEL`, with `gemini-3.8-flash` as the default fallback. The code stage starts with the model that produced the content plan, then uses configured Gemini alternatives if a page batch times out or encounters a transient provider error. Each concept records its successful code models separately.

The successful model is saved in `websiteProject.generation.model`, so the dashboard can show which model generated that site.

### 4. What information is sent to Gemini?

**Short answer:** Gemini receives the approved business profile, active services, knowledge, business facts, and strict rules about what it may and may not invent.

The website prompt is built by `buildWebsitePrompt()` in `features/website-studio/prompt.ts` using the shared Markdown composer. It includes the saved profile, active services, approved knowledge, and scoped owner design preferences, and asks for structured content for:

- homepage;
- services index;
- one page per active service;
- About page;
- Contact page;
- FAQ, SEO, brand direction, calls to action, and image-search instructions.

### 5. Is the generated website hardcoded?

**Short answer:** New websites use Gemini-generated HTML page structure and CSS, not predefined page layouts.

`code-generator.ts` creates the page documents and stylesheet. Benign inline CSS is parsed and moved into generated classes; malformed or resource-loading CSS is rejected, and stored page HTML contains no inline styles. `code-validation.ts` validates and scopes them; the renderer presents that artifact. Application code supplies secure booking/chat/voice controls, preview notices, authentication and publishing. Saved older publications retain an isolated compatibility reader until replaced; new generation has no static fallback.

### 6. Does Gemini generate three completely different websites?

**Short answer:** It generates three separate multi-page HTML/CSS artifacts. Editorial, Momentum and Aura are comparison labels, not fixed themes.

Exact duplicate artifacts are rejected. The industry skill, business facts and owner's preferences guide the design. Structural checks and local browser reviews help assess quality, but visual distinction and quality still need owner review.

### 7. How are multiple pages created?

**Short answer:** Gemini returns HTML, titles and descriptions for Home, Services, each active service, About and Contact.

Each concept first generates its own CSS and homepage. Remaining pages are requested in batches of at most three, reusing that same design system. This avoids sending all 17 pages of a 13-service business in one response. Up to three code requests run concurrently; retries keep completed batches in memory. Validation checks every route exists, navigation works, the index links to each actual service, and detail pages identify the correct service. The server rewrites links for the exact private preview or public site. CSS is original to each concept, with responsive rules. Native details/summary provide menus and FAQs; platform actions connect to secure forms and the assistant.

The progress stream reports planning, imagery, completed pages and saving. A timeout retry affects its page batch, not already completed pages. An exhausted retry identifies the concept and routes. There is no durable background job yet: hosting must allow the full request, and process loss still requires another build.

### 8. Where do generated website images come from?

**Short answer:** Gemini describes the required photography, then the server searches Pexels for relevant images.

`resolveWebsiteMedia()` calls:

```text
GET https://api.pexels.com/v1/search
```

It searches separately for hero, gallery, and service images, prefers wide high-resolution photos, ranks relevance, and avoids duplicate photos and photographers when possible.

### 9. What happens if Pexels is not configured or a search fails?

**Short answer:** Website content can still be generated, but missing images remain empty and the API reports a media warning.

Pexels is optional for content generation. `PEXELS_API_KEY` is required for real generated photography.

### 10. How do we stop Gemini from inventing services or false claims?

**Short answer:** EverOnn uses a strict response schema, normalizes results against the approved service list, and runs QA before accepting the project.

QA checks include:

- all active services are present;
- no new services were invented;
- every service has a complete page;
- no placeholder text exists;
- unsupported awards, guarantees, credentials, statistics, and similar claims are rejected;
- owner verification and a real contact path exist.

Grounding checks inspect actual website copy, SEO, image/accessibility descriptions and CSS-generated text. Internal design explanations, image-search terms and structural class names are excluded. For example, invented "Certified HVAC inspections" is rejected unless supported by approved facts; a design note saying to avoid invented certification is not a public claim. Rejected content can be repaired once per model without removing this protection.

### 11. Where is the generated website saved?

**Short answer:** The current draft is `workspace.websiteProject`; its original HTML/CSS is in `spec.code`. The live snapshot is `publishedWebsite`, with three earlier versions in `websiteReleases`.

Amplify persists this through the existing private Supabase workspace envelope and project payload. JSON/Netlify Blobs remain available for their configured runtimes. Credentials never enter the website artifact. No additional database migration is required for these fields.

### 12. Does changing Knowledge automatically change the existing website?

**Short answer:** It changes AI chat and new voice sessions immediately after saving, but the website must be regenerated to rebuild its copy, pages, and images.

This protects a published site from changing unexpectedly whenever an owner edits a draft knowledge answer.

### 13. How is a website published?

**Short answer:** The owner selects a design and completes Generated, Claimed, Verified, Approved and Published in order.

The status API checks permissions, current facts, generated-code validation and grounding QA, then atomically switches the live release. Regeneration keeps the existing live site available. Owners can restore one of three earlier releases; stale rollback requests return 409. An already published design cannot be changed through concept selection without a new reviewed draft.

### 14. Where is the public website rendered?

**Short answer:** Published sites are server-rendered under `/sites/[publicSlug]`, from the live release snapshot.

The route returns 404 for unknown slugs/pages or absent publications. Each generated page supplies SEO metadata. Chat and booking use current server-side business facts while the visual site remains the approved published snapshot.

## AI chat and voice

### 15. Do website chat and voice use the same business knowledge?

**Short answer:** Yes. Both are built from the same saved `BusinessProfile` and approved knowledge.

`features/agent-runtime/prompt-composer.ts` combines shared assistant/booking Markdown, the explicitly selected domain, and the structured business profile. `features/voice-agent/session-prompt.ts` supplies this to ElevenLabs. Gemini uses the same skill boundary and checks immediate safety before booking clarification.

### 16. Which API handles customer website chat?

**Short answer:** The site first calls `POST /api/site-assistant/session` for an ElevenLabs live session; if live text cannot connect, it uses `POST /api/assistant/message` for Gemini chat.

Voice uses ElevenLabs WebRTC. Live text uses an ElevenLabs WebSocket. Gemini is the text fallback, not a voice fallback.

### 17. Are the AI responses hardcoded?

**Short answer:** Customer generated-site responses are AI-generated; only the main EverOnn marketing-site demo widget uses a small set of scripted product answers.

This distinction matters:

- `components/preview/website-assistant.tsx` is the real customer-site AI assistant.
- `components/everonn-chat.tsx` is clearly labeled as an interactive marketing demonstration.

### 18. Are ElevenLabs and Gemini API keys exposed to visitors?

**Short answer:** No. Secret provider keys stay on the server.

The browser receives only a short-lived ElevenLabs conversation token or signed session URL. Gemini calls happen inside server route handlers.

## Leads, appointments, and email

### 19. How does a chat or call become a lead?

**Short answer:** When the transcript contains a phone number or email, the browser sends the extracted customer details to `POST /api/site-assistant/lead`.

That route validates access and saves progressive customer details under one request ID while preserving prior provider results. Automation starts on final submission, Finish & save, voice disconnect, or closing the public assistant. Capturing a contact alone does not trigger an email or allocate a booking time.

### 20. How is an appointment created?

**Short answer:** The customer must supply an active service, date, and exact time. Explicit form choices bypass AI; conversational extraction must supply matching customer quotes before Calendar can be called.

The flow is:

```text
Lead saved
→ Gemini appointment extraction
→ timezone conversion
→ Google Calendar freeBusy
→ events insert when available
→ appointment saved in workspace JSON
```

A missing/ambiguous service, date, or time is marked `needs_details`; no random time is selected. Gemini text asks for missing scheduling details and ElevenLabs receives the same rule in the approved prompt. A busy or disconnected calendar leaves the selected slot unconfirmed, and a cancelled request stays cancelled until a different selection is submitted. EverOnn only reports confirmation after Google creates or verifies the event. The Appointments screen includes the real customer request and blank controls to collect service/date/time.

### 21. Which Google Calendar APIs are called?

**Short answer:** EverOnn calls Calendar `freeBusy` to check availability and Calendar `events` to create or recover the event.

The implementation is in `features/integrations/google.ts`. A deterministic event ID prevents duplicate events if the same lead is retried.

### 22. How is the owner email sent?

**Short answer:** After lead processing, EverOnn sends a summary through the connected Gmail account using Gmail’s `users/me/messages/send` API.

The lead stores `pending`, `sent`, `failed`, or `delivery_unknown` Gmail status and a persisted send-attempt marker. These survive transcript updates and stale browser saves. A pending/attempted/sent request is never automatically resent, even after a timeout. Gmail offers no application idempotency key, so uncertain delivery requires checking the connected account's Sent folder before a manual resend.

### 23. Where can the owner see captured information?

**Short answer:** Leads appear in Dashboard Inbox, contacts appear under Contacts, and requested or confirmed bookings appear under Appointments.

Calendar and Gmail automation results are stored on `lead.automation` and displayed in the Inbox row.

## Storage, security, and readiness

### 24. Is there a database?

**Short answer:** Yes. Amplify uses the existing Supabase project's private `everonn` schema. Users, sessions, business profiles, contacts, leads, appointments, conversations, website projects, encrypted Google connections and provider usage each have separate tables.

The server connects through `SUPABASE_DB_URL`. Browser roles cannot access this schema; service_role can access metering only, not application/authentication/provider data. Supabase Auth and existing `public`/`agentic_that` data remain unchanged. Table Editor / schema `everonn` shows the account under `users`, rather than Supabase Authentication / Users, because authentication remains application-owned. Other entity tables expose useful columns while preserving optional/nested JSONB fields. The existing account and session values are migrated, not recreated. Old schema names are compatibility views/functions, and `legacy_*` tables are restricted backups. Local files are not imported automatically; Amplify refuses file fallback.

### 25. Is the current login real authentication?

**Short answer:** Yes. Login verifies a salted scrypt password hash on the server and creates a revocable, seven-day session in an HttpOnly SameSite cookie.

The raw session token is never stored: only its SHA-256 hash is kept in private application database storage, local JSON or a Netlify Blob. Login has rate limiting and persistent failed-attempt lockout. Database conditional writes retain concurrent updates and sessions survive instance restarts. State-changing routes check origin, and protected APIs resolve the actor from the session before applying RBAC. Self-service password recovery and MFA remain future work.

If owner setup reports "Cross-origin request denied" behind Amplify or another proxy, set `NEXT_PUBLIC_APP_URL` to the exact public HTTPS origin, without `/login`, and rebuild/redeploy with that value available to Next.js. The origin check trusts that configured address instead of the proxy's internal URL and still rejects unrelated origins. The setup token must also be available to the server. A read-only filesystem error means the old file storage path was used: apply `npm run app:db:migrate`, retain `SUPABASE_DB_URL` in Amplify and deploy the application database adapter. The first owner then uses the setup token once; ordinary customer signup never needs it. Passwords remain scrypt hashed; the token protection is retained.

### 26. Can a new customer create an account without seeing another customer's data?

**Short answer:** Yes. “Create a new account” creates that customer as the owner of a new, empty, isolated business workspace.

It does not join the original owner's workspace. A manager, agent, or viewer joins an existing business only through a secure invitation created by that business's owner. Every protected API resolves the workspace from the server session. Signup is rate limited; email verification and an external anti-bot challenge remain production-hardening work.

### 27. How do the four roles differ?

**Short answer:** Owner controls everything; manager configures the business, AI, and website; agent handles customer operations; viewer has read-only access.

The same capability rules hide dashboard sections and are enforced again in server APIs. Only owners can manage team roles or billing. An owner creates a secure invitation URL for a manager, agent, or viewer; accepting it creates the real account. Invitation email delivery is not connected yet, so the URL is shared manually.

### 28. What is working through real providers today?

**Short answer:** Gemini generation/chat/appointment extraction, Pexels images, ElevenLabs live sessions, Google OAuth, Calendar operations, Gmail sending, JSON persistence, previews, and publishing are implemented when their credentials and persistent runtime are available.

Incomplete boundaries include billing, invitation email delivery, forgotten-password recovery/MFA, the marketing lead form, and the marketing product chat widget.

### Provider usage: can we see what each AI feature consumes accurately?

**Short answer:** Dashboard > Usage shows actual Gemini response token counts, ElevenLabs provider conversation metrics, per-feature totals, and clearly labelled Gemini cost estimates. It also shows missing data and synchronization health.

Every actual Gemini generation/chat/appointment-extraction attempt is counted, including failed requests, retries and output rejected by website QA. Cached input belongs within prompt tokens; thinking belongs within the provider total and output pricing. Local booking clarification, browser speech and demo marketing flows make no paid API calls. ElevenLabs credential requests and conversations are counted separately. Voice minutes exclude text-chat elapsed time; reported credits/USD and speech analytics come from provider metadata.

**Does it keep working when nobody opens the Usage page?** Yes when the background deployment is connected: long-lived local Node servers use a worker, and Amplify uses a scheduled authenticated job. Signed ElevenLabs post-call webhooks provide another delivery path. Missed callbacks remain eligible after 24 hours with adaptive retries. Durable response journals are replayed without requesting another paid generation. Repeated sync/webhook/import deliveries do not count the same provider identity twice.

**What does the daily graph mean?** It has a numeric scale and recorded values. A full-height bar means the top of that scale. Untracked history is shaded, absent metrics show a dash, and `+?` marks a known subtotal with additional missing usage. The first recorded day can be partial. An imported old record does not turn other untracked days into zero usage. Usage periods use the business timezone.

**Are Gemini dollars the final bill?** Token costs are model/date/tier-aware estimates, including cached input and thinking. The default paid-tier list-price estimate leaves the real billing tier unverified. Actual charges can be connected from a read-only Google billing export for a project deliberately assigned to this workspace; native currency, credits and export delay are preserved. Project billing is separate from feature estimates because a billing export does not reliably attribute every charge to an application feature. No shared provider-account quota or customer subscription invoice is invented.

**Can past calls or timeouts be recovered?** Where provider records exist, administrators can dry-run/import explicitly attributed Gemini exports or provider-verified ElevenLabs IDs. A matching Gemini request ID repairs that record; stable response IDs avoid duplicates. Historical conversations without a former workspace identity require deliberate administrator attribution. A timeout with no returned token metadata and no retained provider log cannot be reconstructed accurately. Google GenerateContent logging is not enabled by this change; its logs contain prompts/responses and require separate provider configuration. Missing history remains untracked. Losing the process while all storage writes fail can also lose final metadata, leaving a visible pending record.

**Is production already connected?** Usage metering and signed jobs were activated in Amplify deployment 13 at `https://main.d2b3qy6tcyxz0p.amplifyapp.com` (2026-10-04). Supabase Cron is enabled, and an automatic request completed with HTTP 200 against the real database. Live authorization, webhook signatures and simultaneous nonce reuse checks passed. ElevenLabs' HMAC hook is attached to the configured agent with retries, transcription events and JSON format. Provider reads verified the attachment and conversation access, while other agent settings and the shared workspace configuration remained unchanged. Scheduled provider reads remain the recovery fallback. Actual delivery is reported only after a matched provider event. Google invoice export is not connected. Application persistence now targets named `everonn` tables using the same database connection. Deployment 16 introduced durable application records; consolidation preserves the owner subsequently created by the user. Current migration/deployment validation is recorded in `USAGE_OPERATIONS.md`.

**Does this affect the existing Supabase project?** All EverOnn data uses separate tables under `everonn`. The old `everonn_app`/`everonn_usage` names are compatibility aliases for previous deployments. Application statements do not modify existing `public`, `agentic_that` or Supabase Auth tables. Scheduling additionally enables Cron/HTTP extensions, adds their managed schemas, one job and one encrypted Vault configuration. Existing jobs, secrets, shared extension settings and Data API exposure remain unchanged; migration compares existing object/permission metadata and table-content fingerprints before/after, and aborts on a mismatch. Browser roles cannot read Vault or invoke the private usage function. The HTTP queue receives short-lived, single-use signatures instead of permanent credentials. The apps share project capacity; a separate schema is not a separate Supabase instance.

**What is required after pushing to GitHub?** Amplify's origin, database connection and separate scheduler/webhook secrets are configured, signed jobs are deployed, and Supabase Cron is enabled. No additional AWS usage variables are needed for this setup. Check HTTP results and heartbeat with `npm run usage:scheduler -- --status`. The ElevenLabs hook is attached to the configured agent; complete an application voice conversation and check Last verified post-call delivery after provider analysis to verify an actual delivery. Updating permissions on the existing key requires no AWS key replacement. BigQuery export requires its own optional billing credentials. The AWS scheduler template remains an alternative, currently blocked by IAM deployment permissions; never enable two schedulers. Configuration and recovery are in `USAGE_OPERATIONS.md`.

Usage records contain no prompts, transcripts, customer details or provider keys. Owners/managers can view only their own workspace. Supabase is the configured durable usage backend for Amplify; Netlify can use Blobs, and local writable single-process development can use ignored JSON. Serverless storage and incomplete Supabase setup cannot silently fall back to ephemeral files before a paid request.

Validation: `npm test` includes recovery, signed/tampered/replayed webhooks, delayed callbacks, billing scope/currencies, imports, SQL migration/access control/conditional writes, unknown-versus-zero values and tenant isolation. `npm run smoke:usage` after a production build verifies real routes and desktop/mobile UI using isolated stores and mocked provider responses. Smoke checks clear all Supabase configuration to protect the shared project. Mock tests establish application calculations and behavior; they are not a live invoice reconciliation. `npm run usage:db:check -- --probe` verifies real storage access and removes its own fresh test record. See [USAGE_OPERATIONS.md](USAGE_OPERATIONS.md) for setup and recovery.

Provider references: [Gemini metadata](https://ai.google.dev/api/generate-content#UsageMetadata), [pricing](https://ai.google.dev/gemini-api/docs/pricing), [provider logs](https://ai.google.dev/gemini-api/docs/logs-datasets), [ElevenLabs webhooks](https://elevenlabs.io/docs/eleven-api/resources/webhooks), [conversation details](https://elevenlabs.io/docs/api-reference/conversations/get), [Google billing exports](https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery), and [Amplify compute roles](https://docs.aws.amazon.com/amplify/latest/userguide/amplify-SSR-compute-role.html).

### 29. What should we check when website generation fails?

**Short answer:** Check the Gemini key/model first, then inspect the API error, structured-output completeness, QA result, and Pexels separately.

Debug in this order:

1. `GET /api/website-studio` — is Gemini reported ready?
2. Browser network response from `POST /api/website-studio` — what error was returned?
3. Gemini model names and API key in the host environment. Content requests default to 150 seconds, configurable with `GEMINI_WEBSITE_TIMEOUT_MS` (10–240 seconds); code requests also default to 150 seconds, configurable with `GEMINI_WEBSITE_CODE_TIMEOUT_MS` (30–240 seconds). An existing explicit 55-second setting retains that shorter limit until changed. The host must allow the complete synchronous request, including repairs and model fallback.
4. `features/website-studio/ai-generator.ts` — provider or schema/QA failure.
5. `features/website-studio/media.ts` — only if content succeeded but images are missing.
6. `GET /api/workspace` — confirm the new project was saved.

## One answer worth memorizing

### Can businesses request changes, and will EverOnn remember them?

**Short answer:** Yes. Owners and authorized managers can describe website changes in their own words and save design preferences for their business or current website.

They can also clear the saved choices for the selected scope. The server requires their permission and current record revision; it preserves the published website and the other scope's preferences. Recognised credentials/private keys are rejected as remembered design text. This is approved website presentation memory, not automatic long-term conversation memory.

### Does AI discover all Markdown files automatically?

**Short answer:** The application explicitly selects and assembles the relevant files.

SYSTEM, GUARDRAILS, PLUGINS, MEMORY and selected capability/domain SKILL files enter the system instruction. SOURCES contributes a selected-domain reference catalog with verified general notes and source provenance in the data context. The three HVAC notes were checked against primary EPA/CDC/DOE pages; linked pages are not fetched during customer requests or treated as company facts. Calendar/Gmail action availability comes from the business's actual connection scopes. PLUGINS describes supported application workflows and cannot grant permissions or execute new functions.

EVALS remains outside customer prompts. `npm run ai:eval` reads the four versioned documents and runs 16 deterministic cases; two Gemini cases require `--live`. `npm run check` includes the deterministic gate. Real checks use fictional data and isolated usage storage. The 2026-10-06 Gemini attempt reported depleted prepayment credits; the user chose to finish checks/push and fix billing later. A green deterministic gate does not certify full speech quality, visual excellence or the entire BRD.

### Does this complete the document's whole AI runtime requirement?

**Short answer:** It completes this scoped Markdown/resource integration, with remaining requirements tracked separately.

It implements layered versioned instruction assets, scoped website memory policy/forgetting, reference metadata, action-readiness guidance and executable evaluation definitions. Immutable published knowledge/agent configurations, document RAG, full assistant memory, plan-aware typed LLM execution, redacted per-turn replay storage and the larger audio/golden datasets remain planned. Server guardrails and verified provider results continue to protect actual business actions.

Website Studio exposes a change request, design brief, exact colors, typography/spacing/imagery hints, service priority, accepted/rejected choices, and optional section visibility. Gemini invents the page layout; there is no layout picker. Preferences and up to twenty chronological change requests per record stay in workspace-scoped `aiMemory`; they do not rewrite shared skill files or affect another company. A later owner request can override an earlier presentation preference. Structured controls are enforced in code; natural-language direction is interpreted by Gemini and requires owner review.

The owner clicks apply/regenerate to create a new private preview. Generation failures leave the previous project intact. Successful regeneration restarts publication review. Workspace defaults and project preferences are supported. A live release stays available beside a separate draft, and three previous published versions can be restored. Automated shared skill improvement, individual section regeneration and organization-wide memory remain future phases.

Choosing no photography skips Pexels and rejects images in generated code; Gemini designs the resulting text-only composition. `npm run smoke:hvac` verifies the owner revision flow and mobile layouts against production routes with a local Gemini fixture; it is not a live-model quality evaluation.

### Which customers can change settings?

**Short answer:** The businesses using EverOnnAI and their authorized team can change their own settings. Their website visitors and callers can ask questions and submit requests, but cannot change company configuration.

The existing role permissions protect business facts and assistant settings. Website preference writes additionally require `website:publish` and the actor's workspace. Visitors cannot approve knowledge or write owner memory. Shared HVAC/capability Markdown is changed through reviewed code, never a customer preference.

### Which industry uses the new skill system first?

**Short answer:** HVAC is the first domain pack, and website, assistant, and appointment skills are shared.

Select HVAC under Knowledge → Industry intelligence. Existing businesses default to general behavior until an explicit domain is selected; business type text is not a skill identifier. New workspaces stay empty of demo records. The HVAC demo fixture selects HVAC. Plumbing and Electrical packs will be separate future additions using the same capabilities.

> “The dashboard sends the approved business profile to our server-side `POST /api/website-studio` route. That route calls Gemini’s `generateContent` API for a grounded content plan, resolves available Pexels images, then requests actual multi-page HTML and CSS for three designs. It validates the generated code and saves a private draft. The status API publishes an approved snapshot and supports rollback without overwriting the live site during draft generation.”

### Request workflow verification

Automated tests cover repeated updates/retries, uncertain mail delivery, booking recovery, missing/invented times, busy or disconnected Calendar, and stale saves. The disposable browser smoke (`npm run smoke:booking` after `npm run build`) verifies the actual desktop/mobile request flow with providers disabled. It proves local application behavior; live Google and ElevenLabs account permissions and remote agent prompt configuration still need deployment validation.

The primary US Carpentry workspace uses carpentry services documented in its saved description and Asia/Kolkata for its Hyderabad location. Identified Northstar profile details, sample customer records, sample appointment, and sample team members were removed; unsupported after-hours sample knowledge was unapproved. Existing real Google appointments retain their original booking timezone and show a review notice when it differs from the current business timezone. The tracked workspace's saved website status is published. This implementation preserves that saved site until its owner publishes an approved generated-code replacement.

Both voice session routes use `features/voice-agent/session-context.ts`. The existing ElevenLabs template reads faq_notes rather than approved_instructions, so the full approved receptionist rules are supplied through both variables. Calendar/handoff/duration/language fields now match the remote template. Website and dashboard voice tools use the real lead endpoint result; booked=true requires a confirmed Calendar appointment. The configured provider key allows reading the remote agent but its prompt update request returned HTTP 401, so remote configuration was left unchanged and the supported existing dynamic-variable contract is used.

Dashboard Inbox filters now select real subsets, and authorized operators can update lead status. Contacts can be added with callback validation and their details/call/email links can be opened. The notification icon opens Inbox. Billing shows its unconnected state without fictitious subscription prices, usage, or invoice dates. Customer Settings no longer exposes the demo-reset action. Latest customer phone/email/name corrections are extracted, and newer contact records survive stale browser autosaves.

## Customer project documentation

### What did we add from the project-management folder?

**Short answer:** Customers can connect their own GitHub repositories and browse Markdown guides, task lists and Mermaid diagrams inside their business workspace.

Open **Project workspace** in the dashboard. It includes repository selection, filename/path search, code copying, private repository images, manual sync and mobile/light/dark viewing. Public repositories work without a token; private repositories require a customer token with Contents read access. Tokens are encrypted on the server and never returned in the viewer. [GitHub permission details](https://docs.github.com/en/rest/git/trees#get-a-tree).

### Who can manage a customer's repositories?

**Short answer:** Owners/managers connect or disconnect; workspace team members can read and sync. Other customers cannot access the connection or its files.

The authenticated server-side workspace ID selects repository records. Browser headers, URLs and repository IDs cannot grant access to another business. This uses existing login/RBAC and separate private repository storage. Migration `202610060004` was applied to the configured shared PostgreSQL database on 2026-10-06. Live rolled-back checks verified repository persistence, encryption, stale-write protection and tenant isolation, and confirmed no probe records remained. The hosted feature still requires deploying the updated application code.

### Does this edit tasks or execute repository skills?

**Short answer:** It displays repository documents; edits remain in GitHub, and the customer uses Sync to refresh the manifest.

Task checkboxes reflect Markdown content. Viewing `SKILL.md` does not replace the platform's approved instructions, run code, change AI memory or publish websites. Only useful viewer/source-read functionality was integrated; no standalone server, imported GitHub credentials, clone cache or unrelated source features were copied. Local tests use disposable stores and mocked GitHub; a real private repository needs separate credential/deployment verification.
