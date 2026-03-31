import { useCallback, useEffect, useState } from "react";
import { Keyboard, Platform, type FlatList } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

/**
 * Scrolls the message list to the newest items when the screen is focused and data is ready,
 * and again when the software keyboard opens so the latest messages stay visible above the composer.
 */
export function useChatScrollToLatest(
  flatListRef: React.RefObject<FlatList | null>,
  opts: {
    conversationId: string | undefined;
    /** True when the FlatList is mounted with data (e.g. !!conv && !loading). */
    ready: boolean;
  }
): void {
  const { conversationId, ready } = opts;
  const [focusEpoch, setFocusEpoch] = useState(0);

  const scrollToLatest = useCallback(
    (animated: boolean) => {
      flatListRef.current?.scrollToEnd({ animated });
    },
    [flatListRef]
  );

  useFocusEffect(
    useCallback(() => {
      setFocusEpoch((e) => e + 1);
    }, [conversationId])
  );

  useEffect(() => {
    if (!conversationId || !ready || focusEpoch === 0) return;
    const run = () => scrollToLatest(false);
    run();
    const raf = requestAnimationFrame(run);
    const t1 = setTimeout(run, 80);
    const t2 = setTimeout(run, 280);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [conversationId, ready, focusEpoch, scrollToLatest]);

  useEffect(() => {
    const eventName = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const sub = Keyboard.addListener(eventName, () => {
      requestAnimationFrame(() => {
        scrollToLatest(true);
      });
    });
    return () => sub.remove();
  }, [scrollToLatest]);
}
