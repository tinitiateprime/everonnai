// Run from the service checkout: node --env-file=.env.local examples/client.mjs
// Or install @everonn/waas-client in your app and change the import.
import { createWaasClient } from "../sdk/index.mjs";
const waas = createWaasClient({ baseUrl: process.env.WAAS_PUBLIC_URL || "http://localhost:3000", apiKey: process.env.WAAS_API_KEY });
const site = await waas.createSite({
  profile: {
    businessName: "Your business", businessType: "Carpentry",
    description: "We repair and install doors and cabinets for residential customers in Hyderabad.",
    email: "hello@example.com", location: "Hyderabad", timeZone: "Asia/Kolkata",
    services: [{ name: "Door repair", description: "Repair and adjustment of residential doors." }],
    verified: true, // use true only after the owner verifies the facts
  },
  actions: { booking: "https://example.com/contact" },
});
console.log("Saved site ID:", site.id);
await waas.generate(site.id, { onProgress: job => console.log(job.progress.message) });
const draft = await waas.getSite(site.id);
console.log("Review:", waas.url(draft.previewUrl));
// After the owner reviews it:
// const live = await waas.publish(site.id, {
//   concept: "editorial", approved: true, draftId: draft.draft.id,
//   expectedLiveReleaseId: draft.liveReleaseId,
// });
// console.log(waas.url(live.publicUrl));
