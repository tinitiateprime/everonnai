import { z } from "zod";
import {
  errorMessage,
  jsonResponse,
  protectRequest,
  readJson,
  requireStudioAccess,
} from "@/lib/api";
import { bookingStatus } from "@/lib/booking";
import {
  disconnectGoogle,
  googleAuthorizationUrl,
  googleOAuthConfigured,
  googleRedirectUri,
} from "@/lib/google-oauth";
import {
  bookingSettingsSchema,
  withIntegration,
} from "@/lib/integrations-store";
import { readGeneratedSite } from "@/lib/site-store";

export const runtime = "nodejs";
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("status"),
    business: z.string().min(1).max(100),
  }),
  z.object({
    action: z.literal("connect"),
    business: z.string().min(1).max(100),
  }),
  z.object({
    action: z.literal("disconnect"),
    business: z.string().min(1).max(100),
  }),
  z.object({
    action: z.literal("save"),
    business: z.string().min(1).max(100),
    settings: bookingSettingsSchema,
  }),
]);
// Studio-only booking setup for one generated business: status, settings, Google connect.
export async function POST(request: Request) {
  try {
    protectRequest(request, "integrations", 60);
    requireStudioAccess(request);
    const data = input.parse(await readJson(request, 8000));
    const generated = await Promise.all(
      ["1", "2", "3"].map((v) =>
        readGeneratedSite(data.business, v).catch(() => null),
      ),
    );
    if (!generated.some(Boolean))
      return jsonResponse(
        { error: "Generate a website for this business first." },
        404,
      );
    if (data.action === "connect")
      return jsonResponse({
        url: googleAuthorizationUrl(
          data.business,
          googleRedirectUri(request.url),
        ),
      });
    if (data.action === "disconnect") await disconnectGoogle(data.business);
    if (data.action === "save")
      await withIntegration(data.business, (record, save) =>
        save({ ...record, settings: data.settings }),
      );
    return jsonResponse({
      ...(await bookingStatus(data.business)),
      googleConfigured: googleOAuthConfigured(),
      redirectUri: googleRedirectUri(request.url),
    });
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) }, 400);
  }
}
