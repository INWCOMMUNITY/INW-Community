import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type CreatePostBusiness = { id: string; name: string };

type CreatePostContextValue = {
  openCreatePost: () => void;
  /** Open create post modal pre-set to post as this business (Business Post). */
  openCreatePostAsBusiness: (business: CreatePostBusiness) => void;
  createPostVisible: boolean;
  setCreatePostVisible: (v: boolean) => void;
  /** When set, the create post modal should post as this business. Cleared when modal closes. */
  initialBusinessForPost: CreatePostBusiness | null;
  setInitialBusinessForPost: (b: CreatePostBusiness | null) => void;
};

const CreatePostContext = createContext<CreatePostContextValue | null>(null);

export function CreatePostProvider({ children }: { children: ReactNode }) {
  const [createPostVisible, setCreatePostVisible] = useState(false);
  const [initialBusinessForPost, setInitialBusinessForPost] = useState<CreatePostBusiness | null>(null);
  const openCreatePost = useCallback(() => {
    setInitialBusinessForPost(null);
    setCreatePostVisible(true);
  }, []);
  const openCreatePostAsBusiness = useCallback((business: CreatePostBusiness) => {
    setInitialBusinessForPost(business);
    setCreatePostVisible(true);
  }, []);
  return (
    <CreatePostContext.Provider
      value={{
        openCreatePost,
        openCreatePostAsBusiness,
        createPostVisible,
        setCreatePostVisible,
        initialBusinessForPost,
        setInitialBusinessForPost,
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
