# Client technical Q&A

| Question | Answer |
| --- | --- |
| What do we receive? | A standalone Website Studio service, API, installable server SDK, examples, Dockerfile, tests and SQL setup code. |
| How do we add it to our existing site? | Publish, then add an iframe/link; or export the HTML files to your own hosting. For custom workflows use the SDK from your backend. |
| What do we supply? | A Gemini key, private access key, production service origin and your own PostgreSQL connection. Pexels is optional. Setup generates the access key. |
| Is a database included? | No hosted database, database container, customer records or credentials. The package includes an additive private schema migration for your database. |
| Can we try without PostgreSQL? | Yes. Development uses ignored local files. One production server can explicitly opt into persistent local files; multi-instance/serverless needs PostgreSQL. |
| Are designs templates? | No. Gemini generates original content, CSS and HTML for three designs; QA failure remains a failure. |
| Can we revise a website? | Edit facts/design preferences, generate a new draft, review and publish. Existing live content stays visible during review. |
| Can we resume a failed build? | Yes. Accepted units persist, and Studio/SDK can resume. Changed generation inputs require a fresh build. |
| Does it include bookings/chat/voice? | It links those actions to your existing HTTPS services. Missing integrations become contact links. No Google/ElevenLabs execution backend is included. |
| Who can access management? | The operator access key or signed Studio session. The key grants installation-wide access; your backend must enforce your own customer permissions. |
| Are previews private? | They use an unguessable bearer capability URL, are excluded from indexing and should be shared only with reviewers. |
| Can we roll back? | Yes, the previous three published releases are retained. Live-release checks prevent stale overwrites. Action URLs are current configuration, not release snapshots. |
| Can we host generated HTML elsewhere? | Yes, the exported folder is plain HTML/CSS with relative links. Stock images still use Pexels; client action URLs still point to your services. |
| Does generation cost money? | It uses your provider quota/billing. Token cost displays are estimates, not invoices. |
| What remains our responsibility? | Provider model access/quota, deployment/domain/TLS, database/backups, customer authorization and owner approval of business facts/design. |

Deterministic tests and isolated browser smoke checks use fixtures only. Production generation always requires a working provider. Client credentials, live hosting and an external production database require checks in the client's own environment.
