import { useEffect } from "react";
import { CreatePostModal } from "@/components/CreatePostModal";
import { useCreatePost } from "@/contexts/CreatePostContext";
import { setShareListingsToFeedOpener } from "@/lib/prompt-share-listings-to-feed";

/** Renders the global create/edit post modal; must be under CreatePostProvider. */
export function CreatePostModalHost() {
  const createPostCtx = useCreatePost();
  const createPostVisible = createPostCtx?.createPostVisible ?? false;
  const setCreatePostVisible = createPostCtx?.setCreatePostVisible ?? (() => {});
  const openShareListingsToFeed = createPostCtx?.openShareListingsToFeed;

  useEffect(() => {
    if (!openShareListingsToFeed) {
      setShareListingsToFeedOpener(null);
      return;
    }
    setShareListingsToFeedOpener(openShareListingsToFeed);
    return () => setShareListingsToFeedOpener(null);
  }, [openShareListingsToFeed]);

  const clearCreatePostState = () => {
    setCreatePostVisible(false);
    createPostCtx?.setInitialBusinessForPost(null);
    createPostCtx?.setInitialGroupIdForPost(null);
    createPostCtx?.setGroupAllowsBusinessPostsForPost(false);
    createPostCtx?.setEditingPost(null);
    createPostCtx?.setSharedStoreItemIdsForPost(null);
  };
  const inGroup = Boolean(createPostCtx?.initialGroupIdForPost);
  const allowBizInGroup = inGroup
    ? !!createPostCtx?.groupAllowsBusinessPostsForPost
    : true;

  return (
    <CreatePostModal
      visible={createPostVisible}
      onClose={clearCreatePostState}
      onSuccess={clearCreatePostState}
      initialBusinessForPost={createPostCtx?.initialBusinessForPost ?? undefined}
      initialGroupId={createPostCtx?.initialGroupIdForPost ?? null}
      allowBusinessPostsInGroup={allowBizInGroup}
      editingPost={createPostCtx?.editingPost ?? null}
      sharedStoreItemIds={createPostCtx?.sharedStoreItemIdsForPost ?? null}
    />
  );
}
