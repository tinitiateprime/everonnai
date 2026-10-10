import { z } from "zod";
import * as cssTree from "css-tree";
import { completion, getModels } from "../openrouter";
import { websiteKeyName } from "../api";
import { localPlatformMode, PlatformError } from "../platform/config";
import { readSkill } from "../website-skill";
import { checkDesignLayout } from "./design-check";
import type { BlueprintDocument, Fact } from "../knowledge/contracts";
// The designer's read of the business and the theme it chose. Optional in the stored
// schema so designs accepted before context-aware theming still validate; required for
// every newly generated design (see requireThemedDesign).
const designContextSchema = z
  .object({
    industry: z.string().trim().min(2).max(200),
    audience: z.string().trim().min(2).max(600),
    mood: z.array(z.string().trim().min(2).max(40)).min(1).max(6),
    vibe: z.string().trim().min(10).max(1000),
  })
  .strict();
const designThemeSchema = z
  .object({
    palette: z
      .array(z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i))
      .min(3)
      .max(8),
    typography: z.string().trim().min(5).max(400),
    motif: z.string().trim().min(5).max(600),
  })
  .strict();
export const designSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    rationale: z.string().trim().min(10).max(3000),
    context: designContextSchema.optional(),
    theme: designThemeSchema.optional(),
    navigation: z.enum(["top", "rail"]),
    hero: z.enum(["center", "split", "left"]),
    content: z.enum(["article", "cards", "columns"]),
    css: z.string().min(100).max(60000),
  })
  .strict();
export type Design = z.infer<typeof designSchema>;
/** Business understanding and owner brief supplied to the website designer. */
export type DesignBrief = {
  pages: {
    path: string;
    title: string;
    family: string;
    headings: string[];
    excerpt: string;
  }[];
  agentPrompt?: string;
  customerGaps?: string;
  corrections?: string[];
};
export function requireThemedDesign(design: Design) {
  if (!design.context || !design.theme)
    throw new PlatformError(
      "The design must state its reading of the business context and its theme. Retry design generation.",
      422,
    );
  return design;
}
export type DesignResult = {
  design: Design;
  model: string;
  usage: unknown;
  mode: "live" | "fixture";
};
export function validateDesign(input: unknown): Design {
  const design = designSchema.parse(input);
  const tree = cssTree.parse(design.css, {
    parseCustomProperty: true,
    onParseError: () => {
      throw new PlatformError(
        "The generated CSS could not be safely parsed.",
        422,
      );
    },
  });
  cssTree.walk(tree, (node) => {
    if (
      node.type === "Url" ||
      node.type === "Raw" ||
      (node.type === "Function" &&
        ["url", "expression"].includes(
          cssTree.ident.decode(node.name).toLowerCase(),
        )) ||
      (node.type === "Atrule" &&
        ["import", "font-face"].includes(
          cssTree.ident.decode(node.name).toLowerCase(),
        )) ||
      (node.type === "Declaration" &&
        ["behavior", "-moz-binding"].includes(
          cssTree.ident.decode(node.property).toLowerCase(),
        ))
    )
      throw new PlatformError(
        "The generated design contains unsupported external or executable CSS.",
        422,
      );
  });
  if (/<\/|javascript\s*:|expression\s*\(/i.test(design.css))
    throw new PlatformError("The generated CSS failed safety checks.", 422);
  return design;
}
export async function createDesign(
  blueprint: BlueprintDocument,
  facts: Fact[],
  slot: number,
  peers: Design[],
  signal?: AbortSignal,
  preferredModel?: string,
  brief?: DesignBrief,
): Promise<DesignResult> {
  if (
    localPlatformMode() &&
    process.env.PLATFORM_TEST_OUTPUT === "1" &&
    process.env.PLATFORM_TEST_CRAWL_FIXTURE === "1"
  ) {
    const color = ["#175f51", "#513661", "#254b71"][slot - 1];
    return {
      design: validateDesign({
        name: `Fixture alternative ${slot}`,
        rationale:
          "Deterministic design fixture for exercising the complete compiler and backend.",
        context: {
          industry: "Test fixture business",
          audience: "Automated test reviewers",
          mood: ["neutral", "clear"],
          vibe: "Deterministic fixture styling; not a model judgment.",
        },
        theme: {
          palette: [color, "#fafafa", "#172323"],
          typography: slot === 2 ? "Georgia serif" : "Arial sans-serif",
          motif: "Plain test fixture blocks.",
        },
        navigation: slot === 2 ? "rail" : "top",
        hero: slot === 1 ? "center" : slot === 2 ? "split" : "left",
        content: slot === 1 ? "article" : slot === 2 ? "cards" : "columns",
        css: `body{background:#fafafa;color:#172323;font-family:${slot === 2 ? "Georgia,serif" : "Arial,sans-serif"}}.site-shell{max-width:1120px;margin:auto;padding:24px}.site-header{border-bottom:3px solid ${color};padding:20px 0}.hero{background:${color};color:white;padding:clamp(24px,5vw,60px);margin:24px 0;border-radius:${slot * 4}px}.source-content{line-height:1.8}.enquiry button{background:${color};color:white;padding:14px;border-radius:8px}`,
      }),
      model: "deterministic-test-fixture",
      usage: null,
      mode: "fixture",
    };
  }
  const key = process.env[websiteKeyName()]?.trim();
  if (!key)
    throw new PlatformError(
      `Website generation needs ${websiteKeyName()} in the server environment.`,
      503,
    );
  const models = await getModels(signal),
    model = preferredModel
      ? models.find((model) => model.id === preferredModel)
      : models[(slot - 1) % models.length];
  if (!model)
    throw new PlatformError(
      "The fixed generation model is no longer available. Create a new build configuration.",
      409,
    );
  const messages: { role: string; content: string }[] = [
    {
      role: "system",
      content: `${await readSkill("website-designer", "Website designer")}

Return one JSON object with exactly: name; rationale (how the business context led to this look); context {industry, audience, mood (3-5 words), vibe}; theme {palette (3-8 hex colours used in the CSS), typography (the font stacks and type character), motif (the shapes/textures/dividers you created)}; navigation (top|rail); hero (center|split|left); content (article|cards|columns); css. The trusted application implements routes, all approved content and a working enquiry form. Never reduce required pages.`,
    },
    {
      role: "user",
      content: JSON.stringify({
        slot,
        facts: facts
          .filter((f) => f.value)
          .map(({ key, value }) => ({ key, value })),
        pages: brief?.pages.length
          ? brief.pages
          : blueprint.pages
              .filter((p) => p.outcome === "render")
              .map(({ path, title, family }) => ({ path, title, family })),
        // The owner's improvement brief from the growth review, and their corrections.
        ownerBrief: brief?.agentPrompt
          ? {
              agentPrompt: brief.agentPrompt,
              whatTheCurrentSiteLacks: brief.customerGaps ?? "",
            }
          : null,
        ownerCorrections: brief?.corrections ?? [],
        priorDesigns: peers.map(
          ({
            name,
            rationale,
            context,
            theme,
            navigation,
            hero,
            content,
            css,
          }) => ({
            name,
            rationale,
            context,
            theme,
            navigation,
            hero,
            content,
            css: css.slice(0, 6000),
          }),
        ),
      }),
    },
  ];
  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "name",
      "rationale",
      "context",
      "theme",
      "navigation",
      "hero",
      "content",
      "css",
    ],
    properties: {
      name: { type: "string" },
      rationale: { type: "string" },
      context: {
        type: "object",
        additionalProperties: false,
        required: ["industry", "audience", "mood", "vibe"],
        properties: {
          industry: { type: "string" },
          audience: { type: "string" },
          mood: { type: "array", items: { type: "string" } },
          vibe: { type: "string" },
        },
      },
      theme: {
        type: "object",
        additionalProperties: false,
        required: ["palette", "typography", "motif"],
        properties: {
          palette: { type: "array", items: { type: "string" } },
          typography: { type: "string" },
          motif: { type: "string" },
        },
      },
      navigation: { type: "string", enum: ["top", "rail"] },
      hero: { type: "string", enum: ["center", "split", "left"] },
      content: { type: "string", enum: ["article", "cards", "columns"] },
      css: { type: "string" },
    },
  };
  const businessName =
    facts.find((fact) => fact.key === "business_name" && fact.value)?.value ??
    brief?.pages[0]?.title ??
    "Business";
  const usage: unknown[] = [];
  let problems: string[] = [];
  // One repair round: layout problems measured in Chromium go back to the model.
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await completion(
      key,
      model,
      messages,
      signal,
      schema,
      // Complete themed CSS needs far more than the 5,000-token structured default.
      16000,
    );
    usage.push(result.usage ?? null);
    let data: unknown;
    try {
      data = JSON.parse(
        result.content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
      );
    } catch {
      throw new PlatformError(
        "The design provider returned invalid structured output. Retry this build.",
        503,
      );
    }
    const design = requireThemedDesign(validateDesign(data));
    problems =
      (brief?.pages.length
        ? await checkDesignLayout(design, businessName, brief)
        : null) ?? [];
    if (!problems.length)
      return {
        design,
        model: result.model,
        usage: usage.length === 1 ? usage[0] : usage,
        mode: "live",
      };
    messages.push(
      { role: "assistant", content: result.content },
      {
        role: "user",
        content: `The design was rendered with this business's real content and has layout problems: ${problems.join(" ")} Fix them while keeping the same context reading, theme, palette and vibe. Return the complete JSON object again.`,
      },
    );
  }
  throw new PlatformError(
    `The generated design still has layout problems after a repair: ${problems.join(" ")} Retry design generation.`,
    422,
  );
}
