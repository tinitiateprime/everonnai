import { PrivateWebsitePreview } from "@/components/preview/private-website-preview";

export default async function PreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PrivateWebsitePreview token={token} />;
}
