# Website Studio client technical Q&A

## Can I enter a URL and get a website inventory and improvement report?

The project workspace now has a website intelligence panel that can crawl the project URL, freeze captured evidence and produce a private report. While a site is being crawled, the workspace shows how many pages were captured, are pending or were skipped, not a list of every internal page; the captured content is kept privately for the report. You can also refresh/select an existing frozen snapshot. The report lists captured pages, source features/forms/integrations, media references, CSS/design tokens, selected UX/SEO/accessibility findings and prioritized improvements with cited evidence and acceptance criteria. Page details include source business-data candidates and desktop/tablet/mobile replay screenshots. JSON download and saved report history are available.

This is the initial implemented assessment scope, not a guarantee of understanding every private backend, interactive state or original design component. Unread pages, scope exclusions, resource/parser limits and missing browser checks remain explicit. Original forms/booking/checkout are not submitted. A report marked complete within scope means the required assessment finished; it does not certify the source site or the production product. Browser screenshots replay frozen HTML with later permitted resources, so original-live behavior can differ. Automated accessibility checks do not certify compliance, and improvements do not guarantee rankings or sales.

The 16-page frozen-source report UI and actual browser/SQL evidence passed fixture-based regression checks. At the top of the report, **How our agent can make your website better** shows, in plain language, what the website is lacking to attract customers, how the EverOnn agent will enhance it, and the exact prompt the agent will work from (copyable), with the evidence behind it. It is written by the configured OpenRouter model following the `site-growth-advisor` skill. Once the agent has generated the website (at least one verified build), owners can type a correction (for example "we don't offer delivery"); before that, the panel explains that corrections open after generation. it is remembered for the project and used in all later advice, and the advice is regenerated as a new revision without changing the sealed evidence report. Corrections can be withdrawn. On 2026-10-10 this was verified live: a crawl of example.com produced a complete-within-scope report and Gemini Pro advice through OpenRouter, and a saved correction was applied in the regenerated prompt; growth advice was also generated in the workspace UI for a 28-page report. The advice is a proposal, not a guarantee of customers, rankings or sales. A scripted new-URL single-button browser regression is still pending. Optional model recommendations are evidence-linked proposals, separate from observed findings and approved facts/blueprints. See [the current handoff](docs/engineering/CURRENT-WORK-HANDOFF.md) for what is implemented, tested and still pending. PostgreSQL/OIDC/S3 service setup remains deferred until the final stage.

## Do the three generated websites match the kind of business?

Yes, that is the designer's first job. Each of the three websites is designed by an agent following the `website-designer` skill: it reads the business's real pages, facts, the improvement brief from the growth review ("the prompt our agent will work from") and the owner's corrections, decides the industry, the audience and the vibe that will attract them, and then designs. A cafe gets warm, relaxed, inviting looks; an education site gets energetic, clear, credible ones, never the other way round. The three alternatives are different expressions within that same right world. Each website shows its "Design" note: how the agent read the business, its palette, type and motif, and whether your brief and corrections were used. Every design is rendered and measured before it is accepted, and a broken layout (such as a squeezed headline) is sent back for one repair or rejected. All pages and approved content are still rendered by trusted code, and each build is still verified exactly. On 2026-10-10 this was checked live on a cafe site and an education site. Typography uses fonts already installed on visitors' devices, because external fonts and images are not allowed in generated CSS.

## Can I review a generated website and see evidence for the claims?

Yes. In the project workspace, select a compiled build under **Website review and comparison**. Inspect its preview, open the evidence report or download it as JSON. A person with review permission can record an exact-build approval or request changes after reviewing brand/layout, content/facts, mobile/keyboard behavior, working features and differences between alternatives. Reviews are immutable and survive reload. Approval of a preview does not authorize publication.

Reports show required/exported pages, explicit exclusions, source coverage, test evidence and the actual reviewer decision. They distinguish observations, measured artifact bytes, human design judgments and unassessed business outcomes. They make no unsupported speed, SEO or sales improvement claim. Fixture runs are labeled. Failed candidates remain blocked and cannot inherit a previous build's approval.

New builds are checked at desktop, tablet and mobile widths, with exact displayed business details, page-specific titles, complete route reachability, redirects, keyboard journeys and enquiry validation/duplicate prevention. These checks do not establish comprehensive accessibility compliance or production deployment readiness. Source images, richer widgets, email/booking and public publication remain additional work; text/page/archive limits are disclosed before blueprint approval.

## What is the agreed next engineering direction?

The [engineering specification](docs/engineering/README.md) defines the platform direction. `/projects` implements ownership/storage, frozen discovery, an initial public-site intelligence report and [approved facts, immutable blueprints and three complete Next.js builds](docs/engineering/07-facts-blueprints-and-website-builds.md), including exact-build checks, private previews and a real enquiry inbox. Deeper audit coverage, background workers and authorized public publication/rollback remain future stages. PostgreSQL/OIDC/S3 setup is intentionally deferred. The answers below describe the existing studio unless they explicitly refer to the project workspace.

## How can I use the new project workspace locally?

Run `npm run platform:dev`, open `http://localhost:3000/projects`, choose Open local workspace, and create a workspace/project. Missing local database directories are created automatically, fixing the reported sign-in failure. Data persists in local PGlite/private files. Scan/freeze source evidence, extract/review facts, approve the page blueprint, then generate three complete alternatives. Compilation and verification progress are saved; reload offers resume. Existing studio designs are not automatically imported. External PostgreSQL/OIDC/S3 setup is reserved for the final infrastructure stage.

## Can I scan and preserve a website inside the project workspace?

Yes. Create a project with its public source URL, start a scan, review captured/pending/skipped pages, and pause or resume it. The workspace runs bounded batches while open; reloading offers resume from server-side progress. Full normalized text and accepted response bodies are archived privately, with per-page capture timestamps and hashes. Account pages, files, external origins and query/filter URLs are outside scope; network/robots/rendering limits remain explicit. Images are references rather than archived files.

Freeze a source snapshot after its batch stops. Incomplete coverage needs an explicit acknowledgment. The snapshot fixes URL membership and accepted captures to that scan revision; continuing or refreshing discovery cannot alter it. Authorized viewers can review full captured text. Discovery alone does not establish completion; fact approval, blueprint approval, actual compilation and exact-build verification follow separately.

## What does “verified” mean for a project website now?

Every approved rendered route is exported, its complete approved source text is preserved, internal links resolve, unknown routes return 404, desktop/mobile pages fit and show the source content, and the trusted enquiry form saves a real validated enquiry to the project inbox. Browser execution is required; unavailable checks block completion. Three alternatives use the same immutable approved inputs and have separate build seals. A new candidate leaves older previews intact. Visual quality remains a human judgment; no sales/performance improvement is claimed without measurements.

## Do the generated forms work, and can I download the websites?

Yes, private previews save editor-authorized enquiries to the project inbox. They explicitly disclose that email delivery and public deployment need later configuration; they do not simulate booking or email success. Test enquiries are kept separate. You can download complete Next.js source and compiled output ZIPs. These retain their fixed private-preview base path and gateway contract; independent public hosting requires later deployment bindings and authorization.

## What does the customer fill in?

The remaining questions describe the original studio at `/` and its `/service` HTML generator. The separate `/projects` pipeline above uses approved snapshots/facts, a trusted Next.js scaffold, private previews and its project inbox.

One knowledge page. Business name, business type and description are required. Industry intelligence, website link, phone, email, location, service area, hours, service names/details and additional knowledge are optional. The app does not demand a complete profile before generating.

## What happens when an existing website link is entered?

It automatically discovers public pages using internal links and sitemaps, observes robots restrictions, optionally renders JavaScript content, and extracts business copy, contacts, structured details, images, fonts and colors. Each record retains its source URL. The customer can review extracted evidence and coverage or refresh discovery. Failed discovery offers a retry or explicit continuation using entered knowledge.

## Can it read absolutely everything?

It initially reads up to 500 successful same-origin HTML pages and supports continuation up to 2,000, using persisted batches bounded by time/resources. Login-only pages, restricted pages, query/filter URLs, non-HTML downloads, subdomains and unreachable content are outside this crawl. Text is shortened when necessary; contacts/metadata are separate. It reports discovered/read/skipped counts and limitations. It cannot promise every detail from every arbitrary website.

## Are the three websites hardcoded?

No. AI creates three original design directions, then generates each full HTML document and its original CSS. AI receives the runtime website-building SKILL.md, business knowledge, captured website evidence and approved photo assets. The skill defines design/quality rules without supplying a template website, predefined layout/theme or static fallback. Application CSS styles the studio controls only. Structural and viewport checks reject certain failures, but design quality still needs customer review.

## Which AI provider/models are used?

OpenRouter chat completions. Default version order is Claude Opus Latest (`~anthropic/claude-opus-latest`), Gemini Pro Latest (`~google/gemini-pro-latest`) and GPT-6.1 Sol (`openai/gpt-6.1-sol`). The public catalogue confirmed these IDs/capabilities on 2026-10-09. Latest aliases currently resolve to Claude Opus 5.5 and Gemini 3.1 Pro Preview and follow future family updates. These are paid models requiring OpenRouter credit. `OPENROUTER_MODELS` changes the ordered allowlist; only available configured models with suitable text/context/output support can be selected or used as fallback. Generation settings can override a version with a listed model. No other paid/free models are added automatically. Reasoning uses supported medium effort or a supported bounded/default control. No model guarantees the best design; review each generated site. Alternatively, `WEBSITE_PROVIDER=gemini` uses the Gemini API directly with `GEMINI_API_KEY` and `GEMINI_WEBSITE_MODELS` (default `gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash`), with no OpenRouter credit needed. On 2026-10-09 a live run on a free-tier key produced all three versions of a 364-page-source business in 140–203 seconds in parallel; that key had no Gemini Pro quota and allows 5 requests per minute per model.

## Where does the API key go?

The administrator sets `OPENROUTER_API_KEY` in the ignored `.env.local` file or the hosting environment and restarts the app. The provider key stays entirely on the server. The website has no API-key input, sends no provider-key browser header, and ignores browser-supplied key overrides. Production use requires a separate studio access token, entered in Generation settings and kept only in session memory. Local development needs only the environment API key unless a studio token is configured.

## How do voice and chat get the website knowledge?

Generation saves the exact business/evidence packet beside each website artifact. Voice/chat load that snapshot from the server using business name slug, version and artifact revision. Both receive the same business name/type/description, optional details/services and extracted website evidence. The current website and its assistant update together on regeneration; changing the unsaved studio form does not change an existing site's answers.

## Is this the same agent connection as the main project?

Yes: ElevenLabs live voice via WebRTC, ElevenLabs text-only chat via WebSocket, and Gemini text fallback. Existing dynamic-variable names and compatible agent configuration are reused without modifying the shared ElevenLabs agent. Provider credentials are configured only in this branch's ignored env file. No main-project source, database, scheduling integration or usage meter is imported or modified.

## Where do the controls appear?

Chat with us and Talk to us appear on all generated website URLs and beside the studio preview. The generated design keeps its AI HTML/CSS. A trusted application frame supplies the interactive controls, while CSP blocks arbitrary model-authored JavaScript. Voice asks for microphone access when clicked and needs HTTPS or localhost. It supports mute, end, reconnect and transcripts. Provider/permission errors are shown; live chat can fall back to configured Gemini.

## Can this assistant book appointments or submit callbacks?

Yes, through the voice (and live chat) assistant once the business connects Google in the studio's **Bookings & calendar** panel and sets its time zone. This ports the main branch's Google Calendar and Gmail integration, per generated business instead of per workspace. The shared ElevenLabs agent's tools call the server: `check_availability` checks Google Calendar free/busy, and `book_appointment` creates the event only after the caller explicitly agrees and gives a name and callback number. The server validates the service against the business's services, requires an exact future date and time that exists in the business time zone, re-checks availability under a lock, and uses a deterministic event ID so a repeated tool call cannot double-book. The agent may say "booked" only when the tool returns `booked=true`. Each booking and every callback or human follow-up request (`capture_lead`, `request_human_handoff`) is saved, shown in the panel and emailed to the business through the connected Gmail account. Without a connection the agent is told booking is off and offers a callback request instead. Gemini text-chat fallback has no tools and still never claims a booking. Transfers and payments are not available. A live booking requires a Google OAuth client (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`); on 2026-10-09 the flow was verified with automated tests against simulated Google responses, not a live Google account.

## What if generation fails?

Each accepted design saves separately on the server and in the customer's browser draft. A failed version displays an error and can be retried. Invalid HTML gets one AI repair per candidate model, with at most three configured model candidates and a bounded operation duration. Missing keys, exhausted quota, provider errors, storage failures and unfinished output are reported; they do not produce a fake completed website. The previous successful file at the same business/version URL is preserved if regeneration or saving fails.

## What URLs do the generated websites use?

`/service/{business-slug}/1`, `/2`, and `/3`. For example, Northline Heating becomes `/service/northline-heating/1`. Required business names are normalized for URL paths. Older unnamed website slugs remain readable. The links use whichever host/port runs the app. Open website appears beside Download HTML. Each route opens the original generated HTML as a full standalone website. Regenerating or refining a version updates that same URL. Older browser-only designs receive URLs when regenerated.

## Can the link be refreshed or opened in another browser?

Yes, once that version has been generated and saved. The Node server reads its stored artifact; it does not need the original browser's IndexedDB or call AI again. Anyone who can reach this server can read that generated-site URL. Generated output is isolated from studio storage and credentials. Production must provide a persistent writable directory through `GENERATED_SITES_DIR`; ephemeral/read-only hosting cannot retain these files reliably. Distinct businesses need distinct slugs. Unknown businesses and missing/invalid versions return 404.

## Do the websites have multiple pages, lead forms or bookings?

Each of the three designs starts as one complete responsive home page. After choosing a design, **Build full site** expands it into a multi-page website: the AI mirrors the crawled website: one new page per source page that has real content (about, menu, reservations, each gallery, contact, blog, terms, privacy and so on, up to 12 plus home), each built from the full captured text and images of its source page; without a source website it picks 1–4 pages from the business knowledge, builds each page in the chosen design, and links them from the home page navigation. Pages get their own links (for example `/service/ti-tea-post/3/menu`), can be edited individually from the studio's page tabs, and download together as a ZIP. On 2026-10-09 a live run expanded an 11-page cafe website into an 11-page site (home plus about, reservation, contact, four gallery pages, blog, terms and privacy) in 2 minutes 43 seconds, with every page linked from the home navigation. Photos are shown without captions or labels; only required photo credits appear. They do not implement booking, payments, form submission or publishing backends. Those require separate integration. Source/Pexels images and fonts may remain external; downloading HTML does not download every external asset.

## What has been tested?

Unit checks cover the three required fields, partial drafts, Pexels caching/provider IDs/credits, prompt refinement, stale-edit conflict recovery, unchanged assistant knowledge, required/optional fields, URL/address safety, contact/design extraction, sitemap/robots behavior, configured model selection, artifact checks, provider repair, generated-site paths, atomic storage, independent version updates, corrupt-file handling and API-to-storage integration. Browser checks cover required fields, failed/successful edits, stable edited URLs, history persistence, the client workflow, previews, downloads, persistence, key exclusion and mobile layout using mocked AI responses. The self-started server also checks all three real website URLs, refresh, another browser context, document isolation, 404 behavior and API errors. Live public-site discovery can be tested without a key. Live AI generation and visual-quality confirmation require a configured server key; mocked responses are not real model output.

## Does this change the original EverOnn project?

This branch replaces the old application with an independent studio. Work was carried out in a separate checkout. The original working project, its uncommitted changes, integrations and databases are not migrated into this branch. Pushing this Git branch does not deploy or alter the original live app.

On 2026-10-09, the explicit live assistant probe verified ElevenLabs text answers against fictional bicycle-business facts, a WebRTC voice connection with synthetic microphone input and functioning mute/end controls, and a Gemini text answer from the same saved knowledge. This does not verify a real user's microphone/speaker quality or live OpenRouter website design quality.

## How do photos get onto the website?

The administrator sets server-only PEXELS_API_KEY. AI writes generic image-search phrases from the business brief; the server gets real photos and photographer credits from Pexels. The website AI receives those exact verified assets and decides which to use and how to compose/crop them. Images must match supplied assets; used stock photographs require visible Pexels and photographer credits. Missing keys, no matches or provider failure are reported, while source images or original graphics can support the design. Stock imagery is illustrative and must not be presented as the actual company team or completed work. The photo key stays out of browser state, bundles and Git.

## How can the customer request design changes?

Select a version, type into Describe your changes, then choose Apply changes. For example: make the headline larger, use warmer colors and give the services section more breathing room. AI receives the saved website, its original knowledge and photos, the active SKILL.md and accepted edits. The validated result updates that version at its existing URL; the other two versions are kept. Its assistant still answers from the original business knowledge. Unknown/new business facts must be added to Business knowledge followed by regeneration. Failed edits keep the accepted website and typed prompt; stale versions load the latest saved design while retaining the typed prompt for review/retry. The last 20 accepted requests and unfinished prompts are saved. Regeneration starts fresh history. Older generated sites need one regeneration to enable editing.

## Was real Pexels and real website AI tested?

On 2026-10-09, a live Pexels search returned four photographs and a returned image URL loaded successfully. Unit/provider/browser checks verify required fields, verified images/credits, selected-version prompt editing, failed edits, stable URLs, history/prompt persistence, unchanged assistant facts, stale-write rejection and loading the latest design after a conflict. OpenRouter responses are mocked in these checks; a key is now configured locally. Real AI planning succeeded, while initial full-generation attempts timed out. Follow-up live results are reported below.

## Are chat and voice on the generated websites themselves?

Yes. Chat with us and Talk to us appear on every saved `/service/{business}/1`, `/2` and `/3` website, as well as the studio preview. Both use that website version's saved knowledge, including captured website evidence. Voice/chat credentials are already configured in the local studio environment and stay server-side. Voice starts when clicked and microphone access is allowed; it supports spoken questions, audible replies, transcripts, mute, end and reconnect. Gemini supplies text fallback when live chat cannot connect.

Connections have a 45-second initialization limit. Closing the widget ignores delayed SDK callbacks and ends any late session. Failed sending retains the typed question for retry. Automated unit/browser checks verify cancellation/error handling and responsive controls; explicit live checks verify provider connections and fictional-business answers. Synthetic speech/device checks cannot establish the quality of every physical microphone, speaker or network. Downloaded static HTML still needs this app's backend for a live assistant; use the generated website URLs for the connected experience.

On 2026-10-09, the live generated-site check verified both controls on versions 1?3, real ElevenLabs chat answers, a synthetic spoken microphone question with a knowledge-grounded voice answer, incoming audio playback, mute/end/reconnect, and real Gemini fallback. Synthetic devices verify the integration; physical microphone/speaker quality still needs a real-device check.

## Can a crawl continue beyond 40 pages?

Yes. The initial target is now 500 pages, extendable through Read more pages up to 2,000. Requests process 40-page/75-second batches by default, with saved progress and four parallel reads where robots rules permit. Continue discovery resumes from saved URLs instead of starting over. Existing 40-page browser knowledge can be preserved and extended. You can pause and generate from the collected pages. The server needs writable persistent source storage; closing the browser pauses automatic continuation. Restricted/unreachable pages and resource limits can still stop coverage.

Larger crawls retain all captured page records, but the AI packet prioritizes business evidence and deduplicated contacts within context limits. It does not send thousands of complete pages in one enormous prompt. All three generated versions use the same frozen source snapshot, and each assistant uses the exact corresponding website packet.

## Are timeouts eliminated?

No. Crawl batches save progress so a long site can continue through multiple requests. AI generation still depends on provider speed/quota and hosting limits; it uses bounded calls, configured-model fallback, validation/repair and per-version retries. Complete versions remain saved if another fails. A provider key is now configured locally and is excluded from Git/browser output.

Reasoning controls follow advertised capabilities, preferring medium effort or a supported budget/default. Website responses allow up to 12,000 output tokens including reasoning, bounded by model limits; plans allow 5,000 tokens. Document repair identifies missing/unsupported elements. Obsolete X-UA-Compatible metadata is removed without changing AI layout/CSS. Photo-credit checks normalize whitespace consistently. The explicit website verifier supports `--resume` and `--model=ID`, preserving ignored fictional-business artifacts; running it uses configured OpenRouter credits.

The owner requested no testing for the Claude/Gemini/GPT change. No test, build or live-generation runs were performed after that instruction; the new configuration remains unverified end to end. Earlier free-model attempts did not validate accepted live site output. Restart the local studio to load the updated model environment.
