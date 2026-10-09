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

OpenRouter chat completions. Suitable currently available zero-price models are discovered from its live catalogue and ranked using coding signals, context and structured-output support. Each version starts with a separate available free model where possible. The customer can select a listed free model. A bounded fallback can use other free models; paid models are never selected. Ranking is a practical heuristic, not proof that a model is the best.

## Where does the API key go?

The customer can enter it in Connection settings. It stays in session memory and is sent to this app's server for the provider call; it is not saved in the browser draft, source repository or knowledge export. A server environment key is also supported. Production use of a server key requires a studio access token. Entered credentials disappear on refresh.

## What if generation fails?

Each accepted design saves separately on the customer's device. A failed version displays an error and can be retried. Invalid HTML gets one AI repair per candidate model, with at most three free model candidates and a bounded operation duration. Missing keys, exhausted quota, provider errors and unfinished output are reported; they do not produce a fake completed website.

## Do the websites have multiple pages, lead forms or bookings?

They are complete responsive single-document websites with section navigation and real contact links when supported by evidence. They do not implement booking, payments, form submission or publishing backends. Those require separate integration. Source images and fonts may remain external; downloading HTML does not download every external asset.

## What has been tested?

Unit checks cover required/optional fields, URL/address safety, contact and design extraction, sitemap/robots behavior, free-model eligibility, artifact checks, provider repair and errors. Browser checks cover the client workflow, previews, download, persistence, key exclusion and mobile layout using mocked AI responses, plus real API error paths. Live public-site discovery can be tested without a key. Live AI generation and visual-quality confirmation require a customer-supplied key; mocked responses are not real model output.

## Does this change the original EverOnn project?

This branch replaces the old application with an independent studio. Work was carried out in a separate checkout. The original working project, its uncommitted changes, integrations and databases are not migrated into this branch. Pushing this Git branch does not deploy or alter the original live app.
