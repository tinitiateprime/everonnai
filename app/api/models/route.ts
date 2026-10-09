import { getModels } from "@/lib/openrouter";
import { errorMessage, jsonResponse, websiteKeyName } from "@/lib/api";
export const runtime = "nodejs";
export async function GET() {
  try {
    return jsonResponse({
      models: (await getModels()).map((m) => ({
        id: m.id,
        name: m.name,
        context: m.context_length,
      })),
      serverKeyConfigured: Boolean(process.env[websiteKeyName()]?.trim()),
      accessTokenRequired:
        Boolean(process.env.STUDIO_ACCESS_TOKEN) ||
        process.env.NODE_ENV === "production",
    });
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) }, 503);
  }
}
