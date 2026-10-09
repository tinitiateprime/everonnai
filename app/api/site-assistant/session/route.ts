import {
  assistantSessionInput,
  createAssistantSession,
  loadAssistant,
} from "@/lib/assistant";
import {
  errorMessage,
  jsonResponse,
  protectRequest,
  readJson,
} from "@/lib/api";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    protectRequest(request, "assistant-session", 8);
    const input = assistantSessionInput.parse(await readJson(request, 4096));
    const context = await loadAssistant(input);
    try {
      return jsonResponse(
        await createAssistantSession(context, input.mode, request.signal),
      );
    } catch (error) {
      return jsonResponse(
        {
          error: errorMessage(error),
          fallbackReady:
            input.mode === "chat" &&
            Boolean(process.env.GEMINI_API_KEY?.trim()),
          greeting: context.greeting,
        },
        503,
      );
    }
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) }, 400);
  }
}
