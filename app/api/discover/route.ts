import { randomUUID } from "node:crypto";
import { z } from "zod";
import { discoverWebsite } from "@/lib/crawler";
import {
  errorMessage,
  jsonResponse,
  protectRequest,
  readJson,
} from "@/lib/api";
import { discoverySchema } from "@/lib/input";
import { readCrawl, saveCrawl, withCrawlLock } from "@/lib/discovery-store";
import { MAX_CRAWL_PAGES } from "@/lib/crawl-limits";
export const runtime = "nodejs";
export const maxDuration = 240;
export async function POST(request: Request) {
  try {
    protectRequest(request, "discover", 120);
    const input = z
      .object({
        url: z.string().trim().min(1).max(2048),
        crawlId: z.uuid().optional(),
        extend: z.boolean().default(false),
        capturedCount: z.number().int().min(0).max(MAX_CRAWL_PAGES).optional(),
        previous: discoverySchema.optional(),
      })
      .parse(await readJson(request, 6_000_000));
    const state = input.crawlId ? await readCrawl(input.crawlId) : undefined;
    const id = state?.id ?? randomUUID();
    const pageLimit = state?.result.crawl?.pageLimit;
    const aborted = new AbortController();
    const signal = AbortSignal.any([request.signal, aborted.signal]);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: unknown) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
          } catch {
            /* Disconnected clients keep their checkpoint. */
          }
        };
        let sentPages = Math.min(
          input.capturedCount ?? MAX_CRAWL_PAGES,
          state?.result.pages.length ?? input.previous?.pages.length ?? 0,
        );
        try {
          const discovery = await withCrawlLock(id, () =>
            discoverWebsite(
              input.url,
              (message) => send({ type: "progress", message }),
              signal,
              {
                id,
                resume: state,
                previous: input.previous,
                ...(input.extend && pageLimit
                  ? {
                      maxPages: Math.min(
                        MAX_CRAWL_PAGES,
                        Math.max(pageLimit + 100, pageLimit * 2),
                      ),
                    }
                  : {}),
                onCheckpoint: async (checkpoint) => {
                  await saveCrawl(checkpoint);
                  const pages = checkpoint.result.pages.slice(sentPages);
                  sentPages = checkpoint.result.pages.length;
                  send({
                    type: "checkpoint",
                    discovery: { ...checkpoint.result, pages: [] },
                    pages,
                  });
                },
              },
            ),
          );
          send({
            type: "result",
            discovery: { ...discovery, pages: [] },
            pages: [],
          });
        } catch (error) {
          send({ type: "error", message: errorMessage(error) });
        } finally {
          try {
            controller.close();
          } catch {
            /* Already closed. */
          }
        }
      },
      cancel() {
        aborted.abort();
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
