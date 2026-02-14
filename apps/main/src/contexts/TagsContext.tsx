"use client";

import { createContext, useContext, useState } from "react";

interface TagsContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const TagsContext = createContext<TagsContextValue>({
  open: false,
  setOpen: () => {},
});

export function TagsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <TagsContext.Provider value={{ open, setOpen }}>
      {children}
    </TagsContext.Provider>
  );
}

export function useTags() {
  return useContext(TagsContext);
}
