import { acceptElevenLabsWebhook, verifyElevenLabsSignature } from "@/features/usage/webhook";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET || "";
  if (!secret) return Response.json({ error: "Webhook verification is not configured." }, { status: 503 });
  if (Number(request.headers.get("content-length")) > 2_000_000) return new Response(null, { status: 413 });
  // Limit the stream, including senders without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2_000_000) { await reader.cancel(); return new Response(null, { status: 413 }); }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!verifyElevenLabsSignature(raw, request.headers.get("elevenlabs-signature"), secret)) return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  let input;
  try { input = JSON.parse(raw); if (!input || typeof input !== "object") throw new Error(); }
  catch { return Response.json({ error: "Invalid webhook payload." }, { status: 400 }); }
  try { await acceptElevenLabsWebhook(input); return Response.json({ accepted: true }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Usage delivery failed. Retry this webhook." }, { status: 503 }); }
}
