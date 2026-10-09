import { readGeneratedSiteRecord, SiteRevisionConflict } from "./site-store";

export class SiteRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
/** Loads a saved version that the studio is allowed to extend or edit. */
export async function readEditableSite(
  business: string,
  version: string,
  revision: string,
) {
  const record = await readGeneratedSiteRecord(business, version);
  if (!record)
    throw new SiteRequestError(
      "This saved website could not be found. Generate this version first.",
      404,
    );
  if (record.artifact.id !== revision) throw new SiteRevisionConflict();
  if (!record.generationContext || !record.artifact.direction)
    throw new SiteRequestError(
      "Regenerate this older design from your completed Business knowledge once to enable prompt editing.",
      400,
    );
  return {
    ...record,
    generationContext: record.generationContext,
    designId: record.artifact.designId ?? record.artifact.id,
  };
}
