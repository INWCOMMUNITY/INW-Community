"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CommunityFeedPost,
  type FeedFilterId,
  fetchFeedPage,
  fetchNewPostCountSince,
} from "@/lib/feed-types";

const NEW_POSTS_POLL_MS = 20_000;

export function useCommunityFeed(
  activeFilter: FeedFilterId,
  signedIn: boolean,
  initial?: { initialPosts?: CommunityFeedPost[]; initialCursor?: string | null }
) {
  const [posts, setPosts] = useState<CommunityFeedPost[]>(initial?.initialPosts ?? []);
  const [loading, setLoading] = useState(!initial?.initialPosts);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(initial?.initialCursor ?? null);
  const [newPostCount, setNewPostCount] = useState(0);
  const newestPostTimestamp = useRef<string | null>(null);

  const load = useCallback(
    async (cursor?: string, filter?: FeedFilterId) => {
      return fetchFeedPage(cursor, filter ?? activeFilter);
    },
    [activeFilter]
  );

  const refetch = useCallback(async () => {
    setRefreshing(true);
    try {
      const { posts: p, nextCursor: c } = await load(undefined, activeFilter);
      setPosts(p);
      setNextCursor(c);
      setNewPostCount(0);
      if (p[0]?.createdAt) newestPostTimestamp.current = p[0].createdAt;
    } catch {
      setPosts([]);
      setNextCursor(null);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [load, activeFilter]);

  const resetAndLoad = useCallback(
    async (filter: FeedFilterId) => {
      setLoading(true);
      setPosts([]);
      setNextCursor(null);
      try {
        const { posts: p, nextCursor: c } = await load(undefined, filter);
        setPosts(p);
        setNextCursor(c);
        if (p[0]?.createdAt) newestPostTimestamp.current = p[0].createdAt;
      } catch {
        setPosts([]);
        setNextCursor(null);
      } finally {
        setLoading(false);
      }
    },
    [load]
  );

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { posts: more, nextCursor: c } = await load(nextCursor, activeFilter);
      setPosts((prev) => [...prev, ...more]);
      setNextCursor(c);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, load, activeFilter]);

  const skipFirstLoad = useRef(initial?.initialPosts !== undefined);

  useEffect(() => {
    if (skipFirstLoad.current) {
      skipFirstLoad.current = false;
      return;
    }
    void resetAndLoad(activeFilter);
  }, [activeFilter, resetAndLoad]);

  useEffect(() => {
    if (posts.length > 0 && posts[0].createdAt) {
      newestPostTimestamp.current = posts[0].createdAt;
    }
  }, [posts]);

  useEffect(() => {
    if (!signedIn) return;
    const poll = () => {
      const since = newestPostTimestamp.current;
      if (!since) return;
      if (document.visibilityState !== "visible") return;
      void fetchNewPostCountSince(since).then(setNewPostCount).catch(() => {});
    };
    const id = window.setInterval(poll, NEW_POSTS_POLL_MS);
    return () => window.clearInterval(id);
  }, [signedIn]);

  const updatePost = useCallback((postId: string, patch: Partial<CommunityFeedPost>) => {
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, ...patch } : p)));
  }, []);

  const removePost = useCallback((postId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }, []);

  const removePostsByAuthor = useCallback((authorId: string) => {
    setPosts((prev) => prev.filter((p) => p.author.id !== authorId));
  }, []);

  const prependPost = useCallback((post: CommunityFeedPost) => {
    setPosts((prev) => [post, ...prev]);
  }, []);

  return {
    posts,
    setPosts,
    loading,
    refreshing,
    loadingMore,
    nextCursor,
    newPostCount,
    setNewPostCount,
    refetch,
    resetAndLoad,
    loadMore,
    updatePost,
    removePost,
    removePostsByAuthor,
    prependPost,
  };
}
