import {
  assistantSessionInput,
  createAssistantSession,
  loadAssistant,
} from "@/lib/assistant";
import { bookingStatus } from "@/lib/booking";
import {
  errorMessage,
  jsonResponse,
  protectRequest,
  readJson,
} from "@/lib/api";
export const runtime = "nodejs";
async function liveBooking(business: string) {
  const status = await bookingStatus(business).catch(() => null);
  return {
    calendarReady: Boolean(status?.calendarReady),
    timeZone: status?.settings.timeZone ?? "",
    durationMinutes: status?.settings.durationMinutes ?? 0,
  };
}
export async function POST(request: Request) {
  try {
    protectRequest(request, "assistant-session", 8);
    const input = assistantSessionInput.parse(await readJson(request, 4096));
    const context = await loadAssistant(input);
    try {
      return jsonResponse(
        await createAssistantSession(
          context,
          input.mode,
          request.signal,
          await liveBooking(input.business),
        ),
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
