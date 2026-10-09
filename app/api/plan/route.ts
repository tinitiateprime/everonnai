import {
  apiKey,
  errorMessage,
  jsonResponse,
  protectRequest,
  readJson,
} from "@/lib/api";
import { planInput } from "@/lib/input";
import { makePlan } from "@/lib/generator";
export const runtime = "nodejs";
export const maxDuration = 240;
export async function POST(request: Request) {
  try {
    protectRequest(request, "plan");
    const key = apiKey(request);
    const { knowledge, discovery } = planInput.parse(await readJson(request));
    return jsonResponse(
      await makePlan(key, knowledge, discovery, request.signal),
    );
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) }, 400);
  }
}
