# Website Studio data flow

```mermaid
flowchart TD
  User[Single business knowledge page] --> Draft[Device IndexedDB draft]
  User -->|Optional website URL, automatic| Discover[POST /api/discover]
  Discover --> Network[Public DNS validation and pinned HTTP requests]
  Network --> Source[Robots, sitemaps and internal HTML pages]
  Source --> Browser[Optional Chromium rendering through guarded requests]
  Browser --> Evidence[Content, contacts, images, JSON-LD and design cues]
  Evidence -->|Coverage and source URLs| User
  User -->|Generation request, optional studio access token| Plan[POST /api/plan]
  ServerEnv[Server environment API key and preferred free models] --> Plan
  Plan --> Router[OpenRouter, live suitable free models]
  Router --> Directions[Three AI-created art directions]
  Directions --> Generate[POST /api/generate, one version per request]
  Evidence --> Generate
  User -->|Entered facts override source conflicts| Generate
  Generate --> Router
  Router --> Validate[HTML/CSS, contacts, service and link validation]
  Validate --> Inspect[Optional desktop and mobile browser review]
  Inspect -->|Failed checks, bounded AI repair| Router
  Inspect -->|Accepted HTML artifact| Draft
  Inspect -->|Atomic artifact save| SiteStore[Server generated-site files]
  SiteStore --> SiteURL[GET /service/business-slug/version]
  SiteURL --> Widget[Trusted voice/chat frame]
  Widget --> Session[POST /api/site-assistant/session]
  SiteStore -->|Exact website knowledge snapshot| Session
  Session --> ElevenLabs[ElevenLabs WebSocket chat / WebRTC voice]
  Widget -->|Text fallback| Reply[POST /api/site-assistant/message]
  SiteStore -->|Same saved knowledge| Reply
  Reply --> Gemini[Gemini grounded text reply]
  Draft --> Preview[Isolated sandbox preview and HTML download]
```

The browser starts URL discovery after a 1.7-second pause. A changed URL cancels the prior request. Generation waits for matching discovery; unreadable sites require explicit description-only continuation. Source contacts are displayed as evidence rather than silently overwriting entered fields.

The model catalogue uses fixed `https://openrouter.ai/api/v1/models`. The generation provider uses fixed `https://openrouter.ai/api/v1/chat/completions`. The provider key comes only from the server environment, never from browser inputs/headers. Browser-supplied provider keys are ignored. A separate studio access token authorizes production generation; only this access token can be sent by the browser. Neither credential enters IndexedDB or exported knowledge. `OPENROUTER_MODELS` overrides the preferred free-model order; blank defaults to Inkling, Laguna S 2.1 and Nemotron 3 Ultra. Every candidate must still qualify in the live catalogue; unavailable or paid preferences are skipped and fallback stays free. Discovery directly requests the user-supplied public source after URL, DNS, redirect and resource checks. Chromium receives fulfilled guarded network responses and no provider credentials.

The plan is entirely AI-created and locally schema-validated. Each independent generation request gets the entered knowledge, evidence from every captured page, a distinct AI direction and brief context about accepted earlier versions. The original HTML/CSS is preserved apart from the injected security policy. Rejected output is never shown as a completed site. Completed versions save independently; cancellation or a failed later version keeps earlier artifacts. Retry uses the same plan and unchanged knowledge. Editing knowledge or refreshing source discovery invalidates the prior generation fingerprint and leads to a fresh plan on the next generation. Creating a new set after all three complete also makes a fresh plan.

Evidence scope: same-origin public HTML pages reachable through links/sitemaps; 40 successful pages, 120 attempts and 180 seconds maximum. Query/filter pages, restricted content and unrelated origins are excluded. Body text and AI context are bounded; contacts and metadata are retained separately. Coverage, truncation, skipped URLs and missing rendering are surfaced. The new site is a single static document combining useful source knowledge, not a clone of all source routes.

Studio design-preview iframes have an empty sandbox permission list and a restrictive CSP, disabling scripts, forms, frames and network data requests. Images/Google Fonts can load as permitted presentation assets. Downloads include the same policy. A separate trusted assistant frame is overlaid beside the preview; it can run the application-authored controls, request microphone permission and call assistant APIs. AI-generated code never executes in the studio's origin.

After validation, `POST /api/generate` saves the artifact before returning it with a `path`: `/service/{business-slug}/{index+1}`. The business name supplies the slug; missing names use `business-{description-hash}`. File storage defaults to ignored `data/generated-sites` or the configured `GENERATED_SITES_DIR`. A temporary-file/rename write replaces only the successful corresponding business/version file. Failed generation or saving keeps the prior file. Same slug/version always serves its latest successful artifact.

The studio shows the path and an Open website link. `GET /service/[business]/[version]` serves stored HTML/CSS directly with a small trusted assistant bootstrap, without the studio's layout or an AI call. It accepts versions 1–3 and returns 404 for missing/invalid addresses. Links work after refresh and from another browser that can reach the running app. These generated outputs are publicly readable on this server; generation access remains guarded. Response CSP permits only the exact hash of the application-owned bootstrap and a same-origin trusted assistant frame; model-authored scripts remain blocked. Hosting must provide a persistent writable directory, shared across instances. This does not deploy the app to an external host.

Generation saves the exact `knowledgePacket(knowledge, discovery)` as `knowledgeJson` alongside each artifact. Both assistant channels load that snapshot through business/version/artifact revision. Visitor messages and source text cannot select a different knowledge packet. Editing the studio form alone does not change a saved website or its assistant; regeneration updates the corresponding version and knowledge together. Old revisions fail safely rather than mixing a new business context with an old page.

The trusted widget calls the same ElevenLabs endpoints as the main project, issuing only the credential for its selected mode. Browser initialization sends existing dynamic-variable names and factual instructions, without changing the shared agent template. Voice uses WebRTC and explicit microphone permission; text uses a text-only WebSocket session. Failed live chat can use the Gemini message endpoint with the same server-selected snapshot. Conversation tokens are transient; provider keys remain in the server environment. Closing/switching/unmounting cancels pending operations and ends active sessions. Optional callback/booking tool names return unavailable state because this branch does not connect those main-project workflows.
