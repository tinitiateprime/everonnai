import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../auth/sessions";
import type { PlatformDatabase, SqlClient } from "../platform/database";
import { PlatformError } from "../platform/config";
import {
  projectTransaction,
  audit,
  uuid,
  type Project,
} from "../projects/service";
import {
  loadArtifact,
  prepareObject,
  registerObject,
  type ObjectStore,
  type PreparedObject,
} from "../storage/artifacts";
import { snapshotDetail, snapshotPage } from "../discovery/service";
import {
  factsDocumentSchema,
  approveFactsInput,
  blueprintDocumentSchema,
  approveBlueprintInput,
  type Fact,
  type FactSet,
  type Blueprint,
  type BlueprintPage,
} from "./contracts";

const factsColumns = `id,snapshot_id AS "snapshotId",version,status,document_object_id AS "documentObjectId",content_sha256 AS "contentSha256",created_at::text AS "createdAt"`;
const blueprintColumns = `id,snapshot_id AS "snapshotId",fact_set_id AS "factSetId",version,status,document_object_id AS "documentObjectId",content_sha256 AS "contentSha256",created_at::text AS "createdAt"`;
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
async function metadata<T>(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
  table: "fact_sets" | "blueprint_revisions",
  columns: string,
  id: string,
) {
  uuid.parse(id);
  return projectTransaction(db, actor, projectId, false, async (client) => {
    const row = (
      await client.query<T>(
        `SELECT ${columns} FROM everonn_platform.${table} WHERE id=$1`,
        [id],
      )
    ).rows[0];
    if (!row)
      throw new PlatformError(
        "This revision is unavailable or you do not have access.",
        404,
      );
    return row;
  });
}
export async function factSetDetail(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  id: string,
) {
  const record = await metadata<FactSet>(
    db,
    actor,
    projectId,
    "fact_sets",
    factsColumns,
    id,
  );
  const artifact = await loadArtifact(
    db,
    store,
    actor,
    projectId,
    record.documentObjectId,
  );
  if (artifact.record.sha256 !== record.contentSha256)
    throw new PlatformError("Fact-set integrity verification failed.", 503);
  return {
    record,
    document: factsDocumentSchema.parse(
      JSON.parse(Buffer.from(artifact.bytes).toString()),
    ),
  };
}
export async function blueprintDetail(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  id: string,
) {
  const record = await metadata<Blueprint>(
    db,
    actor,
    projectId,
    "blueprint_revisions",
    blueprintColumns,
    id,
  );
  const artifact = await loadArtifact(
    db,
    store,
    actor,
    projectId,
    record.documentObjectId,
  );
  if (artifact.record.sha256 !== record.contentSha256)
    throw new PlatformError("Blueprint integrity verification failed.", 503);
  return {
    record,
    document: blueprintDocumentSchema.parse(
      JSON.parse(Buffer.from(artifact.bytes).toString()),
    ),
  };
}
export async function listKnowledge(
  db: PlatformDatabase,
  actor: Actor,
  projectId: string,
) {
  return projectTransaction(db, actor, projectId, false, async (client) => ({
    facts: (
      await client.query<FactSet>(
        `SELECT ${factsColumns} FROM everonn_platform.fact_sets ORDER BY version DESC LIMIT 100`,
      )
    ).rows,
    blueprints: (
      await client.query<Blueprint>(
        `SELECT ${blueprintColumns} FROM everonn_platform.blueprint_revisions ORDER BY version DESC LIMIT 100`,
      )
    ).rows,
  }));
}
async function revision(
  client: SqlClient,
  project: Project,
  table: "fact_sets" | "blueprint_revisions",
) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    project.id,
  ]);
  return (
    await client.query<{ next: number }>(
      `SELECT COALESCE(max(version),0)+1 AS next FROM everonn_platform.${table}`,
    )
  ).rows[0].next;
}
async function writeFacts(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  document: ReturnType<typeof factsDocumentSchema.parse>,
  status: "draft" | "approved",
) {
  const project = await projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (_, project) => project,
  );
  const object = await prepareObject(
    store,
    project,
    bytes(document),
    "facts.json",
  );
  return projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client, current) => {
      const id = randomUUID(),
        version = await revision(client, current, "fact_sets");
      await registerObject(client, actor, current, object);
      await client.query(
        `INSERT INTO everonn_platform.fact_sets(id,tenant_id,project_id,snapshot_id,version,status,document_object_id,content_sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          current.tenantId,
          current.id,
          document.snapshotId,
          version,
          status,
          object.id,
          object.sha256,
          actor.id,
        ],
      );
      for (const fact of document.facts)
        await client.query(
          `INSERT INTO everonn_platform.facts(id,tenant_id,project_id,fact_set_id,key,value,verification,required,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [
            fact.id,
            current.tenantId,
            current.id,
            id,
            fact.key,
            fact.value,
            fact.verification,
            fact.required,
            JSON.stringify({
              source: fact.evidence,
              ownerDecision:
                status === "approved"
                  ? {
                      actorId: actor.id,
                      decision:
                        fact.verification === "owner_confirmed"
                          ? "confirmed"
                          : "omitted",
                    }
                  : null,
            }),
          ],
        );
      await audit(
        client,
        actor,
        current.tenantId,
        current.id,
        `facts.${status}`,
        id,
      );
      return (
        await client.query<FactSet>(
          `SELECT ${factsColumns} FROM everonn_platform.fact_sets WHERE id=$1`,
          [id],
        )
      ).rows[0];
    },
  );
}
export async function extractFacts(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  snapshotId: string,
) {
  const project = await projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (_, project) => project,
  );
  const initial = await snapshotDetail(db, store, actor, projectId, snapshotId);
  const candidates: {
    email: { value: string; captureId: string }[];
    phone: { value: string; captureId: string }[];
  } = { email: [], phone: [] };
  for (let offset = 0; offset < initial.total; offset += 100) {
    const part = offset
      ? await snapshotDetail(db, store, actor, projectId, snapshotId, offset)
      : initial;
    for (const page of part.pages)
      if (page.captureId) {
        const source = await snapshotPage(
          db,
          store,
          actor,
          projectId,
          snapshotId,
          page.captureId,
        );
        for (const value of source.evidence.page.emails)
          candidates.email.push({ value, captureId: page.captureId });
        for (const value of source.evidence.page.phones)
          candidates.phone.push({ value, captureId: page.captureId });
      }
  }
  const facts: Fact[] = [
    {
      id: randomUUID(),
      key: "business_name",
      label: "Business name",
      value: project.name,
      required: true,
      verification: "unknown",
      candidates: [],
      evidence: [],
    },
  ];
  for (const key of ["email", "phone"] as const) {
    const values = [...new Set(candidates[key].map((p) => p.value))].slice(
      0,
      100,
    );
    facts.push({
      id: randomUUID(),
      key,
      label: key === "email" ? "Public email" : "Public phone",
      value: values.length === 1 ? values[0] : "",
      required: false,
      verification:
        values.length > 1
          ? "conflict"
          : values.length
            ? "source_supported"
            : "unknown",
      candidates: values,
      evidence: candidates[key]
        .slice(0, 100)
        .map((p) => ({ ...p, locator: key })),
    });
  }
  for (const [key, label] of [
    ["address", "Public address"],
    ["hours", "Opening hours"],
  ] as const)
    facts.push({
      id: randomUUID(),
      key,
      label,
      value: "",
      required: false,
      verification: "unknown",
      candidates: [],
      evidence: [],
    });
  return writeFacts(
    db,
    store,
    actor,
    projectId,
    { version: 1, snapshotId, facts },
    "draft",
  );
}
export async function approveFacts(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  id: string,
  input: unknown,
) {
  const choices = approveFactsInput.parse(input),
    current = await factSetDetail(db, store, actor, projectId, id);
  if (current.record.status !== "draft")
    throw new PlatformError(
      "Review a draft fact set before approving a new revision.",
      409,
    );
  if (
    choices.decisions.length !== current.document.facts.length ||
    new Set(choices.decisions.map((p) => p.id)).size !==
      choices.decisions.length
  )
    throw new PlatformError("Account for every fact exactly once.", 422);
  const facts = current.document.facts.map((fact) => {
    const decision = choices.decisions.find((p) => p.id === fact.id);
    if (!decision) throw new PlatformError("A fact decision is missing.", 422);
    if (fact.required && (decision.decision !== "confirm" || !decision.value))
      throw new PlatformError("Confirm the required business name.", 422);
    if (decision.decision === "confirm" && !decision.value)
      throw new PlatformError("A confirmed fact needs a value.", 422);
    if (
      decision.decision === "confirm" &&
      fact.key === "email" &&
      !z.email().safeParse(decision.value).success
    )
      throw new PlatformError(
        "Confirm a valid public email address or omit it.",
        422,
      );
    if (
      decision.decision === "confirm" &&
      fact.key === "business_name" &&
      decision.value.length > 120
    )
      throw new PlatformError(
        "Keep the business name within 120 characters.",
        422,
      );
    return {
      ...fact,
      id: randomUUID(),
      value: decision.decision === "omit" ? "" : decision.value,
      verification:
        decision.decision === "confirm"
          ? ("owner_confirmed" as const)
          : ("unknown" as const),
    };
  });
  return writeFacts(
    db,
    store,
    actor,
    projectId,
    { ...current.document, facts },
    "approved",
  );
}
function publicPath(url: string) {
  const parts = new URL(url).pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .map(
      (part) =>
        part
          .normalize("NFKD")
          .replace(/[^a-zA-Z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 80) || "page",
    );
  const value = "/" + parts.join("/");
  return /^\/(api|_next|404)(\/|$)/.test(value)
    ? "/source" + value
    : value.slice(0, 400);
}
async function writeBlueprint(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  document: ReturnType<typeof blueprintDocumentSchema.parse>,
  status: "draft" | "approved",
  contentObjects: PreparedObject[] = [],
) {
  const project = await projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (_, project) => project,
  );
  const object = await prepareObject(
    store,
    project,
    bytes(document),
    "blueprint.json",
  );
  return projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (client, current) => {
      const id = randomUUID(),
        version = await revision(client, current, "blueprint_revisions");
      for (const content of contentObjects)
        await registerObject(client, actor, current, content);
      await registerObject(client, actor, current, object);
      await client.query(
        `INSERT INTO everonn_platform.blueprint_revisions(id,tenant_id,project_id,snapshot_id,fact_set_id,version,status,document_object_id,content_sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          current.tenantId,
          current.id,
          document.snapshotId,
          document.factSetId,
          version,
          status,
          object.id,
          object.sha256,
          actor.id,
        ],
      );
      for (const page of document.pages)
        await client.query(
          `INSERT INTO everonn_platform.blueprint_pages(id,tenant_id,project_id,blueprint_id,path,outcome,content_object_id,content_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            page.id,
            current.tenantId,
            current.id,
            id,
            page.path,
            page.outcome,
            page.contentObjectId,
            page.contentSha256,
          ],
        );
      await audit(
        client,
        actor,
        current.tenantId,
        current.id,
        `blueprint.${status}`,
        id,
      );
      return (
        await client.query<Blueprint>(
          `SELECT ${blueprintColumns} FROM everonn_platform.blueprint_revisions WHERE id=$1`,
          [id],
        )
      ).rows[0];
    },
  );
}
export async function createBlueprint(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  factSetId: string,
) {
  const facts = await factSetDetail(db, store, actor, projectId, factSetId);
  if (facts.record.status !== "approved")
    throw new PlatformError(
      "Approve business facts before preparing a blueprint.",
      422,
    );
  const project = await projectTransaction(
    db,
    actor,
    projectId,
    true,
    async (_, project) => project,
  );
  const initial = await snapshotDetail(
    db,
    store,
    actor,
    projectId,
    facts.record.snapshotId,
  );
  const pages: BlueprintPage[] = [],
    objects: PreparedObject[] = [],
    paths = new Set<string>();
  for (let offset = 0; offset < initial.total; offset += 100) {
    const part = offset
      ? await snapshotDetail(
          db,
          store,
          actor,
          projectId,
          facts.record.snapshotId,
          offset,
        )
      : initial;
    for (const row of part.pages) {
      let path = publicPath(row.url);
      if (paths.has(path))
        path =
          path === "/" ? "/source-home" : path + "-" + randomUUID().slice(0, 8);
      paths.add(path);
      let object: PreparedObject | null = null,
        title = row.title || new URL(row.url).pathname;
      if (row.captureId) {
        const source = await snapshotPage(
          db,
          store,
          actor,
          projectId,
          facts.record.snapshotId,
          row.captureId,
        );
        title = source.evidence.page.title || title;
        let text = source.evidence.page.text;
        const transformations: { key: string; from: string; to: string }[] = [];
        for (const fact of facts.document.facts.filter(
          (fact) =>
            ["email", "phone"].includes(fact.key) &&
            fact.value &&
            fact.verification === "owner_confirmed",
        )) {
          for (const from of fact.candidates.filter(
            (value) => value !== fact.value && value && text.includes(value),
          )) {
            text = text.split(from).join(fact.value);
            transformations.push({ key: fact.key, from, to: fact.value });
          }
        }
        object = await prepareObject(
          store,
          project,
          bytes({
            version: 1,
            title,
            text,
            transformations,
            approvedFactSetId: facts.record.id,
            headings: source.evidence.page.headings,
            captureIds: [row.captureId],
          }),
          "blueprint-page.json",
        );
        objects.push(object);
      }
      pages.push({
        id: randomUUID(),
        sourceUrl: row.url,
        path,
        title: title.slice(0, 2000) || "Page",
        family:
          path === "/"
            ? "home"
            : /contact/i.test(path)
              ? "contact"
              : /about/i.test(path)
                ? "about"
                : /privacy|terms|policy/i.test(path)
                  ? "policy"
                  : /service/i.test(path)
                    ? "service"
                    : /blog|news/i.test(path)
                      ? "article"
                      : "content",
        outcome: object ? "render" : "unresolved",
        target: null,
        reason: row.reason || "",
        contentObjectId: object?.id ?? null,
        contentSha256: object?.sha256 ?? null,
        captureIds: row.captureId ? [row.captureId] : [],
      });
    }
  }
  if (!pages.some((p) => p.path === "/" && p.outcome === "render")) {
    const source = pages.find((p) => p.outcome === "render");
    if (source)
      pages.push({
        ...source,
        id: randomUUID(),
        sourceUrl: "",
        path: "/",
        family: "home",
        title: project.name,
      });
  }
  return writeBlueprint(
    db,
    store,
    actor,
    projectId,
    blueprintDocumentSchema.parse({
      version: 1,
      snapshotId: facts.record.snapshotId,
      factSetId,
      pages,
      features: [
        {
          key: "enquiry",
          version: "1.0.0",
          mode: "preview_local",
          required: true,
        },
      ],
    }),
    "draft",
    objects,
  );
}
export async function approveBlueprint(
  db: PlatformDatabase,
  store: ObjectStore,
  actor: Actor,
  projectId: string,
  id: string,
  input: unknown,
) {
  const choices = approveBlueprintInput.parse(input),
    current = await blueprintDetail(db, store, actor, projectId, id);
  if (current.record.status !== "draft")
    throw new PlatformError(
      "Approve a draft blueprint; approved revisions stay fixed.",
      409,
    );
  if (
    choices.pages.length !== current.document.pages.length ||
    new Set(choices.pages.map((p) => p.id)).size !== choices.pages.length
  )
    throw new PlatformError(
      "Every source page needs exactly one explicit outcome.",
      422,
    );
  const pages = current.document.pages.map((page) => {
    const choice = choices.pages.find((p) => p.id === page.id);
    if (!choice)
      throw new PlatformError("A source-page decision is missing.", 422);
    if (choice.outcome === "render" && !page.contentObjectId)
      throw new PlatformError(
        "An uncaptured page cannot be marked implemented. Capture it or explicitly exclude it.",
        422,
      );
    if (choice.outcome === "exclude" && !choice.reason)
      throw new PlatformError("Explain each excluded source page.", 422);
    return { ...page, ...choice, id: randomUUID() };
  });
  const render = pages.filter((p) => p.outcome === "render");
  if (!render.some((p) => p.path === "/"))
    throw new PlatformError(
      "The approved website needs a rendered home page.",
      422,
    );
  if (render.length > 2000)
    throw new PlatformError(
      "The initial build limit is 2,000 rendered pages.",
      422,
    );
  if (new Set(pages.map((p) => p.path)).size !== pages.length)
    throw new PlatformError("Blueprint paths must be unique.", 422);
  for (const page of pages)
    if (
      page.outcome === "redirect" &&
      (!page.target || !render.some((p) => p.path === page.target))
    )
      throw new PlatformError(
        "Redirects must target an approved rendered route.",
        422,
      );
  for (const page of pages.filter(
    (page) => page.outcome === "redirect" && page.contentObjectId,
  )) {
    const target = render.find((target) => target.path === page.target)!;
    const [sourceContent, targetContent] = await Promise.all([
      loadArtifact(db, store, actor, projectId, page.contentObjectId!),
      loadArtifact(db, store, actor, projectId, target.contentObjectId!),
    ]);
    const sourceText = JSON.parse(
      Buffer.from(sourceContent.bytes).toString(),
    ).text;
    const targetText = JSON.parse(
      Buffer.from(targetContent.bytes).toString(),
    ).text;
    if (sourceText !== targetText)
      throw new PlatformError(
        "This redirect would lose distinct captured content. Keep that page rendered or explicitly exclude it with a reason.",
        422,
      );
  }
  return writeBlueprint(
    db,
    store,
    actor,
    projectId,
    { ...current.document, pages },
    "approved",
  );
}
