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

The server resolves the public URL, checks `robots.txt`, reads up to six sitemap files (including sitemap indexes), and follows same-origin HTML links. It prioritizes contact, services, about, pricing and location pages over archives. Chromium renders JavaScript-driven content when installed, with network requests passed through the same public-address guard. It extracts page titles, descriptions, headings, body text, telephone/email links, JSON-LD, source image URLs, CSS colors, font names and browser-computed design cues. The homepage's first four stylesheets also supply design evidence. Every page retains its source URL for review.

Discovery is bounded to 40 successful pages, 120 attempted page URLs, 180 seconds and bounded resources. Authentication, robots restrictions, non-HTML files, subdomains/off-site pages, query/filter pages and unreachable pages can prevent full coverage. Coverage and skipped pages are shown; the app cannot guarantee access to every page of an arbitrary site. Raw text is limited to 12,000 characters per page, and AI context uses a 100,000-character prose budget spread across all captured pages, preserving contact and metadata separately. Chromium is optional: without it, HTML discovery works and explicitly warns about missing JavaScript content.

Entered facts override conflicting website evidence. The generator is told to omit unknown facts, preserve offered services, use only supplied source or approved Pexels image URLs and retain required credits, and avoid invented contacts/testimonials/claims. Validation enforces owner-entered contacts, supported contact links, service names, useful anchors, valid responsive CSS, complete HTML and no executable content. A browser check at 390px and 1440px rejects horizontal overflow and hidden main headings when Chromium is available. These checks cannot guarantee aesthetic excellence or verify every factual sentence; the user should review all three designs.

## OpenRouter

The preferred starting models are [Thinking Machines Inkling](https://openrouter.ai/thinkingmachines/inkling:free), [Poolside Laguna S 2.1](https://openrouter.ai/poolside/laguna-s-2.1:free), and [NVIDIA Nemotron 3 Ultra](https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b:free). Their free endpoints were verified on 2026-10-09. These are practical choices based on published coding/design capabilities; they are not a guarantee of the best website quality. Laguna's current free listing expires on 2026-10-31, so ongoing catalogue validation and fallback are necessary.

`OPENROUTER_MODELS` sets the preferred order as comma-separated IDs. An empty value uses the same three built-in preferences. The app retrieves the [live model catalogue](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), filters zero-input/zero-output-price models with suitable context/output limits, and prefers only available qualifying IDs. It excludes safety-only and embedding models. Other eligible models are ranked using coding signals, context size and structured-output support and remain available as free fallbacks. If a preferred model disappears or becomes paid, it is skipped. Each version starts with a different available model when possible, and **Generation settings** allows a listed free model override. No paid fallback occurs: provider routing also caps input/output price at zero. The heuristic ranking is not a quality benchmark.

Generation uses [OpenRouter chat completions](https://openrouter.ai/docs/api/reference/overview). Plans use JSON Schema output when the chosen model supports it and are always checked locally. Reasoning-capable models use medium effort where supported; another catalogue-supported effort is used when medium is unavailable. Failed HTML validation gets one repair attempt per model, with at most three free model candidates and a 210-second operation budget. Rate limits, missing server keys, malformed output and partial failures are explicit. Accepted designs are preserved; retry generates only the requested or missing version. [Free-model rate limits](https://openrouter.ai/docs/api/reference/limits) depend on the account and provider.

## Checks

```sh
npm run check
npm run test:browser
```

`npm run verify:website:live -- --media-only` checks real Pexels search and image availability. With a configured OpenRouter key, `npm run verify:website:live -- --all` additionally generates all three fictional-business designs and refines version one, validating its stable URL and unchanged assistant knowledge. It uses live provider quota and is separate from routine mocked checks.

`npm run verify:assistant:live` is an explicit live-provider probe using an isolated temporary website and fictional bicycle-business knowledge. It exercises real ElevenLabs chat, a WebRTC voice connection with a synthetic microphone, and Gemini fallback grounding. It uses configured provider quota; it is not part of routine mocked tests. Human microphone/speaker quality still needs a real-device check.

Browser checks start the production build on port 3047, or use `STUDIO_TEST_URL`. They mock AI/discovery responses to verify the client workflow and also exercise real credential/private-address error paths. They verify the absence of a browser API-key field/header. The self-started test server uses an isolated temporary site directory and verifies all three real generated-site routes, refresh, access from another browser context, document isolation and 404 behavior. Unit tests verify atomic site storage, safe slugs, version replacement, corrupted-file handling, API-to-storage integration, environment-only keys, access control, free-model selection and output repair. A real generation and visual-quality review requires a valid key configured in the server environment; passing mocked checks is not proof of live model output quality.

## Hosting

Deploy as a Node.js Next.js app, not a static export. Use `npm run build` and `npm start`. Discovery and generation routes allow up to 240 seconds; the hosting platform must permit that duration and streamed discovery responses. Provision Chromium with `npm run browser:install` or configure `CHROMIUM_EXECUTABLE_PATH`. Generated-site URLs require a writable persistent volume for `GENERATED_SITES_DIR`; read-only or ephemeral serverless filesystems do not provide durable links. Multi-instance hosts must share this directory. Prompt revision checks and write serialization are scoped to one Node process; run a single writer instance to prevent competing edits across processes. There is no database or account system. Knowledge drafts belong to this browser/device, while linked generated HTML is stored on the server. Rate limiting is an in-process guard, not a distributed quota service. Never expose a server key publicly without a configured studio token. This repository push does not deploy a live website.

Architecture: [CODE_PROFILE.md](CODE_PROFILE.md), [PROJECT_DATA_FLOW.md](PROJECT_DATA_FLOW.md), [CLIENT_TECHNICAL_QA.md](CLIENT_TECHNICAL_QA.md).

## Voice/chat verification on generated websites

Voice/chat controls are automatically attached to every saved generated URL and use that version's exact business knowledge. Their configured ElevenLabs/Gemini credentials are independent of the OpenRouter website-generation key. Pending connections time out after 45 seconds, cancelled/late sessions are cleaned up, and failed sends retain the typed question for retry. End and reconnect are supported on the generated page itself.

Run `npm run verify:assistant:live -- --speech` on Windows to test a synthetic spoken question in addition to live chat, audio playback, mute/end/reconnect and Gemini fallback. English Windows speech synthesis creates a WAV only inside isolated temporary storage. On another platform, use `--audio=/absolute/path/question.wav` (ask about Saturday hours and wheel truing, with initial silence for connection setup). The plain command still checks live connections without speech recognition assertions. This explicit probe uses provider quota; routine tests use mocks. Physical microphone/speaker quality requires a real-device check. These live assistant checks do not verify OpenRouter-generated website design quality.
