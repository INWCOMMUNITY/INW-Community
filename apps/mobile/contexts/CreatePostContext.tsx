import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { FeedPost } from "@/lib/feed-api";

export type CreatePostBusiness = { id: string; name: string };

type CreatePostContextValue = {
  openCreatePost: () => void;
  /** Open create post modal pre-set to post as this business (Business Post). */
  openCreatePostAsBusiness: (business: CreatePostBusiness) => void;
  /** Open modal to edit the user's own post (author checked in UI before calling). */
  openEditPost: (post: FeedPost) => void;
  createPostVisible: boolean;
  setCreatePostVisible: (v: boolean) => void;
  /** When set, the create post modal should post as this business. Cleared when modal closes. */
  initialBusinessForPost: CreatePostBusiness | null;
  setInitialBusinessForPost: (b: CreatePostBusiness | null) => void;
  editingPost: FeedPost | null;
  setEditingPost: (p: FeedPost | null) => void;
};

const CreatePostContext = createContext<CreatePostContextValue | null>(null);

export function CreatePostProvider({ children }: { children: ReactNode }) {
  const [createPostVisible, setCreatePostVisible] = useState(false);
  const [initialBusinessForPost, setInitialBusinessForPost] = useState<CreatePostBusiness | null>(null);
  const [editingPost, setEditingPost] = useState<FeedPost | null>(null);
  const openCreatePost = useCallback(() => {
    setEditingPost(null);
    setInitialBusinessForPost(null);
    setCreatePostVisible(true);
  }, []);
  const openCreatePostAsBusiness = useCallback((business: CreatePostBusiness) => {
    setEditingPost(null);
    setInitialBusinessForPost(business);
    setCreatePostVisible(true);
  }, []);
  const openEditPost = useCallback((post: FeedPost) => {
    setEditingPost(post);
    if (post.type === "shared_business" && post.sourceBusiness) {
      setInitialBusinessForPost({ id: post.sourceBusiness.id, name: post.sourceBusiness.name });
    } else {
      setInitialBusinessForPost(null);
    }
    setCreatePostVisible(true);
  }, []);
  return (
    <CreatePostContext.Provider
      value={{
        openCreatePost,
        openCreatePostAsBusiness,
        openEditPost,
        createPostVisible,
        setCreatePostVisible,
        initialBusinessForPost,
        setInitialBusinessForPost,
        editingPost,
        setEditingPost,
      }}
    >
      {children}
    </CreatePostContext.Provider>
  );
}

export function useCreatePost() {
  const ctx = useContext(CreatePostContext);
  if (!ctx) return null;
  return ctx;
}
