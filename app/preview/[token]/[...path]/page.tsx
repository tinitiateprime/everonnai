import { PrivateWebsitePreview } from "@/components/preview/private-website-preview";

export const dynamic = "force-dynamic";

export default async function PreviewSubpage({ params }: { params: Promise<{ token: string; path: string[] }> }) {
  const { token, path } = await params;
  return <PrivateWebsitePreview token={token} route={path} />;
}
