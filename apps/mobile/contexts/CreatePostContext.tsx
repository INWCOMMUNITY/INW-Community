import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type CreatePostContextValue = {
  openCreatePost: () => void;
  createPostVisible: boolean;
  setCreatePostVisible: (v: boolean) => void;
};

const CreatePostContext = createContext<CreatePostContextValue | null>(null);

export function CreatePostProvider({ children }: { children: ReactNode }) {
  const [createPostVisible, setCreatePostVisible] = useState(false);
  const openCreatePost = useCallback(() => setCreatePostVisible(true), []);
  return (
    <CreatePostContext.Provider
      value={{ openCreatePost, createPostVisible, setCreatePostVisible }}
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
