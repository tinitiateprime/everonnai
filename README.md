# EverOnn Website Studio

A fresh, single-page website creation studio on the `website-as-a-service` branch. It does not import the original EverOnn dashboard, database, provider integrations or AI skill system.

## Run locally

Use Node 22 or newer.

```sh
npm ci
npm run browser:install
npm run dev
```

Copy `.env.example` to `.env.local`, set `OPENROUTER_API_KEY`, then start/restart the app and open http://localhost:3000. The API key is read only on the server; there is no API-key entry on the site and browser-supplied key headers are ignored. Never use a `NEXT_PUBLIC_` prefix for the secret. `.env.local` is ignored by Git. On a deployed host, set the same variable in the host's environment settings.

Production use requires `STUDIO_ACCESS_TOKEN`; enter this separate studio access token in **Generation settings**. The token controls access to generation and stays in browser memory for the session. It is not the OpenRouter key. Local `npm run dev` needs only `OPENROUTER_API_KEY` unless a studio token is explicitly configured.

## Your workflow

1. Add a business name, business type and description; all three are required. Industry intelligence, website link, phone, email, location, service area, hours, service names/details and additional knowledge are optional. Services can be added or removed. Incomplete drafts, including unfinished email addresses, remain editable after refresh.
2. A provided website link automatically starts discovery after typing pauses. Review extracted contacts and each page's evidence. Read again to refresh it. Failed discovery can be retried or explicitly skipped.
3. Generate three websites. AI reads [the website-building skill](ai/capabilities/website-building/SKILL.md), entered knowledge and captured website evidence, proposes three distinct directions and image-search briefs, then independently writes original HTML/CSS for each one. The skill defines design quality and factual/accessibility rules; it supplies no layout, template HTML, CSS theme or static fallback. The studio interface itself has ordinary application CSS.
4. Compare desktop/mobile previews, regenerate individual versions, and download complete HTML documents. Each accepted design also gets a standalone URL: `/service/{business-slug}/1`, `/2`, or `/3`. Use **Open website** beside Download HTML. Draft knowledge, website discovery, plans, prompt drafts and completed designs survive refresh on the same device through IndexedDB.
5. Select a version and use **Describe your changes → Apply changes** to refine its design. AI receives the saved HTML, original skill/knowledge, approved photos and accepted edit history. The validated result updates that version's existing URL, with a new revision for its voice/chat widget. The other two versions stay intact. Failed edits retain the accepted site and typed prompt. Accepted history (last 20 requests) and unsent prompts survive refresh. Change business facts through Business knowledge and regenerate; design edits use the saved facts. Regeneration starts a fresh design and edit history. Designs saved before editable snapshots were introduced need one regeneration to enable editing.

## Pexels images

Set server-only `PEXELS_API_KEY` in ignored `.env.local` or the hosting environment. No photo API key is sent to the browser. AI selects one or two generic subject queries per direction, without names/contact details/private information. The server searches the fixed Pexels API, checks returned image/credit hosts and supplies up to eight relevant candidates per direction. Generation resolves submitted photo IDs on the server instead of trusting client URLs or credits. The model chooses photo placement, cropping and treatment.

Search and photo metadata are cached for 24 hours in the server process, with bounded caches and concurrent query deduplication. No-result searches, missing configuration or provider errors are shown as warnings; the design can use captured source images or original graphics. Image URLs must match the supplied assets. Used Pexels photos require visible links to Pexels and each photographer; viewport checks also test credit visibility when Chromium is installed. Stock images are illustrative, not claims about the actual business/team/jobs. Credits are retained in HTML downloads. External photos remain hosted by their source.

## Generated website URLs

A business named `Northline Heating` gets these addresses when the studio runs on port 3000:

```text
http://localhost:3000/service/northline-heating/1
http://localhost:3000/service/northline-heating/2
http://localhost:3000/service/northline-heating/3
```

Links use the running app's host and port. Names become lowercase URL slugs with spaces/punctuation converted to hyphens. Non-Latin names are supported as encoded path segments. Business name is required for new generation. Legacy unnamed slugs remain readable. Same slug/version points to its latest successfully generated or refined design; only that version is replaced. Distinct businesses need distinct slugs. Older browser-only designs receive URLs when regenerated.

Accepted HTML artifacts and their generation knowledge snapshots are saved atomically on the Node server under ignored `data/generated-sites/{slug}/{version}.json`, or `GENERATED_SITES_DIR`. The GET route serves the original generated HTML/CSS plus the application's voice/chat controls, without the studio interface. Links survive refresh and server restarts and work in another browser that can reach this server. They do not need the original browser's IndexedDB. Unknown businesses and missing/invalid versions return 404. These are publicly readable generated-site links on this app; generation remains protected. CSP blocks model-authored scripts. Only an exact hash of the application-authored assistant bootstrap is permitted; it embeds a trusted assistant frame and validates resize-message origin and source.

## Voice and chat

All newly generated versions include **Chat with us** and **Talk to us**, also available beside the studio preview. This adapts the main project's `WebsiteAssistant` flow: ElevenLabs signed WebSocket URLs for text chat, WebRTC conversation tokens for voice, and Gemini text fallback when live chat fails. The main project's provider credentials can be configured in this studio's ignored `.env.local`: `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `GEMINI_API_KEY`, and optional `GEMINI_ASSISTANT_MODELS` (default `gemini-3.8-flash`). No provider key enters browser state, bundles or API responses. ElevenLabs conversation credentials are transient and issued on demand when a visitor opens chat/voice, never when the page simply loads.

Each saved version keeps the exact `knowledgePacket` used for its website: business name/type/description, optional entered details/services and captured website evidence. The server selects it by business/version/revision rather than accepting browser-supplied business facts. This same snapshot grounds both channels. Entered facts take precedence over crawled evidence. Existing ElevenLabs dynamic variable names (`faq_notes`, `business_name`, `services`, `greeting`, etc.) are preserved, so the existing agent template can be reused without modifying its shared configuration. A different agent must support these placeholders and text-only mode; arbitrary configured agents are not automatically rewritten.

Voice requests microphone permission only after the visitor clicks Talk to us. It needs HTTPS or localhost, a supported browser, valid ElevenLabs configuration and provider quota. The widget supports microphone mute/unmute, conversation end, reconnect, transcripts and cancellation/cleanup when closed or unmounted. Text chat supports typed messages and switches to configured Gemini when a live connection fails. Source content is treated as evidence, never executable agent instructions. Rate limits, stale revisions, permission denial and provider errors are explicit. Older generated records without a knowledge snapshot require regeneration to connect the assistant.

The standalone branch provides business Q&A and contact guidance. It does not import the main project's database, booking calendar, email sender, callback storage, voice usage meter or webhook. Its existing agent tool names receive truthful unavailable results; the assistant must not claim those actions succeeded. Downloaded HTML contains the standalone design; the live assistant runs on this app's website URLs and needs this backend when deploying elsewhere.

`POST /api/site-assistant/session` returns only a scoped ElevenLabs conversation credential and the business dynamic variables. `POST /api/site-assistant/message` supplies server-selected knowledge to Gemini and returns a grounded text reply. `/assistant/[business]/[version]?revision=...` hosts the trusted React controls inside the page's frame. The generated HTML itself retains original AI CSS and is never granted permission to execute arbitrary JavaScript.

Each generated website is a single, responsive document with in-page navigation. Public source pages supply evidence; they are not recreated as separate routes. Downloads use inline original CSS and native HTML interactions. Source images and optional Google Fonts remain externally hosted; the download is not an offline asset bundle. Contact links work when known. Forms, booking, payments and deployment to another hosting provider remain outside this app's scope.

## How website discovery works

The server resolves the public URL, checks `robots.txt`, reads up to 30 sitemap files (including sitemap indexes), and follows same-origin HTML links. It prioritizes contact, services, about, pricing and location pages over archives. Chromium renders JavaScript-driven content when installed, with network requests passed through the same public-address guard. It extracts page titles, descriptions, headings, body text, telephone/email links, JSON-LD, source image URLs, CSS colors, font names and browser-computed design cues. The homepage's first four stylesheets also supply design evidence. Every page retains its source URL for review.

Discovery initially targets 500 successful pages, supports expansion to 2,000, and works in persisted 40-page/75-second batches. It bounds the frontier to 12,000 URLs and attempts to three times the page limit. Authentication, robots restrictions, non-HTML files, subdomains/off-site pages, query/filter pages and unreachable pages can prevent full coverage. Coverage and skipped pages are shown; the app cannot guarantee access to every page of an arbitrary site. Raw text is limited to 12,000 characters per page, and AI context for up to 40 pages uses a 100,000-character prose budget; larger crawls use prioritized page details, deduplicated contacts and a bounded source index with explicit coverage. Chromium is optional: without it, HTML discovery works and explicitly warns about missing JavaScript content.

Entered facts override conflicting website evidence. The generator is told to omit unknown facts, preserve offered services, use only supplied source or approved Pexels image URLs and retain required credits, and avoid invented contacts/testimonials/claims. Validation enforces owner-entered contacts, supported contact links, service names, useful anchors, valid responsive CSS, complete HTML and no executable content. A browser check at 390px and 1440px rejects horizontal overflow and hidden main headings when Chromium is available. These checks cannot guarantee aesthetic excellence or verify every factual sentence; the user should review all three designs.

## OpenRouter

The default version order is [Claude Opus Latest](https://openrouter.ai/~anthropic/claude-opus-latest), [Gemini Pro Latest](https://openrouter.ai/~google/gemini-pro-latest), and [GPT-6.1 Sol](https://openrouter.ai/openai/gpt-6.1-sol). Their IDs and capabilities were reviewed against the public catalogue on 2026-10-09. The latest-family aliases follow provider updates; currently they resolve to Claude Opus 5.5 and Gemini 3.1 Pro Preview. These models use paid OpenRouter credits. Model choice does not guarantee design quality.

`OPENROUTER_MODELS` is a comma-separated allowlist in version order. Blank uses `~anthropic/claude-opus-latest,~google/gemini-pro-latest,openai/gpt-6.1-sol`. OpenRouter latest aliases require the leading `~`; the app normalizes the corresponding Claude/Gemini aliases without it. The [live catalogue](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties) checks text output, at least 32,000 context tokens and at least 8,000 completion tokens, excluding safety, embedding, batch and image models. Missing/ineligible IDs are skipped; if none remain, generation fails explicitly. Each version starts with the corresponding available configured model. **Generation settings** allows a listed override. Application fallback uses at most three models from this list; no other paid/free models are added automatically. Provider routing can fail over between providers of the requested model. The former zero-price filter and provider cap have been removed.

Generation uses [OpenRouter chat completions](https://openrouter.ai/docs/api/reference/overview). Plans request JSON Schema when supported and are validated locally. Reasoning uses an advertised medium effort when available, otherwise low/minimal, a supported 3,000-token budget or the supported default. Optional reasoning without advertised controls is disabled. Website output allows up to 12,000 tokens, including reasoning, bounded by model limits; the skill targets approximately 6,000 visible tokens. Plans allow 5,000 tokens. Invalid HTML gets one repair per candidate within a 285-second operation budget; each completion is bounded to 150 seconds. The studio requests the three versions concurrently. The CSS safety check rejects legacy `behavior:`/`expression()`/`-moz-binding` but allows standard properties such as `scroll-behavior`. Rate limits, insufficient credits, missing keys and incomplete output are reported. Accepted designs remain saved when another fails; retry generates the requested/missing version.

### Direct Gemini provider

Set `WEBSITE_PROVIDER=gemini` to send planning, generation and refinement straight to the Gemini API with `GEMINI_API_KEY`; OpenRouter keys and `OPENROUTER_MODELS` stay configured but unused. `GEMINI_WEBSITE_MODELS` lists models in version order (default `gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash`); each version starts on its own model so free-tier per-model request quotas do not collide, and the other listed models are fallbacks. Thinking is set to a low level (a 2,048-token budget on Gemini 2.5). Requests retry 500/503 overload responses with backoff and 429 per-minute quota responses after Gemini's `retryDelay` (up to 60 seconds); daily-quota exhaustion fails with an explicit message. Free-tier keys have no Gemini Pro quota. Validation drops Google Fonts `preconnect`/`dns-prefetch` hints instead of requesting a repair. Unset `WEBSITE_PROVIDER` to return to OpenRouter.

## Checks

```sh
npm run check
npm run test:browser
```

`npm run verify:website:live -- --media-only` checks real Pexels search and image availability. With a configured OpenRouter key, `npm run verify:website:live -- --all` additionally generates all three fictional-business designs and refines version one, validating its stable URL and unchanged assistant knowledge. It uses live provider quota and is separate from routine mocked checks.

`npm run verify:assistant:live` is an explicit live-provider probe using an isolated temporary website and fictional bicycle-business knowledge. It exercises real ElevenLabs chat, a WebRTC voice connection with a synthetic microphone, and Gemini fallback grounding. It uses configured provider quota; it is not part of routine mocked tests. Human microphone/speaker quality still needs a real-device check.

Browser checks start the production build on port 3047, or use `STUDIO_TEST_URL`. They mock AI/discovery responses to verify the client workflow and also exercise real credential/private-address error paths. They verify the absence of a browser API-key field/header. The self-started test server uses an isolated temporary site directory and verifies all three real generated-site routes, refresh, access from another browser context, document isolation and 404 behavior. Unit tests verify atomic site storage, safe slugs, version replacement, corrupted-file handling, API-to-storage integration, environment-only keys, access control, configured-model selection and output repair. A real generation and visual-quality review requires a valid key configured in the server environment; passing mocked checks is not proof of live model output quality.

## Hosting

Deploy as a Node.js Next.js app, not a static export. Use `npm run build` and `npm start`. Discovery allows up to 240 seconds and plan/generate/refine routes up to 300 seconds; the hosting platform must permit that duration and streamed discovery responses. Provision Chromium with `npm run browser:install` or configure `CHROMIUM_EXECUTABLE_PATH`. Generated-site URLs require a writable persistent volume for `GENERATED_SITES_DIR`; read-only or ephemeral serverless filesystems do not provide durable links. Multi-instance hosts must share this directory. Prompt revision checks and write serialization are scoped to one Node process; run a single writer instance to prevent competing edits across processes. There is no database or account system. Knowledge drafts belong to this browser/device, while linked generated HTML is stored on the server. Rate limiting is an in-process guard, not a distributed quota service. Never expose a server key publicly without a configured studio token. This repository push does not deploy a live website.

Architecture: [CODE_PROFILE.md](CODE_PROFILE.md), [PROJECT_DATA_FLOW.md](PROJECT_DATA_FLOW.md), [CLIENT_TECHNICAL_QA.md](CLIENT_TECHNICAL_QA.md).

The Claude/Gemini/GPT switch was not exercised with test, build or live-generation runs, as requested. Earlier free-model generation attempts did not establish accepted live website output; testing the new configuration is left to the owner. Restart the studio after changing `.env.local`.

## Voice/chat verification on generated websites

Voice/chat controls are automatically attached to every saved generated URL and use that version's exact business knowledge. Their configured ElevenLabs/Gemini credentials are independent of the OpenRouter website-generation key. Pending connections time out after 45 seconds, cancelled/late sessions are cleaned up, and failed sends retain the typed question for retry. End and reconnect are supported on the generated page itself.

Run `npm run verify:assistant:live -- --speech` on Windows to test a synthetic spoken question in addition to live chat, audio playback, mute/end/reconnect and Gemini fallback. English Windows speech synthesis creates a WAV only inside isolated temporary storage. On another platform, use `--audio=/absolute/path/question.wav` (ask about Saturday hours and wheel truing, with initial silence for connection setup). The plain command still checks live connections without speech recognition assertions. This explicit probe uses provider quota; routine tests use mocks. Physical microphone/speaker quality requires a real-device check. These live assistant checks do not verify OpenRouter-generated website design quality.

## Larger crawls and saved progress

The default initial page cap is 500, with Read more pages expanding the same crawl up to 2,000. Continue discovery resumes a paused crawl, and Pause discovery keeps the saved pages available for generation. Existing 40-page browser discoveries can be resumed without discarding them. The app automatically continues while open; after closing/reloading, Continue resumes the saved cursor. Batches default to 40 pages and 75 seconds with four parallel static-page reads, reduced to one when robots requests a delay.

Configure CRAWL_MAX_PAGES (40-2,000), CRAWL_BATCH_PAGES (1-100), CRAWL_BATCH_SECONDS (5-150), CRAWL_CONCURRENCY (1-6) and optional CRAWL_STORAGE_DIR. Default source storage is ignored data/crawls. Records have a 64 MB limit, the frontier has a 12,000-URL limit, and attempts are bounded by three times the page cap. Use a persistent writable volume and one writer process.

Planning freezes an immutable source snapshot; the three designs use that same snapshot without repeatedly uploading the growing crawl. Above 40 source pages, AI receives prioritized business pages, deduplicated contacts and a bounded source index with explicit coverage. Full captured records remain available in browser review/source storage. Generation still has provider/context/hosting limits; saved crawl progress and completed designs survive partial failures.
