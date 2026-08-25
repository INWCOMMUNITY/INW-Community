import { CommunityFeedPageClient } from "@/components/feed/CommunityFeedPageClient";
import { getServerSession } from "@/lib/auth";
import { loadCommunityFeed } from "@/lib/load-community-feed";
import { parseFeedFilterId, type CommunityFeedPost } from "@/lib/feed-types";

export default async function CommunityFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter = parseFeedFilterId(params.filter);
  const session = await getServerSession();
  const data = await loadCommunityFeed({
    viewerId: session?.user?.id ?? null,
    limit: 30,
    filter,
  });
  const initialPosts = JSON.parse(JSON.stringify(data.posts)) as CommunityFeedPost[];

  return (
    <CommunityFeedPageClient initialPosts={initialPosts} initialCursor={data.nextCursor} />
  );
}
