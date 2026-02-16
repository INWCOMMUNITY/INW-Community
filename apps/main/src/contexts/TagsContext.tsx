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
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {(children as any)}
    </TagsContext.Provider>
  );
}

export function useTags() {
  return useContext(TagsContext);
}
