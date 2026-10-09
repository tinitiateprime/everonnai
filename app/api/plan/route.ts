import {
  apiKey,
  errorMessage,
  jsonResponse,
  protectRequest,
  readJson,
} from "@/lib/api";
import { planInput } from "@/lib/input";
import { makePlan } from "@/lib/generator";
import { generationDiscovery, snapshotDiscovery } from "@/lib/discovery-store";
export const runtime = "nodejs";
export const maxDuration = 240;
export async function POST(request: Request) {
  try {
    protectRequest(request, "plan");
    const key = apiKey(request);
    const data = planInput.parse(await readJson(request));
    const discovery = await generationDiscovery(data);
    const sourceSnapshotId = discovery
      ? await snapshotDiscovery(discovery)
      : undefined;
    return jsonResponse({
      ...(await makePlan(key, data.knowledge, discovery, request.signal)),
      sourceSnapshotId,
    });
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) }, 400);
  }
}
