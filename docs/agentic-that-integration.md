# AgenticThat → EverOnn integration

Source reviewed: <https://github.com/tinitiateprime/agentic-that>

This is a selective product migration, not a repository merge. Social publishing, social scraping, LinkedIn/YouTube automation, and the Publishing Companion remain outside EverOnn.

## Migrated foundations

| AgenticThat capability | EverOnn implementation |
| --- | --- |
| Website Studio structured generation | `features/website-studio/generator.ts` |
| Service grounding and unsupported-claim QA | `runWebsiteQa` plus automated tests |
| Three concepts | Editorial, Momentum, and Aura in the dashboard and private preview |
| Private preview | Token-scoped `/preview/[token]`, noindex metadata, and capability workflow |
| Owner claim/verify/approve/publish | Explicit state machine in Website Studio |
| Website media selection | Optional Pexels resolver with deduplication and verification helpers |
| Website assistant | Preview assistant powered by the central approved business profile |
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

The product stores this profile once in `data/everonn.json`, together with approved knowledge, conversations, leads, appointments, Website Studio state, integrations, and team roles. The `/api/workspace` boundary validates workspace ownership and performs serialized atomic writes.

## Production boundaries

- No database or Supabase setup is required for the current product.
- Provider tokens belong only in environment variables or encrypted server-side storage; they are never written to the workspace JSON.
- Website preview capability tokens must be stored as SHA-256 digests; plaintext tokens are delivered only to the intended owner.
- A configured Google OAuth app is required for live calendar and Gmail operations. Tokens are encrypted separately from workspace JSON.
- A configured ElevenLabs agent is required for live provider sessions; typed browser speech remains the zero-secret demo fallback.
- The local login flow demonstrates password, reset, and MFA UX. Add a production identity provider before exposing private workspaces publicly.
- JSON persistence is intended for a single writable application instance. Multi-instance deployment requires coordinated shared storage or a future database adapter.
