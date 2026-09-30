import { EverOnnDashboard } from "@/components/dashboard/everonn-dashboard";
import { getCurrentActor } from "@/features/auth/session";
import { redirect } from "next/navigation";

export default async function DashboardPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login?returnTo=/dashboard");
  const { section } = await params;
  return <EverOnnDashboard initialSection={section?.[0] || "overview"} actor={actor} />;
}
