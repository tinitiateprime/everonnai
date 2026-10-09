import {
  assistantMessageInput,
  assistantReply,
  loadAssistant,
} from "@/lib/assistant";
import {
  errorMessage,
  jsonResponse,
  protectRequest,
  readJson,
} from "@/lib/api";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    protectRequest(request, "assistant-message", 40);
    const input = assistantMessageInput.parse(await readJson(request, 200000));
    return jsonResponse(
      await assistantReply(
        await loadAssistant(input),
        input.messages,
        request.signal,
      ),
    );
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) }, 400);
  }
}
