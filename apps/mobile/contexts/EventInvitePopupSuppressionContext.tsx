import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Suppresses the global event-invite popup while e.g. checkout or a form modal is active.
 */
const EventInvitePopupSuppressionContext = createContext<{
  formOrModalOpenCount: number;
  incrementSuppression: () => void;
  decrementSuppression: () => void;
} | null>(null);

export function EventInvitePopupSuppressionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [formOrModalOpenCount, setCount] = useState(0);
  const incrementSuppression = useCallback(() => {
    setCount((c) => c + 1);
  }, []);
  const decrementSuppression = useCallback(() => {
    setCount((c) => Math.max(0, c - 1));
  }, []);
  const value = useMemo(
    () => ({
      formOrModalOpenCount,
      incrementSuppression,
      decrementSuppression,
    }),
    [formOrModalOpenCount, incrementSuppression, decrementSuppression]
  );
  return (
    <EventInvitePopupSuppressionContext.Provider value={value}>
      {children}
    </EventInvitePopupSuppressionContext.Provider>
  );
}

export function useEventInvitePopupSuppression() {
  const ctx = useContext(EventInvitePopupSuppressionContext);
  if (!ctx) {
    return {
      formOrModalOpenCount: 0,
      incrementSuppression: () => {},
      decrementSuppression: () => {},
    };
  }
  return ctx;
}
