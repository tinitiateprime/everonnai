# AgenticThat → EverOnn integration

EverOnn adopted selected service-business foundations from [AgenticThat](https://github.com/tinitiateprime/agentic-that). Social publishing, scraping, LinkedIn/YouTube automation, and the Publishing Companion remain outside this project.

The maintained implementation references are [CODE_PROFILE.md](../CODE_PROFILE.md), [PROJECT_DATA_FLOW.md](../PROJECT_DATA_FLOW.md), and [CLIENT_TECHNICAL_QA.md](../CLIENT_TECHNICAL_QA.md). They describe current behavior and production boundaries; this file records migration provenance.

| Foundation | Current EverOnn module |
| --- | --- |
| Website Studio and grounded generation | `features/website-studio/`, original Gemini HTML/CSS, draft/live releases |
| Industry and capability instructions | `ai/` and `features/agent-runtime/` |
| Customer assistant and intake | `features/voice-agent/`, scoped chat/voice session APIs |
| Calendar and Gmail | `features/integrations/`, encrypted per-workspace credentials |
| Business knowledge, inbox, contacts, team | Dashboard and scoped workspace APIs |
| Authentication and workspace isolation | `features/auth/`, private account/workspace stores |

The current application implements authentication and configured private PostgreSQL persistence. Earlier descriptions of demo-only login/MFA, fixed website previews, and database-free production do not describe the current product. MFA, forgotten-password recovery, and subscription billing remain incomplete; integration availability depends on credentials and deployment verification.
