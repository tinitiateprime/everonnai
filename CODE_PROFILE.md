# Website Studio code profile

This branch is a fresh Next.js 16.3.8 / React 19 application. The sole page is `/`; Business knowledge and Your designs are views of the same page. It has no dependency on the original app's accounts, database, restaurants, voice agents, booking or skill registry.

| Module                       | Implemented responsibility                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/studio.tsx`      | Optional business inputs and service rows, required description, automatic discovery, source review, generation settings, sequential three-design workflow, retry, cancellation, preview, HTML export |
| `lib/types.ts`               | Knowledge, page evidence, discovery coverage, AI directions, model and artifact types; knowledge/direction validation                                                                                 |
| `lib/browser-store.ts`       | Same-device IndexedDB draft persistence; no credential storage                                                                                                                                        |
| `lib/network.ts`             | Public HTTP(S) validation, DNS address validation/pinning, redirect revalidation, bounded decompression/resources and request timeout                                                                 |
| `lib/crawler.ts`             | Robots/sitemap/internal-link crawl, source coverage and skipped pages, optional Chromium rendering with guarded resource fetching                                                                     |
| `lib/extract.ts`             | Business content/contact evidence, resolved source images, JSON-LD and design metadata extraction                                                                                                     |
| `lib/input.ts`, `lib/api.ts` | Bounded request bodies, input validation, same-origin checks, per-process rate guard, environment-only provider key, optional shared studio token                                                     |
| `lib/openrouter.ts`          | Live free-model catalogue, heuristic coding ranking, zero-price provider cap, completion requests and provider error handling                                                                         |
| `lib/prompts.ts`             | Inline AI instructions and evidence packets; no Markdown file loader, skill registry, fixed layouts or generated-site CSS                                                                             |
| `lib/generator.ts`           | Three-direction plan, independent original site generation, bounded free-provider fallback and repair, original model/usage metadata                                                                  |
| `lib/validation.ts`          | Complete document, responsive CSS, owner contacts, supported contact links, service names, anchor targets, executable-content rejection, duplicate detection and CSP injection                        |
| `lib/visual-check.ts`        | Optional Chromium viewport checks at 390/1440px; rejects overflow/hidden heading and reports failed images                                                                                            |

## Routes and data

| Route                | Input / output                                                                                               | External behavior                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `GET /api/models`    | Current free model summaries and safe configuration booleans                                                 | OpenRouter model catalogue; five-minute process cache                       |
| `POST /api/discover` | `{url}` → newline-delimited progress/result/error events                                                     | Public source website, robots, sitemaps, source resources; no AI key needed |
| `POST /api/plan`     | Knowledge plus nullable discovery → three direction objects and successful model                             | OpenRouter chat completions                                                 |
| `POST /api/generate` | Knowledge/discovery, one direction, index, accepted artifacts and optional model ID → one validated artifact | OpenRouter, optional guarded browser asset requests                         |

Artifacts contain an ID/index, AI-selected name/rationale, complete HTML with original CSS, successful model, created time, warnings and optional token usage. Sources contain body evidence, contacts, assets, metadata, design cues and coverage. Knowledge enters AI as untrusted evidence; entered facts take precedence.

## Persistence and access

The browser uses IndexedDB `everonn-website-studio`, object store `drafts`, key `current`. It stores knowledge, discovery, plan, accepted artifacts and generation fingerprint. There is no server persistence or cross-device sync. The OpenRouter key is read exclusively from server-side `OPENROUTER_API_KEY`. There is no provider-key React state, input or outgoing browser header; the server ignores browser-supplied provider keys. Studio access tokens alone are held in React state/request headers and never persisted. API responses are private/no-store. Mutations require a matching Origin. The rate guard is local to one server process. There are no user accounts or tenant permissions. Production generation requires a configured studio token; local development requires one only when explicitly configured.

Environment variables: `OPENROUTER_API_KEY`, `OPENROUTER_MODELS`, `STUDIO_ACCESS_TOKEN`, `CHROMIUM_EXECUTABLE_PATH`. All are optional for opening the interface. A valid server provider key is necessary for real generation. `.env.local` is ignored; changes require a server restart. `OPENROUTER_MODELS` prioritizes available qualifying free IDs; blank uses Inkling, Laguna S 2.1 and Nemotron 3 Ultra, then eligible free alternatives. Catalogue checks reject missing or paid preferred models. Reasoning uses medium effort when advertised, otherwise another supported effort. Chromium installation is necessary for browser extraction/layout review; absence is reported and HTML discovery remains usable.

## Completeness and verification

Runtime calls real public websites and OpenRouter; it has no demo/mock generation mode or fallback artifact. Test fixtures and provider mocks live only under tests/scripts. UI/API checks exercise fixtures and error paths; they do not establish live model quality. Generated output is a static single-document website, with functional in-page navigation and supported contact links. There are no fake lead forms. Hosting, booking, payment, CMS and account backends are not implemented. Discovery limits and provider restrictions are described in README; aesthetic excellence is not automatically guaranteed by structural checks.
