import { z } from "zod";
import { discoverWebsite } from "@/lib/crawler";
import {
  errorMessage,
  jsonResponse,
  protectRequest,
  readJson,
} from "@/lib/api";
export const runtime = "nodejs";
export const maxDuration = 240;
export async function POST(request: Request) {
  try {
    protectRequest(request, "discover", 6);
    const { url } = z
      .object({ url: z.string().trim().min(1).max(2048) })
      .parse(await readJson(request, 4096));
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: unknown) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
          } catch {
            /* client disconnected */
          }
        };
        try {
          const discovery = await discoverWebsite(
            url,
            (message) => send({ type: "progress", message }),
            request.signal,
          );
          send({ type: "result", discovery });
        } catch (error) {
          send({ type: "error", message: errorMessage(error) });
        } finally {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "private, no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) }, 400);
  }
}
