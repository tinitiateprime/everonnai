import {
  apiKey,
  errorMessage,
  jsonResponse,
  protectRequest,
  readJson,
} from "@/lib/api";
import { generationInput } from "@/lib/input";
import { makeWebsite } from "@/lib/generator";
export const runtime = "nodejs";
export const maxDuration = 240;
export async function POST(request: Request) {
  try {
    protectRequest(request, "generate", 18);
    const key = apiKey(request);
    const data = generationInput.parse(await readJson(request, 5_000_000));
    return jsonResponse({
      artifact: await makeWebsite(
        key,
        data.knowledge,
        data.discovery,
        data.direction,
        data.index,
        data.previous,
        request.signal,
        data.model,
      ),
    });
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) }, 400);
  }
}
