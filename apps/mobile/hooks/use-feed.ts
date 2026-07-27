import { useCallback } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
} from "@tanstack/react-query";
import type { FeedPost, FeedResponse } from "@/lib/feed-api";
import { toggleLike, deletePost as apiDeletePost } from "@/lib/feed-api";

type FeedPage = { posts: FeedPost[]; nextCursor: string | null };

/**
 * Wrapper around `useInfiniteQuery` for paginated feed endpoints.
 * `fetchFn(cursor)` should return `{ posts, nextCursor }`.
 */
export function useFeedQuery(
  queryKey: QueryKey,
  fetchFn: (cursor?: string) => Promise<FeedResponse>,
  options?: { enabled?: boolean }
) {
  return useInfiniteQuery<FeedPage, Error, InfiniteData<FeedPage>, QueryKey, string | undefined>({
    queryKey,
    queryFn: ({ pageParam }) => fetchFn(pageParam),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: options?.enabled,
    staleTime: 60_000,
  });
}

/** Flatten paginated feed data into a single array. */
export function flattenFeedPages(
  data: InfiniteData<FeedPage> | undefined
): FeedPost[] {
  if (!data) return [];
  return data.pages.flatMap((p) => p.posts);
}

// ─── Mutations ───

/**
 * Update a post in-place across all cached feed pages for the given query key.
 * Returns the previous data for rollback.
 */
function updatePostInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: QueryKey,
  postId: string,
  updater: (post: FeedPost) => FeedPost
): InfiniteData<FeedPage> | undefined {
  const prev = queryClient.getQueryData<InfiniteData<FeedPage>>(queryKey);
  if (prev) {
    queryClient.setQueryData<InfiniteData<FeedPage>>(queryKey, {
      ...prev,
      pages: prev.pages.map((page) => ({
        ...page,
        posts: page.posts.map((p) => (p.id === postId ? updater(p) : p)),
      })),
    });
  }
  return prev;
}

/**
 * Optimistic like toggle mutation.
 * Immediately flips liked/likeCount in the cache, rolls back on error.
 */
export function useLikeMutation(queryKey: QueryKey) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, reaction }: { postId: string; reaction?: string }) =>
      toggleLike(postId, reaction),
    onMutate: async ({ postId }: { postId: string; reaction?: string }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = updatePostInCache(queryClient, queryKey, postId, (p) => ({
        ...p,
        liked: !p.liked,
        likeCount: p.likeCount + (p.liked ? -1 : 1),
      }));
      return { prev };
    },
    onError: (_err, _postId, context) => {
      if (context?.prev) {
        queryClient.setQueryData(queryKey, context.prev);
      }
    },
    onSuccess: (data, { postId }) => {
      if (typeof data?.liked !== "boolean") return;
      updatePostInCache(queryClient, queryKey, postId, (p) =>
        p.liked === data.liked ? p : { ...p, liked: data.liked }
      );
    },
  });
}

/** Increment comment count for a post in the cache. */
export function useCommentCountIncrement(queryKey: QueryKey) {
  const queryClient = useQueryClient();

  return useCallback(
    (postId: string) => {
      updatePostInCache(queryClient, queryKey, postId, (p) => ({
        ...p,
        commentCount: p.commentCount + 1,
      }));
    },
    [queryClient, queryKey]
  );
}

/** Update share count for a post in the cache. */
export function useShareCountUpdate(queryKey: QueryKey) {
  const queryClient = useQueryClient();

  return useCallback(
    (postId: string, opts?: { recorded?: boolean; shareCount?: number }) => {
      updatePostInCache(queryClient, queryKey, postId, (p) => {
        const next =
          opts?.shareCount ?? (opts?.recorded ? p.shareCount + 1 : null);
        return next != null ? { ...p, shareCount: next } : p;
      });
    },
    [queryClient, queryKey]
  );
}

/** Delete post mutation. Removes the post from the cache optimistically. */
export function useDeletePostMutation(queryKey: QueryKey) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) => apiDeletePost(postId),
    onMutate: async (postId: string) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<InfiniteData<FeedPage>>(queryKey);
      if (prev) {
        queryClient.setQueryData<InfiniteData<FeedPage>>(queryKey, {
          ...prev,
          pages: prev.pages.map((page) => ({
            ...page,
            posts: page.posts.filter((p) => p.id !== postId),
          })),
        });
      }
      return { prev };
    },
    onError: (_err, _postId, context) => {
      if (context?.prev) {
        queryClient.setQueryData(queryKey, context.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

/** Remove all posts by a member from the cache (for block user). */
export function useRemovePostsByAuthor(queryKey: QueryKey) {
  const queryClient = useQueryClient();

  return useCallback(
    (memberId: string) => {
      const prev = queryClient.getQueryData<InfiniteData<FeedPage>>(queryKey);
      if (prev) {
        queryClient.setQueryData<InfiniteData<FeedPage>>(queryKey, {
          ...prev,
          pages: prev.pages.map((page) => ({
            ...page,
            posts: page.posts.filter((p) => p.author.id !== memberId),
          })),
        });
      }
    },
    [queryClient, queryKey]
  );
}
