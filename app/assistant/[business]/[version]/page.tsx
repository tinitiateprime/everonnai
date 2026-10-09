import { notFound } from "next/navigation";
import { readGeneratedSiteRecord } from "@/lib/site-store";
import { WebsiteAssistant } from "@/components/website-assistant";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ business: string; version: string }>;
  searchParams: Promise<{ revision?: string }>;
}) {
  const { business, version } = await params;
  const { revision } = await searchParams;
  const record = await readGeneratedSiteRecord(business, version);
  if (!record || revision !== record.artifact.id) notFound();
  return (
    <WebsiteAssistant
      business={business}
      version={version}
      revision={record.artifact.id}
      businessName={record.businessName || "this business"}
    />
  );
}
