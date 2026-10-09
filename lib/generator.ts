import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  directionSchema,
  type Artifact,
  type Discovery,
  type Knowledge,
  type PhotoAsset,
} from "./types";
import { completion, getModels, ProviderError } from "./openrouter";
import { planPrompt, websitePrompt } from "./prompts";
import { validateWebsite } from "./validation";
import { inspectWebsite } from "./visual-check";
import { prepareMedia } from "./pexels";

const planSchema = z.object({
  directions: z
    .array(
      directionSchema.extend({
        imageQueries: z.array(z.string().trim().min(3).max(160)).min(1).max(2),
      }),
    )
    .length(3),
});
export async function makePlan(
  key: string,
  knowledge: Knowledge,
  discovery: Discovery | null,
  signal?: AbortSignal,
) {
  signal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(210000)])
    : AbortSignal.timeout(210000);
  const models = await getModels(signal);
  let lastError: unknown;
  for (const model of models.slice(0, 3)) {
    try {
      const result = await completion(
        key,
        model,
        await planPrompt(knowledge, discovery),
        signal,
        z.toJSONSchema(planSchema),
      );
      const raw = result.content
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
      const data = planSchema.parse(JSON.parse(raw));
      if (new Set(data.directions.map((d) => d.name.toLowerCase())).size !== 3)
        throw new Error("The model must create three distinct named concepts.");
      if (
        new Set(data.directions.map((d) => d.composition.toLowerCase()))
          .size !== 3 ||
        new Set(data.directions.map((d) => d.concept.toLowerCase())).size !== 3
      )
        throw new Error(
          "Each design direction must have its own concept and composition.",
        );
      const media = await Promise.all(
        data.directions.map((d) => prepareMedia(d.imageQueries, signal)),
      );
      return { ...data, model: result.model, media };
    } catch (error) {
      lastError = error;
      if (
        signal?.aborted ||
        (error instanceof ProviderError && [401, 402].includes(error.status))
      )
        throw error;
    }
  }
  throw lastError;
}
export async function makeWebsite(
  key: string,
  knowledge: Knowledge,
  discovery: Discovery | null,
  direction: z.infer<typeof directionSchema>,
  index: number,
  previous: Artifact[],
  signal?: AbortSignal,
  selectedModel?: string,
  photos: PhotoAsset[] = [],
  refinement?: { artifact: Artifact; prompt: string },
): Promise<Artifact> {
  signal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(210000)])
    : AbortSignal.timeout(210000);
  const models = await getModels(signal);
  const preferred = selectedModel
    ? models.find((m) => m.id === selectedModel)
    : models[index % models.length];
  if (selectedModel && !preferred)
    throw new Error(
      "Choose an available free model from the current catalogue.",
    );
  const candidates = [
    preferred!,
    ...models.filter((m) => m.id !== preferred!.id),
  ].slice(0, 3);
  let lastError: unknown;
  for (const model of candidates) {
    const messages = await websitePrompt(
      knowledge,
      discovery,
      direction,
      previous,
      photos,
      refinement,
    );
    for (let repair = 0; repair < 2; repair++) {
      try {
        const result = await completion(key, model, messages, signal);
        try {
          const validated = validateWebsite(
            result.content,
            knowledge,
            previous.map((p) => p.html),
            discovery,
            photos,
          );
          if (refinement && validated.html === refinement.artifact.html)
            throw new Error(
              "The requested change was not applied. Return an updated full document.",
            );
          const inspection = await inspectWebsite(
            validated.html,
            signal,
            validated.photoCredits,
          );
          if (inspection.errors.length)
            throw new Error(inspection.errors.join(" "));
          return {
            id: randomUUID(),
            index,
            name: direction.name,
            rationale: `${direction.concept}\n${direction.composition}`,
            html: validated.html,
            model: result.model,
            usage: result.usage,
            warnings: [...validated.warnings, ...inspection.warnings],
            createdAt: new Date().toISOString(),
            direction,
            photos,
            edits: refinement
              ? [
                  ...(refinement.artifact.edits ?? []).slice(-19),
                  {
                    prompt: refinement.prompt,
                    createdAt: new Date().toISOString(),
                  },
                ]
              : [],
          };
        } catch (error) {
          lastError = error;
          messages.push(
            { role: "assistant", content: result.content },
            {
              role: "user",
              content: `Correct this validation failure and return the entire revised HTML document: ${error instanceof Error ? error.message : "Invalid website"}`,
            },
          );
        }
      } catch (error) {
        lastError = error;
        if (
          signal?.aborted ||
          (error instanceof ProviderError && [401, 402].includes(error.status))
        )
          throw error;
        break;
      }
    }
  }
  throw lastError;
}
