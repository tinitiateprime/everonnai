import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/features/auth/session";
import { callCenterDatabaseConfigured, withDeskConnection } from "@/lib/call-center-mysql";
import { resolveOperator } from "@/features/call-center/server/operators";
import { LiveAgentDesk } from "@/components/call-center/live-agent-desk";
import "../dashboard/dashboard.css";
import "./desk.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Live Agent Desk | EverOnnAI", robots: { index: false, follow: false } };

function DeskNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className="desk-boot"><section className="eo-panel"><span className="eo-brand-mark">∞</span><h1>{title}</h1>{children}<Link className="eo-secondary-button" href="/dashboard">Back to dashboard</Link></section></main>;
}

export default async function DeskPage() {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login?returnTo=/desk");
  if (!callCenterDatabaseConfigured()) {
    return <DeskNotice title="The Live Agent Desk is not set up"><p>Set <code>CALL_CENTER_DATABASE_URL</code> to a MySQL 8 database, then run <code>npm run call-center:db:migrate</code>.</p></DeskNotice>;
  }
  let operator: Awaited<ReturnType<typeof resolveOperator>> = null;
  try {
    operator = await withDeskConnection((tx) => resolveOperator(tx, actor));
  } catch {
    return <DeskNotice title="The Live Agent Desk is unavailable"><p>The call center database could not be reached. Try again shortly.</p></DeskNotice>;
  }
  if (!operator) {
    return <DeskNotice title="You are not an EverOnn operator"><p>The desk is for EverOnn operators. Ask an operator lead to add <b>{actor.email}</b> to the operator roster.</p></DeskNotice>;
  }
  // A fresh id per page load identifies this window as the single desk session.
  return <LiveAgentDesk session={randomUUID()} isLead={operator.role === "operator_lead"} />;
}
