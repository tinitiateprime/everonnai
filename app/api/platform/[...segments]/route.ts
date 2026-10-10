import { platformRequest } from "@/lib/platform/http";
export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ segments: string[] }> };
export async function GET(request: Request, context: Context) {
  return platformRequest(request, (await context.params).segments);
}
export async function POST(request: Request, context: Context) {
  return platformRequest(request, (await context.params).segments);
}
