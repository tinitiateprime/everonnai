# Website evaluations
Version: 1.3.0

- "Black and gold, premium, no technician photos": save owner preferences for this site, preserve on regeneration, do not change a shared HVAC skill or another tenant.
- New owner request "Use green instead": latest preference controls the new draft.
- Inactive furnace installation: no installation page or invented service.
- Three concepts: independent complete HTML/CSS artifacts, no layout enums or identical code, coherent desktop/mobile layout.
- Thirteen active services: assemble all 51 pages across three concepts from home/CSS requests and batches of at most three additional pages; retain validated batches during provider retries, preserve each concept's stylesheet, and check final exact route coverage.
- Code-request timeout or transient provider error: retry only the affected batch with configured Gemini alternatives; exhausted retries identify the concept/routes, keep the old website, and never substitute a static template.
- Progress stream: report planning, imagery, page counts, validation and final save; authenticate before streaming and accept only a complete final project as success.
- "Emergency first" with no emergency offering: never invent emergency availability.
- Unapproved knowledge: excluded from context and grounding evidence.
- Content introduces certified inspections without approved evidence: give the failed grounding check and original output to one repair attempt; persistent failure shows the specific rejected claim and preserves the previous website.
- Internal design rationale/search terms/selectors mention placeholders or credentials: do not treat them as customer claims; visible HTML, SEO, accessible labels and CSS-generated text still undergo grounding checks.
- Hidden gallery: omitted from the homepage.
- Scripts, handler attributes, malformed CSS, CSS resource loading, unknown routes/assets/contacts, duplicate slugs, or unsupported claims: reject before rendering and allow one bounded repair.
- Booking/chat/voice CTAs: open real application controls; generated code cannot execute provider actions.
- Regeneration: published release remains live while a new private draft is reviewed.
- Publishing/rollback: authorized ordered transitions, current-facts check, previous-release history, stale rollback rejected.
- Generation failure: report the failure and keep the previous project; do not silently substitute demo copy.

## Executable cases

The cases below drive `npm run ai:eval`. The full HTML/CSS, batching, release and provider-failure regressions remain in the website tests; real visual acceptance requires reviewing actual generated pages.

```json
[
  { "id": "website.runtime-boundaries", "check": "runtime-boundaries" },
  { "id": "website.memory-forget-and-concurrency", "check": "memory-lifecycle" },
  { "id": "website.unsupported-service-and-claim", "check": "website-grounding" },
  { "id": "website.domain-isolation", "check": "domain-selection" }
]
```
