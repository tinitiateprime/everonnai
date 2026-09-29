import { PublishedSite, publishedMetadata } from "../site";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; path: string[] }> }) {
  const { slug, path } = await params;
  return publishedMetadata(slug, path);
}

export default async function PublishedWebsiteSubpage({ params }: { params: Promise<{ slug: string; path: string[] }> }) {
  const { slug, path } = await params;
  return <PublishedSite slug={slug} route={path} />;
}
