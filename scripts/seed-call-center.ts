import { loadEnvConfig } from "@next/env";
import { closeCallCenterPool, withDeskTransaction, type DeskTx } from "../lib/call-center-mysql";
import { newId } from "../features/call-center/ids";

// DEMO SEED for the Live Agent Desk. Creates three sample clients with lines,
// desk profiles, greeting scripts and transfer contacts, an EverOnn operator
// org, and operators. Idempotent: rows are matched by slug, number and email.
//
//   npm run call-center:db:seed -- --lead-email you@example.com [--operator-email a@x.com,b@y.com]
//
// The lead email must match an existing EverOnn sign-in to open /desk.
loadEnvConfig(process.cwd());

const argument = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || "" : "";
};

const allWeek = [{ days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "24:00" }];
const businessHours = [{ days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00" }, { days: [6], start: "09:00", end: "14:00" }];

const clients = [
  {
    slug: "acme-locksmith-demo", name: "Acme Locksmith", spoken: "Acme Locksmith", pronunciation: "AK-mee LOCK-smith", color: "#1F6FEB", vertical: "locksmith", timeZone: "America/New_York",
    lines: [
      { kind: "voice", label: "Main line", e164: "+19195550100", hours: "business_hours" },
      { kind: "voice", label: "After-hours emergency line", e164: "+19195550101", hours: "after_hours" },
      { kind: "sms", label: "Text line", e164: "+19195550102", hours: "any" },
      { kind: "chat", label: "Website chat", widget: "wk_acme_demo", hours: "any" },
    ],
    authority: { quote: "not_allowed", commit_eta: "requires_owner_approval", book: "allowed", dispatch: "requires_owner_approval", payment_link: "not_allowed", cancel_reschedule: "allowed", share_technician: "allowed", grant_exception: "not_allowed" },
    notes: "VIP customers: Mr. Lee. Never promise an arrival time without the owner.",
    special: { vip_list: ["Mr. Lee"], blocked_addresses: ["12 Elm St"], instructions: ["Ask whether the caller is somewhere safe before anything else.", "Car lockouts with a child inside are emergencies: advise 911 first."] },
    facts: { hours: "Mon–Fri 8–6, Sat 9–2; emergency line 24/7", business_hours: businessHours, services: ["Car lockout", "House lockout", "Rekey", "Lock change", "Safe opening"], service_area: "Raleigh, Durham, Cary", pricing_policy: "No quotes by phone; the technician confirms on site.", payment_methods: ["Card on site", "Cash"] },
    doNotSay: ["guaranteed", "cheapest", "free"],
    slots: [{ field: "service_type", label: "Service", required: true }, { field: "address", label: "Address", required: true }, { field: "vehicle", label: "Vehicle", required: false }, { field: "safety_status", label: "Safety status", required: true }, { field: "callback_number", label: "Callback number", required: true }],
    canned: ["A technician will call you back from our business number within 15 minutes.", "For your safety, please stay in a well-lit public place while you wait."],
    greetings: [
      ["en", "business_hours", "Thank you for calling {client_name}, this is {operator_first_name}. How can I help?"],
      ["en", "after_hours", "Thank you for calling {client_name}'s emergency line, this is {operator_first_name}. Are you somewhere safe?"],
      ["en", "callback", "Hi, this is {operator_first_name} calling back from {client_name} about your request."],
      ["en", "outbound", "Hello, this is {operator_first_name} calling on behalf of {client_name}."],
      ["es", "business_hours", "Gracias por llamar a {client_name}, le atiende {operator_first_name}. ¿En qué le puedo ayudar?"],
      ["es", "after_hours", "Gracias por llamar a la línea de emergencias de {client_name}, le atiende {operator_first_name}. ¿Está en un lugar seguro?"],
    ],
    transfers: [{ name: "Alex Kim", role: "Owner", e164: "+19195550190", priority: 1, onCall: true }, { name: "Jordan Lee", role: "Lead technician", e164: "+19195550191", priority: 2, onCall: false }],
    required: ["client_notes"],
  },
  {
    slug: "bright-plumbing-demo", name: "Bright Plumbing", spoken: "Bright Plumbing", pronunciation: null, color: "#0E9F6E", vertical: "plumbing", timeZone: "America/Chicago",
    lines: [{ kind: "voice", label: "Main line", e164: "+13125550140", hours: "any" }, { kind: "chat", label: "Website chat", widget: "wk_bright_demo", hours: "any" }],
    authority: { quote: "not_allowed", commit_eta: "not_allowed", book: "allowed", dispatch: "requires_owner_approval", payment_link: "not_allowed", cancel_reschedule: "requires_owner_approval", share_technician: "not_allowed", grant_exception: "not_allowed" },
    notes: "Gas smell: tell the caller to leave the building and call 911 or the gas utility from outside, then warm-transfer to the on-call plumber.",
    special: { vip_list: [], blocked_addresses: [], instructions: ["Water heater jobs: capture tank size and fuel type."] },
    facts: { hours: "Mon–Fri 7–7, Sat 8–4", business_hours: businessHours, services: ["Leak repair", "Water heater replacement", "Drain cleaning", "Gas line service"], service_area: "Chicago north side and Evanston", pricing_policy: "Free estimates on site; never quote by phone.", payment_methods: ["Card", "Check", "Financing"] },
    doNotSay: ["guaranteed same day"],
    slots: [{ field: "service_type", label: "Service", required: true }, { field: "address", label: "Address", required: true }, { field: "preferred_time", label: "Preferred time", required: false }, { field: "safety_status", label: "Safety status", required: false }],
    canned: ["Thanks! The team will confirm your appointment by text shortly."],
    greetings: [
      ["en", "business_hours", "Thanks for calling {client_name}, this is {operator_first_name}. What's going on with your plumbing today?"],
      ["en", "after_hours", "Thanks for calling {client_name} after hours, this is {operator_first_name}. Is this an emergency?"],
      ["en", "callback", "Hi, it's {operator_first_name} from {client_name}, returning your call."],
    ],
    transfers: [{ name: "Chris Bright", role: "Owner", e164: "+13125550149", priority: 1, onCall: false }, { name: "On-call plumber", role: "Technician", e164: "+13125550148", priority: 2, onCall: true }],
    required: [],
  },
  {
    slug: "delta-hvac-demo", name: "Delta HVAC", spoken: "Delta H-V-A-C", pronunciation: "DEL-tuh aitch-vee-ay-see", color: "#C2410C", vertical: "hvac", timeZone: "America/Denver",
    lines: [{ kind: "voice", label: "Main line", e164: "+17205550180", hours: "any" }, { kind: "sms", label: "Text line", e164: "+17205550181", hours: "any" }],
    authority: { quote: "not_allowed", commit_eta: "requires_owner_approval", book: "allowed", dispatch: "allowed", payment_link: "not_allowed", cancel_reschedule: "allowed", share_technician: "allowed", grant_exception: "requires_owner_approval" },
    notes: "No-heat calls with infants or seniors in the home are priority dispatch.",
    special: { vip_list: ["Maple Ridge HOA"], blocked_addresses: [], instructions: ["Ask for the furnace or heat pump age if known."] },
    facts: { hours: "24/7 for no-heat and no-cooling emergencies", business_hours: businessHours, services: ["Furnace repair", "AC repair", "Heat pump service", "Maintenance plans"], service_area: "Denver metro", pricing_policy: "$89 diagnostic fee, credited to the repair.", payment_methods: ["Card", "Financing"] },
    doNotSay: [],
    slots: [{ field: "service_type", label: "Service", required: true }, { field: "address", label: "Address", required: true }, { field: "equipment_age", label: "Equipment age", required: false }],
    canned: ["We can get a technician out today. What's the best number to reach you?"],
    greetings: [
      ["en", "business_hours", "Thank you for calling {client_name}, this is {operator_first_name}. How can I help?"],
      ["en", "after_hours", "Thank you for calling {client_name}, this is {operator_first_name}. Are you without heat or cooling right now?"],
      ["es", "business_hours", "Gracias por llamar a {client_name}, habla {operator_first_name}. ¿Cómo le puedo ayudar?"],
      ["es", "after_hours", "Gracias por llamar a {client_name}, habla {operator_first_name}. ¿Está sin calefacción o aire acondicionado?"],
      ["en", "callback", "Hi, this is {operator_first_name} from {client_name}, returning your call."],
    ],
    transfers: [{ name: "Dana Ortiz", role: "Owner", e164: "+17205550189", priority: 1, onCall: true }],
    required: ["client_notes"],
  },
] as const;

async function upsertTenant(tx: DeskTx, client: (typeof clients)[number], now: Date) {
  const [existing] = await tx.rows<{ id: Buffer }>("SELECT id FROM tenants WHERE slug = ?", [client.slug]);
  const tenantId = existing?.id || newId("tnt").bytes;
  if (!existing) {
    await tx.run("INSERT INTO tenants (id, slug, display_name, brand_name, vertical, state, desk_mode, time_zone, created_at, updated_at) VALUES (?,?,?,?,?,'trial','managed',?,?,?)", [tenantId, client.slug, client.name, "EverOnn Trades", client.vertical, client.timeZone, now, now]);
  }
  await tx.run(
    `INSERT INTO client_desk_profiles (tenant_id, spoken_name, pronunciation, brand_color, authority_matrix, operator_notes, special_handling, business_facts, do_not_say, coverage, visible_fields, required_wrap_fields, playbook_slots, canned_replies, updated_at, updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'seed')
     ON DUPLICATE KEY UPDATE spoken_name = VALUES(spoken_name), pronunciation = VALUES(pronunciation), brand_color = VALUES(brand_color), authority_matrix = VALUES(authority_matrix),
       operator_notes = VALUES(operator_notes), special_handling = VALUES(special_handling), business_facts = VALUES(business_facts), do_not_say = VALUES(do_not_say), coverage = VALUES(coverage),
       visible_fields = VALUES(visible_fields), required_wrap_fields = VALUES(required_wrap_fields), playbook_slots = VALUES(playbook_slots), canned_replies = VALUES(canned_replies), updated_at = VALUES(updated_at), version = version + 1`,
    [tenantId, client.spoken, client.pronunciation, client.color, JSON.stringify(client.authority), client.notes, JSON.stringify(client.special), JSON.stringify(client.facts), JSON.stringify(client.doNotSay),
      JSON.stringify(allWeek), JSON.stringify(["service_type", "address", "vehicle", "safety_status", "callback_number", "preferred_time", "equipment_age"]), JSON.stringify(client.required),
      JSON.stringify(client.slots), JSON.stringify(client.canned), now],
  );
  for (const line of client.lines) {
    let numberId: Buffer | null = null;
    if ("e164" in line) {
      const [number] = await tx.rows<{ id: Buffer }>("SELECT id FROM phone_numbers WHERE e164 = ?", [line.e164]);
      numberId = number?.id || newId("num").bytes;
      if (!number) await tx.run("INSERT INTO phone_numbers (tenant_id, id, e164, carrier, capabilities, created_at) VALUES (?,?,?,?,?,?)", [tenantId, numberId, line.e164, "demo", JSON.stringify({ voice: line.kind === "voice", sms: line.kind === "sms" }), now]);
    }
    const [endpoint] = await tx.rows<{ id: Buffer }>(
      numberId ? "SELECT id FROM channel_endpoints WHERE tenant_id = ? AND phone_number_id = ? AND kind = ?" : "SELECT id FROM channel_endpoints WHERE tenant_id = ? AND widget_key = ?",
      numberId ? [tenantId, numberId, line.kind] : [tenantId, "widget" in line ? line.widget : null],
    );
    if (!endpoint) {
      await tx.run("INSERT INTO channel_endpoints (tenant_id, id, kind, label, phone_number_id, widget_key, hours_mode, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [tenantId, newId("lin").bytes, line.kind, line.label, numberId, "widget" in line ? line.widget : null, line.hours, now]);
    }
  }
  for (const [language, mode, body] of client.greetings) {
    const [current] = await tx.rows<{ body: string; script_version: number }>("SELECT body, script_version FROM greeting_scripts WHERE tenant_id = ? AND language = ? AND hours_mode = ? ORDER BY script_version DESC LIMIT 1", [tenantId, language, mode]);
    if (current?.body === body) continue;
    await tx.run("UPDATE greeting_scripts SET status = 'retired' WHERE tenant_id = ? AND language = ? AND hours_mode = ? AND status = 'approved'", [tenantId, language, mode]);
    await tx.run("INSERT INTO greeting_scripts (tenant_id, id, language, hours_mode, script_version, body, status, approved_by, approved_at, created_at) VALUES (?,?,?,?,?,?,'approved','seed: approved on client behalf',?,?)",
      [tenantId, newId("grt").bytes, language, mode, (current?.script_version || 0) + 1, body, now, now]);
  }
  const [contacts] = await tx.rows<{ count: number }>("SELECT COUNT(*) AS count FROM client_transfer_contacts WHERE tenant_id = ?", [tenantId]);
  if (!Number(contacts?.count)) {
    for (const contact of client.transfers) {
      await tx.run("INSERT INTO client_transfer_contacts (tenant_id, id, name, role_label, phone_e164, priority, on_call, created_at) VALUES (?,?,?,?,?,?,?,?)", [tenantId, newId("xfr").bytes, contact.name, contact.role, contact.e164, contact.priority, contact.onCall, now]);
    }
  }
  return tenantId;
}

async function upsertOperator(tx: DeskTx, orgId: Buffer, input: { email: string; name: string; role: "operator" | "operator_lead"; languages: string[] }, now: Date) {
  const [existing] = await tx.rows<{ id: Buffer }>("SELECT id FROM operators WHERE email = ?", [input.email]);
  if (existing) {
    await tx.run("UPDATE operators SET role = ?, languages = ?, status = 'active', updated_at = ?, version = version + 1 WHERE id = ?", [input.role, JSON.stringify(input.languages), now, existing.id]);
    return existing.id;
  }
  const id = newId("opr").bytes;
  await tx.run("INSERT INTO operators (id, org_id, email, display_name, first_name, role, languages, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, orgId, input.email, input.name, input.name.split(" ")[0], input.role, JSON.stringify(input.languages), now, now]);
  await tx.run("INSERT IGNORE INTO operator_presence (operator_id, status, status_since) VALUES (?, 'offline', ?)", [id, now]);
  return id;
}

async function grant(tx: DeskTx, operatorId: Buffer, tenantId: Buffer, grantedBy: Buffer, skills: string[], now: Date) {
  await tx.run(
    `INSERT INTO operator_client_grants (operator_id, tenant_id, skills, training_completed_at, certified_at, granted_by, granted_at) VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE skills = VALUES(skills), revoked_at = NULL, revoked_by = NULL, training_completed_at = COALESCE(training_completed_at, VALUES(training_completed_at)), certified_at = COALESCE(certified_at, VALUES(certified_at)), version = version + 1`,
    [operatorId, tenantId, JSON.stringify(skills), now, now, grantedBy, now],
  );
}

async function main() {
  const leadEmail = argument("lead-email").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(leadEmail)) throw new Error("Pass --lead-email with the email of an existing EverOnn sign-in.");
  const extra = argument("operator-email").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const summary = await withDeskTransaction(async (tx) => {
    const now = new Date();
    const [org] = await tx.rows<{ id: Buffer }>("SELECT id FROM operator_orgs WHERE name = 'EverOnn Operations'");
    const orgId = org?.id || newId("org").bytes;
    if (!org) await tx.run("INSERT INTO operator_orgs (id, name, kind, created_at) VALUES (?, 'EverOnn Operations', 'everonn', ?)", [orgId, now]);
    const tenantIds = [];
    for (const client of clients) tenantIds.push(await upsertTenant(tx, client, now));
    const lead = await upsertOperator(tx, orgId, { email: leadEmail, name: leadEmail.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()), role: "operator_lead", languages: ["en", "es"] }, now);
    for (const tenantId of tenantIds) await grant(tx, lead, tenantId, lead, ["en", "es"], now);
    const sam = await upsertOperator(tx, orgId, { email: "sam.operator@everonn.test", name: "Sam Rivera", role: "operator", languages: ["en"] }, now);
    const ana = await upsertOperator(tx, orgId, { email: "ana.operator@everonn.test", name: "Ana Morales", role: "operator", languages: ["en", "es"] }, now);
    await grant(tx, sam, tenantIds[0], lead, ["en", "locksmith"], now);
    await grant(tx, sam, tenantIds[1], lead, ["en", "plumbing"], now);
    await grant(tx, ana, tenantIds[1], lead, ["en", "es", "plumbing"], now);
    await grant(tx, ana, tenantIds[2], lead, ["en", "es", "hvac"], now);
    for (const email of extra) {
      const operator = await upsertOperator(tx, orgId, { email, name: email.split("@")[0], role: "operator", languages: ["en"] }, now);
      for (const tenantId of tenantIds) await grant(tx, operator, tenantId, lead, ["en"], now);
    }
    return { clients: clients.length, lead: leadEmail, operators: 3 + extra.length };
  });
  console.log(JSON.stringify(summary));
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => closeCallCenterPool());
