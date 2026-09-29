import { EverOnnDashboard } from "@/components/dashboard/everonn-dashboard";

export default async function DashboardPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  return <EverOnnDashboard initialSection={section?.[0] || "overview"} />;
}
