# Website Studio client technical Q&A

## What does the customer fill in?

One knowledge page. Business name, business type and description are required. Industry intelligence, website link, phone, email, location, service area, hours, service names/details and additional knowledge are optional. The app does not demand a complete profile before generating.

## What happens when an existing website link is entered?

It automatically discovers public pages using internal links and sitemaps, observes robots restrictions, optionally renders JavaScript content, and extracts business copy, contacts, structured details, images, fonts and colors. Each record retains its source URL. The customer can review extracted evidence and coverage or refresh discovery. Failed discovery offers a retry or explicit continuation using entered knowledge.

## Can it read absolutely everything?

It reads up to 40 successful same-origin HTML pages, bounded by time/resources. Login-only pages, restricted pages, query/filter URLs, non-HTML downloads, subdomains and unreachable content are outside this crawl. Text is shortened when necessary; contacts/metadata are separate. It reports discovered/read/skipped counts and limitations. It cannot promise every detail from every arbitrary website.

## Are the three websites hardcoded?

No. AI creates three original design directions, then generates each full HTML document and its original CSS. AI receives the runtime website-building SKILL.md, business knowledge, captured website evidence and approved photo assets. The skill defines design/quality rules without supplying a template website, predefined layout/theme or static fallback. Application CSS styles the studio controls only. Structural and viewport checks reject certain failures, but design quality still needs customer review.

## Which AI provider/models are used?

OpenRouter chat completions. The default preference is Thinking Machines Inkling, Poolside Laguna S 2.1 and NVIDIA Nemotron 3 Ultra, verified as available/free on 2026-10-09. The administrator can change their order using `OPENROUTER_MODELS`. Every preferred model is checked against the live catalogue's availability, zero pricing and context/output limits; unavailable or paid preferences are skipped. Each version starts with a separate available free model where possible. The customer can override with a listed free model in Generation settings. A bounded fallback can use other free models; paid models are never selected. These are practical starting choices, not proof that a model is universally best. Reasoning effort respects each model's advertised support.

## Where does the API key go?

The administrator sets `OPENROUTER_API_KEY` in the ignored `.env.local` file or the hosting environment and restarts the app. The provider key stays entirely on the server. The website has no API-key input, sends no provider-key browser header, and ignores browser-supplied key overrides. Production use requires a separate studio access token, entered in Generation settings and kept only in session memory. Local development needs only the environment API key unless a studio token is configured.

## How do voice and chat get the website knowledge?

Generation saves the exact business/evidence packet beside each website artifact. Voice/chat load that snapshot from the server using business name slug, version and artifact revision. Both receive the same business name/type/description, optional details/services and extracted website evidence. The current website and its assistant update together on regeneration; changing the unsaved studio form does not change an existing site's answers.

## Is this the same agent connection as the main project?

Yes: ElevenLabs live voice via WebRTC, ElevenLabs text-only chat via WebSocket, and Gemini text fallback. Existing dynamic-variable names and compatible agent configuration are reused without modifying the shared ElevenLabs agent. Provider credentials are configured only in this branch's ignored env file. No main-project source, database, scheduling integration or usage meter is imported or modified.

## Where do the controls appear?

Chat with us and Talk to us appear on all generated website URLs and beside the studio preview. The generated design keeps its AI HTML/CSS. A trusted application frame supplies the interactive controls, while CSP blocks arbitrary model-authored JavaScript. Voice asks for microphone access when clicked and needs HTTPS or localhost. It supports mute, end, reconnect and transcripts. Provider/permission errors are shown; live chat can fall back to configured Gemini.

## Can this assistant book appointments or submit callbacks?

The standalone branch currently answers business questions and supplies contact guidance. Its calendar, email delivery, transfer and callback-saving workflows are not connected. The main agent's corresponding tools return truthful unavailable state, and Gemini replies are checked for false action confirmations. Nothing is described as booked, sent or submitted without an actual integration.

## What if generation fails?

Each accepted design saves separately on the server and in the customer's browser draft. A failed version displays an error and can be retried. Invalid HTML gets one AI repair per candidate model, with at most three free model candidates and a bounded operation duration. Missing keys, exhausted quota, provider errors, storage failures and unfinished output are reported; they do not produce a fake completed website. The previous successful file at the same business/version URL is preserved if regeneration or saving fails.

## What URLs do the generated websites use?

`/service/{business-slug}/1`, `/2`, and `/3`. For example, Northline Heating becomes `/service/northline-heating/1`. Required business names are normalized for URL paths. Older unnamed website slugs remain readable. The links use whichever host/port runs the app. Open website appears beside Download HTML. Each route opens the original generated HTML as a full standalone website. Regenerating or refining a version updates that same URL. Older browser-only designs receive URLs when regenerated.

## Can the link be refreshed or opened in another browser?

Yes, once that version has been generated and saved. The Node server reads its stored artifact; it does not need the original browser's IndexedDB or call AI again. Anyone who can reach this server can read that generated-site URL. Generated output is isolated from studio storage and credentials. Production must provide a persistent writable directory through `GENERATED_SITES_DIR`; ephemeral/read-only hosting cannot retain these files reliably. Distinct businesses need distinct slugs. Unknown businesses and missing/invalid versions return 404.

## Do the websites have multiple pages, lead forms or bookings?

They are complete responsive single-document websites with section navigation and real contact links when supported by evidence. They do not implement booking, payments, form submission or publishing backends. Those require separate integration. Source/Pexels images and fonts may remain external; downloading HTML does not download every external asset.

## What has been tested?

Unit checks cover the three required fields, partial drafts, Pexels caching/provider IDs/credits, prompt refinement, stale-edit conflict recovery, unchanged assistant knowledge, required/optional fields, URL/address safety, contact/design extraction, sitemap/robots behavior, free models, artifact checks, provider repair, generated-site paths, atomic storage, independent version updates, corrupt-file handling and API-to-storage integration. Browser checks cover required fields, failed/successful edits, stable edited URLs, history persistence, the client workflow, previews, downloads, persistence, key exclusion and mobile layout using mocked AI responses. The self-started server also checks all three real website URLs, refresh, another browser context, document isolation, 404 behavior and API errors. Live public-site discovery can be tested without a key. Live AI generation and visual-quality confirmation require a configured server key; mocked responses are not real model output.

## Does this change the original EverOnn project?

This branch replaces the old application with an independent studio. Work was carried out in a separate checkout. The original working project, its uncommitted changes, integrations and databases are not migrated into this branch. Pushing this Git branch does not deploy or alter the original live app.

On 2026-10-09, the explicit live assistant probe verified ElevenLabs text answers against fictional bicycle-business facts, a WebRTC voice connection with synthetic microphone input and functioning mute/end controls, and a Gemini text answer from the same saved knowledge. This does not verify a real user's microphone/speaker quality or live OpenRouter website design quality.

## How do photos get onto the website?

The administrator sets server-only PEXELS_API_KEY. AI writes generic image-search phrases from the business brief; the server gets real photos and photographer credits from Pexels. The website AI receives those exact verified assets and decides which to use and how to compose/crop them. Images must match supplied assets; used stock photographs require visible Pexels and photographer credits. Missing keys, no matches or provider failure are reported, while source images or original graphics can support the design. Stock imagery is illustrative and must not be presented as the actual company team or completed work. The photo key stays out of browser state, bundles and Git.

## How can the customer request design changes?

Select a version, type into Describe your changes, then choose Apply changes. For example: make the headline larger, use warmer colors and give the services section more breathing room. AI receives the saved website, its original knowledge and photos, the active SKILL.md and accepted edits. The validated result updates that version at its existing URL; the other two versions are kept. Its assistant still answers from the original business knowledge. Unknown/new business facts must be added to Business knowledge followed by regeneration. Failed edits keep the accepted website and typed prompt; stale versions load the latest saved design while retaining the typed prompt for review/retry. The last 20 accepted requests and unfinished prompts are saved. Regeneration starts fresh history. Older generated sites need one regeneration to enable editing.

## Was real Pexels and real website AI tested?

On 2026-10-09, a live Pexels search returned four photographs and a returned image URL loaded successfully. Unit/provider/browser checks verify required fields, verified images/credits, selected-version prompt editing, failed edits, stable URLs, history/prompt persistence, unchanged assistant facts, stale-write rejection and loading the latest design after a conflict. OpenRouter responses are mocked in these checks; the local OPENROUTER_API_KEY is currently empty, so real generated design quality and real AI edits remain unverified. An explicit verify:website:live command can test them once the environment key is configured.

## Are chat and voice on the generated websites themselves?

Yes. Chat with us and Talk to us appear on every saved `/service/{business}/1`, `/2` and `/3` website, as well as the studio preview. Both use that website version's saved knowledge, including captured website evidence. Voice/chat credentials are already configured in the local studio environment and stay server-side. Voice starts when clicked and microphone access is allowed; it supports spoken questions, audible replies, transcripts, mute, end and reconnect. Gemini supplies text fallback when live chat cannot connect.

Connections have a 45-second initialization limit. Closing the widget ignores delayed SDK callbacks and ends any late session. Failed sending retains the typed question for retry. Automated unit/browser checks verify cancellation/error handling and responsive controls; explicit live checks verify provider connections and fictional-business answers. Synthetic speech/device checks cannot establish the quality of every physical microphone, speaker or network. Downloaded static HTML still needs this app's backend for a live assistant; use the generated website URLs for the connected experience.

On 2026-10-09, the live generated-site check verified both controls on versions 1?3, real ElevenLabs chat answers, a synthetic spoken microphone question with a knowledge-grounded voice answer, incoming audio playback, mute/end/reconnect, and real Gemini fallback. Synthetic devices verify the integration; physical microphone/speaker quality still needs a real-device check.
