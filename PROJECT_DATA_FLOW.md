# WAAS data flow

~~~mermaid
flowchart LR
  Client[Client backend / server SDK] --> Key[Bearer API key]
  Studio[Website Studio] --> Session[HttpOnly operator session]
  Key --> API[Versioned WAAS API]
  Session --> API
  API --> Store[Client PostgreSQL / local development files]
  API --> Build[Saved Website Studio runner]
  Build --> Instructions[Versioned Markdown + verified business facts]
  Build --> Gemini[Gemini content / CSS / HTML]
  Build --> Photos[Optional Pexels]
  Build --> QA[Grounding and safe HTML/CSS checks]
  QA --> Draft[Private draft]
  Draft --> Review[Owner review and explicit approval]
  Review --> Live[Published snapshot + three prior releases]
  Live --> Page[Public HTML / iframe]
  Live --> Export[Portable HTML files]
~~~

1. An authenticated create call validates the business profile, services and contact path and allocates a random site ID. Nothing is generated or published automatically.
2. Editing requires the site's current revision. Preferences use the existing scope and revision checks. Server-owned drafts, checkpoints and releases cannot be posted as profile fields.
3. Start saves a checkpoint. Each advance request performs at most one paid AI call with a 20-second deadline, or one media/assembly stage. A persisted 60-second lease avoids duplicate simultaneous steps. Successful units survive reloads/restarts; accepted content is never replaced with a fixture. Lost active requests may need lease expiry before retry.
4. Gemini receives verified facts, selected domain instructions and saved preferences. Content, original design CSS and individual pages are saved separately. Transient errors have bounded model fallback/repair rounds and durable cooldowns. An SDK caller or open Studio drives the next request; there is no unattended background worker.
5. Durable usage events are written before paid calls. Final responses are recorded with token/cost estimates; a durable outbox preserves failed final writes. Authenticated usage reads replay that site's pending finalizations.
6. Final validation saves a new private draft only if the business facts, preferences and existing draft still match the generation fingerprint.
7. Publication requires approved: true, a current draft ID, a current live release ID, a verified owner profile, a selected concept and passing QA. A transaction saves the live project/profile snapshot and three prior releases.
8. Public rendering reads only the live snapshot; a private capability token reads only its draft. Navigation retains the correct site/preview prefix. Preview responses are no-store/noindex and same-origin frameable. Public framing can be restricted with WAAS_EMBED_ORIGINS.
9. Action anchors open the client's configured HTTPS booking/chat/voice service. Missing integrations become plainly labelled contact links. This package does not capture leads or execute booking/chat/voice providers.
10. Export requires a published site and returns every page as HTML/CSS with relative file navigation. Pexels URLs remain external. No secrets, checkpoint data or application API calls enter the exported pages.

Database records live in the separate waas.records table. Insert/update transactions serialize by record; a unique partial index protects public slugs. Database TLS is verified. Development files use an in-process queue, atomic rename and restrictive file creation permissions; they support one Node process only. No existing EverOnn database or customer workspace is copied or migrated.
