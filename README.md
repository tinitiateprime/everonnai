# EverOnn Website Studio

A fresh, single-page website creation studio on the `website-as-a-service` branch. It does not import the original EverOnn dashboard, database, provider integrations or AI skill system.

## Run locally

Use Node 22 or newer.

```sh
npm ci
npm run browser:install
npm run dev
```

Open http://localhost:3000. Enter an OpenRouter key in **Connection**. The key stays in browser memory, is sent only to this app's API for generation, and is never saved in drafts or committed. Alternatively, copy `.env.example` to `.env.local` and configure `OPENROUTER_API_KEY`. A server-owned key requires `STUDIO_ACCESS_TOKEN` in production; enter that token in Connection. The token is also kept only in session memory.

## Your workflow

1. Add a description. Business name, business type, industry intelligence, website link, phone, email, location, service area, hours, service names/details and additional knowledge are all optional. Services can be added or removed.
2. A provided website link automatically starts discovery after typing pauses. Review extracted contacts and each page's evidence. Read again to refresh it. Failed discovery can be retried or explicitly skipped.
3. Generate three websites. AI first proposes three distinct directions, then independently writes original HTML/CSS for each one. No `SKILL.md`, preset website theme, template HTML, CSS framework or static generation fallback is used. The studio interface itself has ordinary application CSS.
4. Compare desktop/mobile previews, regenerate individual versions, and download complete HTML documents. Draft knowledge, website discovery, plans and completed designs survive refresh on the same device through IndexedDB.

Each generated website is a single, responsive document with in-page navigation. Public source pages supply evidence; they are not recreated as separate routes. Downloads use inline original CSS and native HTML interactions. Source images and optional Google Fonts remain externally hosted; the download is not an offline asset bundle. Contact links work when known. Forms, booking, payments, publishing and backend services are outside this app's scope.

## How website discovery works

The server resolves the public URL, checks `robots.txt`, reads up to six sitemap files (including sitemap indexes), and follows same-origin HTML links. It prioritizes contact, services, about, pricing and location pages over archives. Chromium renders JavaScript-driven content when installed, with network requests passed through the same public-address guard. It extracts page titles, descriptions, headings, body text, telephone/email links, JSON-LD, source image URLs, CSS colors, font names and browser-computed design cues. The homepage's first four stylesheets also supply design evidence. Every page retains its source URL for review.

Discovery is bounded to 40 successful pages, 120 attempted page URLs, 180 seconds and bounded resources. Authentication, robots restrictions, non-HTML files, subdomains/off-site pages, query/filter pages and unreachable pages can prevent full coverage. Coverage and skipped pages are shown; the app cannot guarantee access to every page of an arbitrary site. Raw text is limited to 12,000 characters per page, and AI context uses a 100,000-character prose budget spread across all captured pages, preserving contact and metadata separately. Chromium is optional: without it, HTML discovery works and explicitly warns about missing JavaScript content.

Entered facts override conflicting website evidence. The generator is told to omit unknown facts, preserve offered services, use supplied image URLs, and avoid invented contacts/testimonials/claims. Validation enforces owner-entered contacts, supported contact links, service names, useful anchors, valid responsive CSS, complete HTML and no executable content. A browser check at 390px and 1440px rejects horizontal overflow and hidden main headings when Chromium is available. These checks cannot guarantee aesthetic excellence or verify every factual sentence; the user should review all three designs.

## OpenRouter

The app retrieves the [live model catalogue](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties), filters suitable zero-input/zero-output-price text models, and ranks them using coding signals, context size and structured-output support. It excludes safety-only and embedding models. Automatic selection starts each version with a different available model when possible; you can override with any listed free model. `OPENROUTER_MODELS` can prioritize comma-separated IDs that still qualify in the live catalogue. No paid fallback occurs: provider routing also caps input/output price at zero. The heuristic ranking is not a quality benchmark.

Generation uses [OpenRouter chat completions](https://openrouter.ai/docs/api/reference/overview). Plans use JSON Schema output when the chosen model supports it and are always checked locally. Failed HTML validation gets one repair attempt per model, with at most three free model candidates and a 210-second operation budget. Rate limits, missing keys, malformed output and partial failures are explicit. Accepted designs are preserved; retry generates only the requested or missing version. [Free-model rate limits](https://openrouter.ai/docs/api/reference/limits) depend on the account and provider.

## Checks

```sh
npm run check
npm run test:browser
```

Browser checks start the production build on port 3047, or use `STUDIO_TEST_URL`. They mock AI/discovery responses to verify the client workflow and also exercise real credential/private-address error paths. Unit tests mock provider requests to verify free-model enforcement and output repair. A real generation and visual-quality review requires a user-supplied API key; passing mocked checks is not proof of live model output quality.

## Hosting

Deploy as a Node.js Next.js app, not a static export. Use `npm run build` and `npm start`. Discovery and generation routes allow up to 240 seconds; the hosting platform must permit that duration and streamed discovery responses. Provision Chromium with `npm run browser:install` or configure `CHROMIUM_EXECUTABLE_PATH`. There is no database or account system. Drafts belong to this browser/device. Rate limiting is an in-process guard, not a distributed quota service. Never expose a server key publicly without a configured studio token. This repository push does not deploy a live website.

Architecture: [CODE_PROFILE.md](CODE_PROFILE.md), [PROJECT_DATA_FLOW.md](PROJECT_DATA_FLOW.md), [CLIENT_TECHNICAL_QA.md](CLIENT_TECHNICAL_QA.md).
