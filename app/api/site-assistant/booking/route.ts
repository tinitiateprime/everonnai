import { z } from "zod";
import { assistantIdentity, loadAssistant } from "@/lib/assistant";
import {
  errorMessage,
  jsonResponse,
  protectRequest,
  readJson,
} from "@/lib/api";
import { BOOKING_TOOLS, runBookingTool } from "@/lib/booking";

export const runtime = "nodejs";
const input = assistantIdentity.extend({
  tool: z.enum(BOOKING_TOOLS),
  args: z.record(z.string(), z.unknown()).default({}),
});
// Called by the generated website's voice/chat widget when the agent uses a client tool.
// Public (website visitors), so it is same-origin and rate limited; the business
// knowledge comes from the saved site, never from the browser.
export async function POST(request: Request) {
  try {
    protectRequest(request, "assistant-booking", 40);
    const data = input.parse(await readJson(request, 20000));
    const context = await loadAssistant(data);
    return jsonResponse(
      await runBookingTool(
        data.business,
        context.knowledge,
        data.tool,
        data.args,
      ),
    );
  } catch (error) {
    return jsonResponse(
      {
        saved: false,
        booked: false,
        available: null,
        message: `${errorMessage(error)} Nothing was booked or saved; offer the business's contact details.`,
      },
      400,
    );
  }
}
