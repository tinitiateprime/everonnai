import {
  apiKey,
  errorMessage,
  jsonResponse,
  protectRequest,
  readJson,
} from "@/lib/api";
import { generationInput } from "@/lib/input";
import { makeWebsite } from "@/lib/generator";
import { saveGeneratedSite } from "@/lib/site-store";
import { resolvePhotos } from "@/lib/pexels";
import { generationDiscovery } from "@/lib/discovery-store";
export const runtime = "nodejs";
export const maxDuration = 240;
export async function POST(request: Request) {
  try {
    protectRequest(request, "generate", 18);
    const key = apiKey(request);
    const data = generationInput.parse(await readJson(request, 5_000_000));
    const discovery = await generationDiscovery(data);
    const artifact = await makeWebsite(
      key,
      data.knowledge,
      discovery,
      data.direction,
      data.index,
      data.previous,
      request.signal,
      data.model,
      await resolvePhotos(data.photoIds, request.signal),
    );
    return jsonResponse({
      artifact: await saveGeneratedSite(data.knowledge, artifact, discovery),
    });
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) }, 400);
  }
}
