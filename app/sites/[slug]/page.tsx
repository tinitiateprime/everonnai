import { PublishedSite, publishedMetadata } from "./site";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return publishedMetadata(slug, []);
}

export default async function PublishedWebsitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublishedSite slug={slug} />;
}
