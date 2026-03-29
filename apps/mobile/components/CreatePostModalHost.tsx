import { CreatePostModal } from "@/components/CreatePostModal";
import { useCreatePost } from "@/contexts/CreatePostContext";

/** Renders the global create/edit post modal; must be under CreatePostProvider. */
export function CreatePostModalHost() {
  const createPostCtx = useCreatePost();
  const createPostVisible = createPostCtx?.createPostVisible ?? false;
  const setCreatePostVisible = createPostCtx?.setCreatePostVisible ?? (() => {});
  const clearCreatePostState = () => {
    setCreatePostVisible(false);
    createPostCtx?.setInitialBusinessForPost(null);
    createPostCtx?.setInitialGroupIdForPost(null);
    createPostCtx?.setEditingPost(null);
  };
  return (
    <CreatePostModal
      visible={createPostVisible}
      onClose={clearCreatePostState}
      onSuccess={clearCreatePostState}
      initialBusinessForPost={createPostCtx?.initialBusinessForPost ?? undefined}
      initialGroupId={createPostCtx?.initialGroupIdForPost ?? null}
      editingPost={createPostCtx?.editingPost ?? null}
    />
  );
}
