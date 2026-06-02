import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type WelcomeGalleryContextValue = {
  visible: boolean;
  openWelcome: () => void;
  closeWelcome: () => void;
};

const WelcomeGalleryContext = createContext<WelcomeGalleryContextValue | null>(null);

export function WelcomeGalleryProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const openWelcome = useCallback(() => setVisible(true), []);
  const closeWelcome = useCallback(() => setVisible(false), []);
  return (
    <WelcomeGalleryContext.Provider value={{ visible, openWelcome, closeWelcome }}>
      {children}
    </WelcomeGalleryContext.Provider>
  );
}

export function useWelcomeGallery(): WelcomeGalleryContextValue | null {
  return useContext(WelcomeGalleryContext);
}
