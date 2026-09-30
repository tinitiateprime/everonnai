<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Living architecture documentation

`CODE_PROFILE.md`, `PROJECT_DATA_FLOW.md`, and `CLIENT_TECHNICAL_QA.md` are the project's maintained code, data-flow, and client Q&A guides.

Whenever a code change alters routes, API calls, module responsibilities, data shapes, persistence, provider integrations, environment variables, access control, or feature completeness, update the relevant guide in the same change. Describe implemented behavior, and keep production-connected behavior clearly separated from demo-only behavior.
