# Website Studio client technical Q&A

## What does the customer fill in?

One knowledge page. Only description is required. Business name/type, industry intelligence, website link, phone, email, location, service area, hours, service names/details and additional knowledge are optional. The app does not demand a complete profile before generating.

## What happens when an existing website link is entered?

It automatically discovers public pages using internal links and sitemaps, observes robots restrictions, optionally renders JavaScript content, and extracts business copy, contacts, structured details, images, fonts and colors. Each record retains its source URL. The customer can review extracted evidence and coverage or refresh discovery. Failed discovery offers a retry or explicit continuation using entered knowledge.

## Can it read absolutely everything?

It reads up to 40 successful same-origin HTML pages, bounded by time/resources. Login-only pages, restricted pages, query/filter URLs, non-HTML downloads, subdomains and unreachable content are outside this crawl. Text is shortened when necessary; contacts/metadata are separate. It reports discovered/read/skipped counts and limitations. It cannot promise every detail from every arbitrary website.

## Are the three websites hardcoded?

No. AI creates three original design directions, then generates each full HTML document and its original CSS. There is no runtime skill document, template website, predefined theme or static fallback. Application CSS styles the studio controls only. Structural and viewport checks reject certain failures, but design quality still needs customer review.

## Which AI provider/models are used?

OpenRouter chat completions. The default preference is Thinking Machines Inkling, Poolside Laguna S 2.1 and NVIDIA Nemotron 3 Ultra, verified as available/free on 2026-10-09. The administrator can change their order using `OPENROUTER_MODELS`. Every preferred model is checked against the live catalogue's availability, zero pricing and context/output limits; unavailable or paid preferences are skipped. Each version starts with a separate available free model where possible. The customer can override with a listed free model in Generation settings. A bounded fallback can use other free models; paid models are never selected. These are practical starting choices, not proof that a model is universally best. Reasoning effort respects each model's advertised support.

## Where does the API key go?

The administrator sets `OPENROUTER_API_KEY` in the ignored `.env.local` file or the hosting environment and restarts the app. The provider key stays entirely on the server. The website has no API-key input, sends no provider-key browser header, and ignores browser-supplied key overrides. Production use requires a separate studio access token, entered in Generation settings and kept only in session memory. Local development needs only the environment API key unless a studio token is configured.

## What if generation fails?

Each accepted design saves separately on the server and in the customer's browser draft. A failed version displays an error and can be retried. Invalid HTML gets one AI repair per candidate model, with at most three free model candidates and a bounded operation duration. Missing keys, exhausted quota, provider errors, storage failures and unfinished output are reported; they do not produce a fake completed website. The previous successful file at the same business/version URL is preserved if regeneration or saving fails.

## What URLs do the generated websites use?

`/service/{business-slug}/1`, `/2`, and `/3`. For example, Northline Heating becomes `/service/northline-heating/1`. Names are normalized for URL paths; a missing name uses a description-hash slug, so business name remains optional. The links use whichever host/port runs the app. Open website appears beside Download HTML. Each route opens the original generated HTML as a full standalone website. Regenerating a version updates that same URL. Older browser-only designs receive URLs when regenerated.

## Can the link be refreshed or opened in another browser?

Yes, once that version has been generated and saved. The Node server reads its stored artifact; it does not need the original browser's IndexedDB or call AI again. Anyone who can reach this server can read that generated-site URL. Generated output is isolated from studio storage and credentials. Production must provide a persistent writable directory through `GENERATED_SITES_DIR`; ephemeral/read-only hosting cannot retain these files reliably. Distinct businesses need distinct slugs. Unknown businesses and missing/invalid versions return 404.

## Do the websites have multiple pages, lead forms or bookings?

They are complete responsive single-document websites with section navigation and real contact links when supported by evidence. They do not implement booking, payments, form submission or publishing backends. Those require separate integration. Source images and fonts may remain external; downloading HTML does not download every external asset.

## What has been tested?

Unit checks cover required/optional fields, URL/address safety, contact/design extraction, sitemap/robots behavior, free models, artifact checks, provider repair, generated-site paths, atomic storage, independent version updates, corrupt-file handling and API-to-storage integration. Browser checks cover the client workflow, previews, downloads, persistence, key exclusion and mobile layout using mocked AI responses. The self-started server also checks all three real website URLs, refresh, another browser context, document isolation, 404 behavior and API errors. Live public-site discovery can be tested without a key. Live AI generation and visual-quality confirmation require a configured server key; mocked responses are not real model output.

## Does this change the original EverOnn project?

This branch replaces the old application with an independent studio. Work was carried out in a separate checkout. The original working project, its uncommitted changes, integrations and databases are not migrated into this branch. Pushing this Git branch does not deploy or alter the original live app.
