import {
  apiKey,
  errorMessage,
  jsonResponse,
  protectRequest,
  readJson,
} from "@/lib/api";
import { refinementInput } from "@/lib/input";
import { makeWebsite } from "@/lib/generator";
import {
  readGeneratedSiteRecord,
  saveGeneratedSite,
  SiteRevisionConflict,
} from "@/lib/site-store";

export const runtime = "nodejs";
export const maxDuration = 240;
export async function POST(request: Request) {
  let identity: { business: string; version: string } | undefined;
  try {
    protectRequest(request, "refine", 18);
    const key = apiKey(request);
    const data = refinementInput.parse(await readJson(request, 20000));
    identity = data;
    const record = await readGeneratedSiteRecord(data.business, data.version);
    if (!record)
      return jsonResponse(
        {
          error:
            "This saved website could not be found. Generate this version first.",
        },
        404,
      );
    if (record.artifact.id !== data.revision) throw new SiteRevisionConflict();
    if (!record.generationContext || !record.artifact.direction)
      return jsonResponse(
        {
          error:
            "Regenerate this older design from your completed Business knowledge once to enable prompt editing.",
        },
        400,
      );
    const { knowledge, discovery } = record.generationContext;
    const siblingRecords = await Promise.all(
      ["1", "2", "3"]
        .filter((v) => v !== data.version)
        .map((v) => readGeneratedSiteRecord(data.business, v)),
    );
    const artifact = await makeWebsite(
      key,
      knowledge,
      discovery,
      record.artifact.direction,
      record.artifact.index,
      siblingRecords.flatMap((r) => (r ? [r.artifact] : [])),
      request.signal,
      data.model,
      record.artifact.photos ?? [],
      { artifact: record.artifact, prompt: data.prompt },
    );
    request.signal.throwIfAborted();
    return jsonResponse({
      artifact: await saveGeneratedSite(
        knowledge,
        artifact,
        discovery,
        data.revision,
      ),
    });
  } catch (error) {
    if (error instanceof SiteRevisionConflict && identity) {
      const latest = await readGeneratedSiteRecord(
        identity.business,
        identity.version,
      ).catch(() => null);
      return jsonResponse(
        {
          error: latest
            ? "This version changed. The latest saved design is now loaded; review it and apply your prompt again."
            : errorMessage(error),
          ...(latest ? { latestArtifact: latest.artifact } : {}),
        },
        409,
      );
    }
    return jsonResponse(
      { error: errorMessage(error) },
      error instanceof SiteRevisionConflict ? 409 : 400,
    );
  }
}
