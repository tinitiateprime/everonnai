# WAAS API

Base path: /api/waas/v1. All management calls require Authorization: Bearer YOUR_WAAS_API_KEY. JSON responses are private/no-store; errors return an error string and HTTP status. Invalid inputs return 400, auth 401/403, missing sites 404, stale writes 409 and oversized bodies 413. API credentials are installation-wide: use your own authenticated backend to enforce client/site permissions.

| Method and path | Body / behavior |
| --- | --- |
| GET /sites | List site summaries |
| POST /sites | profile (required), preferences and actions (optional); returns 201 |
| GET /sites/:id | Profile, preferences, draft summary, preview/public URLs and release IDs |
| PATCH /sites/:id | expectedRevision plus changed profile/preferences/actions; returns updated summary |
| POST /sites/:id/build | operation: start, or operation: advance/resume with jobId |
| GET /sites/:id/build | Saved build status; optional jobId query rejects replaced jobs |
| POST /sites/:id/publish | approved: true, concept, draftId, expectedLiveReleaseId |
| POST /sites/:id/rollback | releaseId and expectedLiveReleaseId |
| GET /sites/:id/export | Published site's pages: path + html |
| GET /sites/:id/usage | This site's Gemini usage events; replays pending final writes |

## Create input

~~~json
{
  "profile": {
    "businessName": "Your business",
    "businessType": "Carpentry",
    "description": "We repair and install doors and cabinets for residential customers in Hyderabad.",
    "email": "hello@example.com",
    "timeZone": "Asia/Kolkata",
    "verified": true,
    "services": [
      { "id": "doors", "name": "Door repair", "description": "Residential door repair." }
    ]
  },
  "preferences": { "brief": "Clear service navigation and generous spacing." },
  "actions": { "booking": "https://your-site.example/contact" }
}
~~~

Replace example facts/contact details with owner-verified facts. A description needs at least 40 characters, an email or phone, and 1–16 services. Optional profile fields: location, serviceArea, hours, website, skillId (general/hvac), knowledge. Knowledge entries contain question/answer and approved: true to become approved reference facts. Service IDs are generated when omitted; retain returned IDs in later edits.

Actions booking/chat/voice accept full HTTPS URLs without embedded credentials; blank/null clears one. PATCH actions replaces the entire action object. Missing action services become contact links. Changes to action URLs affect live pages immediately; content/design changes require regeneration and publication.

Preferences accept brief, accepted/rejected choices, six-digit primaryColor/accentColor, typography, density, imagery, priorityServiceId and hiddenSections. PATCH preferences replaces the full preference snapshot; preserve existing values when editing individual fields. expectedPreferencesRevision can enforce a separate preferences revision. Profile PATCH merges allowed fields; services/knowledge arrays replace their corresponding arrays.

## Build and publish

Start returns a saved job with its ID. While status is running, call advance with that jobId, honoring retryAfterMs. Responses are 202 while running and 200 when failed/completed. Each advance can make one paid AI call; HTTP success alone does not imply generation success. Check job.status and job.error. Failed builds retain accepted units; resume resets retry state. If inputs changed, start a fresh build. SDK generate handles this loop; resume: true continues an existing build without starting over.

Completed generation returns a project; GET /sites/:id then supplies draft.id and previewUrl. Review each design through previewUrl?theme=editorial, momentum or aura. PublicUrl remains null until publication.

Publishing requires the latest draft ID and expectedLiveReleaseId (null for a site's first publication), approved: true, and the selected concept. It checks verified facts, unchanged generation facts and QA. The selected live design/profile is snapshotted; the prior three releases remain available. Rollback requires a retained release ID and current live release ID.

Export returns { siteId, releaseId, pages: [{ path, html }] }. Paths are index.html or services/example/index.html, etc. Write them under one folder with their hierarchy intact. The supplied examples/export.mjs performs this safely.

The browser Studio uses /api/studio/session with eight-hour signed HttpOnly cookies. Cookie mutations require the exact WAAS_PUBLIC_URL origin. SDK calls use bearer auth instead and need no CORS configuration. Never put an API key in an iframe, URL or frontend bundle.
