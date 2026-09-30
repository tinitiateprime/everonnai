# EverOnn code profile

This is the practical guide to the EverOnn codebase. Use it to answer three questions quickly:

1. Where does a feature start?
2. Which internal and external API calls does it make?
3. What data does it read or change?

For request-by-request diagrams, read [PROJECT_DATA_FLOW.md](PROJECT_DATA_FLOW.md). For meeting-ready answers, read [CLIENT_TECHNICAL_QA.md](CLIENT_TECHNICAL_QA.md).

> Keep this document factual. “Connected” means the code calls a real provider. “Demo only” means the screen works visually but has no production backend.

## 1. System in one sentence

EverOnn is a Next.js application with one JSON workspace as its business source of truth, Gemini for generation and text reasoning, Pexels for website images, ElevenLabs for live voice/chat, and Google OAuth for Calendar booking and Gmail notifications.

There is currently no database.

## 2. Main technology

| Area | Implementation |
| --- | --- |
| Web application | Next.js 16 App Router, React 19, TypeScript |
| Styling | Tailwind CSS 4 plus project CSS files |
| Icons | Lucide React |
| Main business data | `data/everonn.json` locally; Netlify Blobs when Netlify runtime variables are present |
| Provider credentials | Environment variables and encrypted `data/provider-connections.json` locally |
| AI text and structured generation | Google Gemini REST API |
| Website photography | Pexels REST API |
| Live browser voice/chat | ElevenLabs Conversational AI |
| Scheduling and notifications | Google Calendar and Gmail APIs through OAuth |
| Tests | Node test runner through `tsx` |

Path alias: `@/something` means a file starting at the project root, configured in `tsconfig.json`.

## 3. Best reading order

Read these files in this order when learning the product:

1. `features/everonn/types.ts` — every important business data shape.
2. `data/everonn.json` — the currently saved workspace.
3. `features/everonn/workspace-provider.tsx` — browser state, loading, autosaving, and refresh.
4. `lib/json-workspace-store.ts` — server-side persistence and validation.
5. `components/dashboard/everonn-dashboard.tsx` — owner dashboard and its feature entry points.
6. `features/voice-agent/engine.ts` — shared business-aware receptionist rules.
7. `features/website-studio/` — website generation, QA, and images.
8. `features/integrations/lead-automation.ts` — lead-to-Calendar/Gmail automation.
9. `app/api/` — HTTP boundaries used by the browser.

## 4. Folder responsibilities

| Path | Responsibility |
| --- | --- |
| `app/` | Pages, layouts, public routes, preview routes, published sites, and API route handlers |
| `components/` | Browser UI: dashboard, marketing UI, generated-site renderer, and assistants |
| `features/everonn/` | Domain types, demo seed, browser workspace provider, and tenant repository foundation |
| `features/website-studio/` | Gemini prompt/schema, output normalization, QA, project creation, and Pexels selection |
| `features/voice-agent/` | Receptionist prompt, contact extraction, Gemini replies, appointment extraction, and timezone conversion |
| `features/integrations/` | Google OAuth, Calendar/Gmail clients, and lead automation orchestration |
| `features/auth/` | Role/capability definitions and workspace-scope guards |
| `lib/` | JSON persistence, provider readiness, and encrypted credential storage |
| `data/` | Workspace JSON and ignored encrypted provider-connection file |
| `tests/` | Unit and integration-level behavior tests |
| `scripts/` | Browser smoke test for the main product journey |

## 5. Page and UI routes

| URL | Main file | What it does |
| --- | --- | --- |
| `/` | `app/page.tsx` | EverOnn marketing homepage |
| `/product/*`, `/industries/*`, `/pricing`, etc. | `app/[...slug]/page.tsx` | Static marketing/detail pages |
| `/login` | `app/login/page.tsx` | Demo login, reset, and MFA experience |
| `/dashboard` | `app/dashboard/[[...section]]/page.tsx` | Owner/operator dashboard |
| `/dashboard/knowledge` | `components/dashboard/everonn-dashboard.tsx` | Edits the central business profile, services, and approved knowledge |
| `/dashboard/ai-agent` | same dashboard component | Tests Gemini text or ElevenLabs voice and captures leads |
| `/dashboard/website` | same dashboard component | Generates, previews, approves, and publishes the customer website |
| `/dashboard/settings` | same dashboard component | Google/ElevenLabs status, team demo, and reset controls |
| `/preview/[token]/*` | `app/preview/[token]/...` | Private, `noindex` generated-site preview |
| `/sites/[slug]/*` | `app/sites/[slug]/...` | Server-rendered published customer website |

`components/app-chrome.tsx` decides which shell surrounds a page:

- marketing pages receive the EverOnn header, footer, and marketing demo chat;
- dashboard, login, and preview pages receive the product shell without marketing chrome;
- published `/sites/*` pages are rendered without loading the private browser workspace.

## 6. Internal API call map

### Workspace

| Method and route | Called from | Work performed | Data changed |
| --- | --- | --- | --- |
| `GET /api/workspace` | `WorkspaceProvider`, smoke test | Reads JSON, adds live provider connection status, disables caching | None |
| `PUT /api/workspace` | `WorkspaceProvider` after a 450 ms debounce | Validates workspace ID, preserves server-created leads/contacts/conversations/appointments, prevents publish-state regression | Whole workspace JSON |
| `HEAD /api/workspace` | Diagnostics | Reports persistence type in `X-EverOnn-Persistence` | None |

The implementation is `app/api/workspace/route.ts`. All server reads/writes go through `lib/json-workspace-store.ts`.

### AI assistant and voice

| Method and route | Called from | Internal path | External call |
| --- | --- | --- | --- |
| `POST /api/assistant/message` | Dashboard text agent and generated-site Gemini fallback | Access check → rate limit → `generateAssistantReply()` | Gemini `models/{model}:generateContent` |
| `GET /api/voice/session` | Dashboard settings | Returns whether ElevenLabs key + agent ID exist | None |
| `POST /api/voice/session` | Dashboard AI agent | Workspace header check → build dynamic business variables | ElevenLabs conversation token + signed URL endpoints |
| `POST /api/site-assistant/session` | Private or published customer website | Preview-token/published-slug check → visitor rate limit → dynamic business variables | ElevenLabs conversation token + signed URL endpoints |

The shared instructions come from `buildReceptionistPrompt()` in `features/voice-agent/engine.ts`. It includes active services, hours, service area, approved knowledge, pricing, policies, emergency handling, and the rule not to invent bookings or prices.

### Lead capture and follow-up

| Method and route | Called from | Work performed | Data changed |
| --- | --- | --- | --- |
| `POST /api/site-assistant/lead` | Dashboard agent and generated-site assistant | Validates access/details, upserts contact and lead, then runs Google automation | Contacts, leads, appointments, automation state |
| `POST /api/integrations/google/automation` | Manual/server retry path | Re-runs automation for one existing lead after workspace check | Lead automation and possibly appointment |

`features/integrations/lead-automation.ts` is the orchestrator. It can make three provider calls:

1. Gemini extracts whether an appointment was requested, the service, and a complete local date/time.
2. Google Calendar checks `primary` calendar availability and inserts a confirmed event only when free.
3. Gmail sends the owner a lead notification when Gmail is connected and follow-up is enabled.

### Website Studio

| Method and route | Called from | Work performed | Data changed |
| --- | --- | --- | --- |
| `GET /api/website-studio` | Status/diagnostics | Reports providers, concepts, and publishing gates | None |
| `POST /api/website-studio` | Dashboard Website section | Validate profile → Gemini generation → normalize → QA → create project → Pexels media → save | Profile and website project |
| `POST /api/website-studio/status` | Website workflow buttons | Enforces the next legal state and publishing requirements | Website status and selected concept |

Website status must move in order:

`generated → claimed → verified → approved → published`

Publishing requires passing QA and selecting `editorial`, `momentum`, or `aura`.

### Google connection

| Method and route | Called from | Work performed |
| --- | --- | --- |
| `GET /api/integrations/google` | Dashboard Settings | Returns configuration, connection/scopes, and exact callback URI |
| `GET /api/integrations/google/connect` | Connect button | Creates signed OAuth state + nonce cookie and redirects to Google |
| `GET /api/integrations/google/callback` | Google OAuth redirect | Verifies state/cookie, exchanges code, encrypts tokens, updates integration flags |
| `DELETE /api/integrations/google` | Disconnect button | Revokes the Google token, removes stored credentials, clears flags |

## 7. External provider calls

| Provider | Exact use | Code |
| --- | --- | --- |
| Gemini | Multi-page website JSON (`maxOutputTokens: 16384`) | `features/website-studio/ai-generator.ts` |
| Gemini | Grounded assistant reply (`maxOutputTokens: 600`) | `features/voice-agent/gemini.ts` |
| Gemini | Appointment intent JSON (`maxOutputTokens: 2048`) | `features/voice-agent/appointment.ts` |
| Pexels | Landscape photo searches for hero, gallery, and each service | `features/website-studio/media.ts` |
| ElevenLabs | Short-lived conversation token for WebRTC voice | `app/api/voice/session/route.ts`, `app/api/site-assistant/session/route.ts` |
| ElevenLabs | Signed WebSocket URL for live text conversation | `app/api/site-assistant/session/route.ts` |
| Google OAuth | Consent, code exchange, refresh, and revoke | `features/integrations/google-oauth.ts` |
| Google Calendar | `freeBusy` check and event insert/get | `features/integrations/google.ts` |
| Gmail | RFC 2822 message sent through `users/me/messages/send` | `features/integrations/google.ts` |

Gemini model order, timeouts, and retries come from `lib/provider-config.ts`. Website generation tries configured models in order. Appointment extraction tries at most the first two.

## 8. Data and secrets

### Business data

`EverOnnWorkspace` in `features/everonn/types.ts` contains:

- one `BusinessProfile`;
- contacts, leads, conversations, and appointments;
- one generated `WebsiteProject`;
- integration display state;
- team members.

The same `BusinessProfile` feeds website generation, Gemini chat, ElevenLabs dynamic variables, appointment extraction, and customer-facing content. Changing knowledge affects voice/chat immediately after save; the website must be regenerated to receive new pages/copy/images.

### Secret data

Secrets never belong in `data/everonn.json`.

- API keys and OAuth client credentials live in `.env.local` locally or host environment variables.
- Google access/refresh tokens are AES-256-GCM encrypted by `lib/provider-credentials.ts`.
- Local encrypted tokens live in ignored `data/provider-connections.json`.
- Netlify runtime uses a separate encrypted Blob store.

## 9. Environment variable ownership

| Variables | Used by |
| --- | --- |
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | Website generation, chat, appointment extraction |
| `GEMINI_WEBSITE_MODEL(S)` | Ordered Gemini model selection |
| `GEMINI_WEBSITE_TIMEOUT_MS`, `GEMINI_WEBSITE_RETRY_DELAY_MS` | Gemini timeout/retry behavior |
| `PEXELS_API_KEY` | Generated-site images |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` | Live voice and live generated-site chat |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth |
| `CREDENTIAL_ENCRYPTION_KEY` | Token encryption and signed OAuth state; minimum 32 characters |
| `PHONE_FRONT_DESK_FOLLOW_UP_ENABLED` | Gmail owner notification switch; defaults to enabled |
| `EVERONN_DATA_FILE` | Optional local workspace JSON path |
| `EVERONN_CONNECTIONS_FILE` | Optional local encrypted token-store path |

Runtime details that commonly cause confusion:

- `NEXT_PUBLIC_APP_URL` is documented in `.env.example` but is not currently read by application code.
- `GOOGLE_OAUTH_REDIRECT_URI` is not read; the callback is derived from the request origin or Netlify `SITE_NAME`.
- `GOOGLE_CALENDAR_SERVICE_ACCOUNT_BASE64`, `RESEND_API_KEY`, and `AUTH_EMAIL_FROM` are reported by provider-readiness code, but no current product flow uses those providers.
- `NETLIFY` and `NETLIFY_BLOBS_CONTEXT` are host-provided switches that select Blob persistence.

## 10. What is real and what is demonstration-only

### Connected implementation

- JSON workspace load/save with validation and serialized writes.
- Gemini website generation, grounded chat, and appointment extraction.
- Pexels image search and selection.
- ElevenLabs browser voice/live site chat when configured.
- Private previews, multi-page generated sites, QA gates, and dynamic publication.
- Contact/lead capture and Google Calendar/Gmail follow-up.
- Google OAuth with encrypted refresh tokens.

### Demonstration or incomplete production boundary

- `/login` accepts any valid-looking credentials and any six-digit MFA code; it only writes local storage.
- RBAC grants and tenant guards exist, but dashboard/API authorization is not backed by a real signed-in user session.
- The workspace header is a scope check, not secure authentication by itself.
- The preview UI accepts the special `/preview/demo` alias when a project exists; assistant API access still requires the project's real private token.
- Marketing `components/everonn-chat.tsx` intentionally uses hardcoded product-demo replies. It is not the generated customer website assistant.
- Marketing `components/lead-form.tsx` shows success locally but does not send or save the submission.
- Billing values and “Manage plan” are UI placeholders.
- Team invitations save a JSON row but do not send an invitation email or create an account.
- “Add contact” currently has no creation workflow.
- In-memory API rate limits reset when the server process restarts and are not shared between instances.
- File JSON is suitable for one writable server instance. A serverless host without durable disk needs a persistent storage adapter.

## 11. Safe change checklist

When changing a feature:

1. Update its type in `features/everonn/types.ts` first.
2. Update JSON validation and persistence if the storage shape changes.
3. Keep provider secrets on the server; never use them in client components.
4. Preserve workspace, preview-token, or published-slug access checks.
5. Add or update tests for normalization, scope, idempotency, and failure behavior.
6. Run `npm run lint`, `npm test`, and `npm run build`.
7. Update this file when routes, modules, providers, environment variables, or implementation status change.
8. Update `PROJECT_DATA_FLOW.md` when a request path or stored-data flow changes.
