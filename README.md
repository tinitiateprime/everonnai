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

1. Add a description. Business name, business type, industry intelligence, website link, phone, email, location, service area, hours, service names/details and additional knowledge are all optional. Services can be added or removed.
2. A provided website link automatically starts discovery after typing pauses. Review extracted contacts and each page's evidence. Read again to refresh it. Failed discovery can be retried or explicitly skipped.
3. Generate three websites. AI first proposes three distinct directions, then independently writes original HTML/CSS for each one. No `SKILL.md`, preset website theme, template HTML, CSS framework or static generation fallback is used. The studio interface itself has ordinary application CSS.
4. Compare desktop/mobile previews, regenerate individual versions, and download complete HTML documents. Each accepted design also gets a standalone URL: `/service/{business-slug}/1`, `/2`, or `/3`. Use **Open website** beside Download HTML. Draft knowledge, website discovery, plans and completed designs survive refresh on the same device through IndexedDB.

## Generated website URLs

A business named `Northline Heating` gets these addresses when the studio runs on port 3000:

```text
http://localhost:3000/service/northline-heating/1
http://localhost:3000/service/northline-heating/2
http://localhost:3000/service/northline-heating/3
```

Links use the running app's host and port. Names become lowercase URL slugs with spaces/punctuation converted to hyphens. Non-Latin names are supported as encoded path segments. Business name remains optional: a missing name uses `business-{description-hash}`. Same slug/version points to its latest successfully generated design; regeneration replaces that version only. Distinct businesses need distinct slugs. Older browser-only designs receive URLs when regenerated.

Accepted HTML artifacts are saved atomically on the Node server under ignored `data/generated-sites/{slug}/{version}.json`, or `GENERATED_SITES_DIR`. The GET route serves the exact generated HTML/CSS as a standalone page without the studio interface. Links survive refresh and server restarts and work in another browser that can reach this server. They do not need the original browser's IndexedDB. Unknown businesses and missing/invalid versions return 404. These are publicly readable generated-site links on this app; generation remains protected. A restrictive CSP keeps scripts disabled and gives generated documents an opaque origin, preventing access to studio browser storage.

Each generated website is a single, responsive document with in-page navigation. Public source pages supply evidence; they are not recreated as separate routes. Downloads use inline original CSS and native HTML interactions. Source images and optional Google Fonts remain externally hosted; the download is not an offline asset bundle. Contact links work when known. Forms, booking, payments and deployment to another hosting provider remain outside this app's scope.

## How website discovery works

The server resolves the public URL, checks `robots.txt`, reads up to six sitemap files (including sitemap indexes), and follows same-origin HTML links. It prioritizes contact, services, about, pricing and location pages over archives. Chromium renders JavaScript-driven content when installed, with network requests passed through the same public-address guard. It extracts page titles, descriptions, headings, body text, telephone/email links, JSON-LD, source image URLs, CSS colors, font names and browser-computed design cues. The homepage's first four stylesheets also supply design evidence. Every page retains its source URL for review.

Discovery is bounded to 40 successful pages, 120 attempted page URLs, 180 seconds and bounded resources. Authentication, robots restrictions, non-HTML files, subdomains/off-site pages, query/filter pages and unreachable pages can prevent full coverage. Coverage and skipped pages are shown; the app cannot guarantee access to every page of an arbitrary site. Raw text is limited to 12,000 characters per page, and AI context uses a 100,000-character prose budget spread across all captured pages, preserving contact and metadata separately. Chromium is optional: without it, HTML discovery works and explicitly warns about missing JavaScript content.

Entered facts override conflicting website evidence. The generator is told to omit unknown facts, preserve offered services, use supplied image URLs, and avoid invented contacts/testimonials/claims. Validation enforces owner-entered contacts, supported contact links, service names, useful anchors, valid responsive CSS, complete HTML and no executable content. A browser check at 390px and 1440px rejects horizontal overflow and hidden main headings when Chromium is available. These checks cannot guarantee aesthetic excellence or verify every factual sentence; the user should review all three designs.

## OpenRouter

The preferred starting models are [Thinking Machines Inkling](https://openrouter.ai/thinkingmachines/inkling:free), [Poolside Laguna S 2.1](https://openrouter.ai/poolside/laguna-s-2.1:free), and [NVIDIA Nemotron 3 Ultra](https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b:free). Their free endpoints were verified on 2026-10-09. These are practical choices based on published coding/design capabilities; they are not a guarantee of the best website quality. Laguna's current free listing expires on 2026-10-31, so ongoing catalogue validation and fallback are necessary.

`OPENROUTER_MODELS` sets the preferred order as comma-separated IDs. An empty value uses the same three built-in preferences. The app retrieves the [live model catalogue](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), filters zero-input/zero-output-price models with suitable context/output limits, and prefers only available qualifying IDs. It excludes safety-only and embedding models. Other eligible models are ranked using coding signals, context size and structured-output support and remain available as free fallbacks. If a preferred model disappears or becomes paid, it is skipped. Each version starts with a different available model when possible, and **Generation settings** allows a listed free model override. No paid fallback occurs: provider routing also caps input/output price at zero. The heuristic ranking is not a quality benchmark.

Generation uses [OpenRouter chat completions](https://openrouter.ai/docs/api/reference/overview). Plans use JSON Schema output when the chosen model supports it and are always checked locally. Reasoning-capable models use medium effort where supported; another catalogue-supported effort is used when medium is unavailable. Failed HTML validation gets one repair attempt per model, with at most three free model candidates and a 210-second operation budget. Rate limits, missing server keys, malformed output and partial failures are explicit. Accepted designs are preserved; retry generates only the requested or missing version. [Free-model rate limits](https://openrouter.ai/docs/api/reference/limits) depend on the account and provider.

## Checks

```sh
npm run check
npm run test:browser
```

Browser checks start the production build on port 3047, or use `STUDIO_TEST_URL`. They mock AI/discovery responses to verify the client workflow and also exercise real credential/private-address error paths. They verify the absence of a browser API-key field/header. The self-started test server uses an isolated temporary site directory and verifies all three real generated-site routes, refresh, access from another browser context, document isolation and 404 behavior. Unit tests verify atomic site storage, safe slugs, version replacement, corrupted-file handling, API-to-storage integration, environment-only keys, access control, free-model selection and output repair. A real generation and visual-quality review requires a valid key configured in the server environment; passing mocked checks is not proof of live model output quality.

## Hosting

Deploy as a Node.js Next.js app, not a static export. Use `npm run build` and `npm start`. Discovery and generation routes allow up to 240 seconds; the hosting platform must permit that duration and streamed discovery responses. Provision Chromium with `npm run browser:install` or configure `CHROMIUM_EXECUTABLE_PATH`. Generated-site URLs require a writable persistent volume for `GENERATED_SITES_DIR`; read-only or ephemeral serverless filesystems do not provide durable links. Multi-instance hosts must share this directory. There is no database or account system. Knowledge drafts belong to this browser/device, while linked generated HTML is stored on the server. Rate limiting is an in-process guard, not a distributed quota service. Never expose a server key publicly without a configured studio token. This repository push does not deploy a live website.

Architecture: [CODE_PROFILE.md](CODE_PROFILE.md), [PROJECT_DATA_FLOW.md](PROJECT_DATA_FLOW.md), [CLIENT_TECHNICAL_QA.md](CLIENT_TECHNICAL_QA.md).
