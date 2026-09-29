# AgenticThat → EverOnn integration

Source reviewed: <https://github.com/tinitiateprime/agentic-that>

This is a selective product migration, not a repository merge. Social publishing, social scraping, LinkedIn/YouTube automation, and the Publishing Companion remain outside EverOnn.

## Migrated foundations

| AgenticThat capability | EverOnn implementation |
| --- | --- |
| Website Studio structured generation | Gemini-required generation with strict schema validation and grounded QA in `features/website-studio/` |
| Multi-page generated sites | Home, services index, one detail page per service, about, and contact routes |
| Service grounding and unsupported-claim QA | `runWebsiteQa` plus automated tests |
| Three concepts | Editorial, Momentum, and Aura in the dashboard and private preview |
| Private preview | Token-scoped `/preview/[token]`, noindex metadata, and capability workflow |
| Owner claim/verify/approve/publish | Explicit state machine in Website Studio |
| Website media selection | Pexels relevance scoring, composition checks, deduplication, hero/story/service images, and a six-image gallery |
| Website assistant | ElevenLabs live chat/voice with Gemini text continuity; no scripted customer-response fallback |
| Published customer site | Dynamic `/sites/[slug]` routes with responsive navigation, metadata, and assistant access controls |
| Phone receptionist prompt/safety | `features/voice-agent/engine.ts` |
| Lead and urgency capture | AI agent demo, shared inbox, and typed/voice summary flow |
| Human handoff | Urgency and explicit-person-request paths create handoff outcomes |
| Appointment safety | Requests remain unconfirmed until a provider confirms them |
| Google Calendar/Gmail | OAuth connect/callback/disconnect flow, encrypted refresh-token store, and server adapters |
| ElevenLabs | Private conversation-token endpoint and live WebRTC microphone experience |
| Contacts and inbox | Dashboard contacts, calls, unified opportunity inbox |
| Workspace isolation and RBAC | Tenant repository guards, role grants, JSON validation, and tests |
| Login, reset, and MFA experience | `/login` interaction and workspace-scoped product UX |

## Central business profile

EverOnn uses one controlled profile for:

- identity, services, hours, and service area;
- approved FAQs and policies;
- pricing and availability constraints;
- voice greeting, tone, emergency rules, and handoff number;
- website generation, website chat, phone response, booking, and follow-up.

The product stores this profile once in `data/everonn.json`, together with approved knowledge, conversations, leads, appointments, Website Studio state, integrations, and team roles. The `/api/workspace` boundary validates workspace ownership and performs serialized atomic writes. Website publishing uses a server-confirmed state transition so an older browser save cannot roll a published project backward.

## Production boundaries

- No database or Supabase setup is required for the current product.
- Provider tokens belong only in environment variables or encrypted server-side storage; they are never written to the workspace JSON.
- Private preview links are capability URLs. Rotate them when regenerating a site and do not expose them outside the intended owner workflow.
- Published pages do not load the private workspace payload. Chat/voice sessions and callback capture pass through scoped server endpoints that accept only a valid preview token or the active published slug.
- A configured Google OAuth app is required for live calendar and Gmail operations. Tokens are encrypted separately from workspace JSON.
- Gemini is required for website generation and typed AI conversations. Generation fails visibly if every configured model fails; it never silently publishes template copy.
- A configured ElevenLabs agent is required for live text/voice provider sessions. If ElevenLabs text cannot connect, website chat continues through Gemini rather than scripted responses.
- The local login flow demonstrates password, reset, and MFA UX. Add a production identity provider before exposing private workspaces publicly.
- JSON persistence is intended for a single writable application instance. Multi-instance deployment requires coordinated shared storage or a future database adapter.
