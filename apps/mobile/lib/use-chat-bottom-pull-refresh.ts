import { useCallback, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

/**
 * When the user is at the bottom of the chat and pulls past the end (rubber-band),
 * run refresh — same gesture idea as pull-to-refresh but at the newest messages.
 * iOS: contentOffset.y exceeds max scroll when bouncing past the bottom.
 */
export function useChatBottomPullRefresh(
  runRefresh: () => void | Promise<void>,
  refreshing: boolean,
  thresholdPx = 56
): {
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle: number;
} {
  const armedRef = useRef(false);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      if (layoutMeasurement.height <= 0 || contentSize.height <= 0) return;

      const maxY = Math.max(0, contentSize.height - layoutMeasurement.height);
      // When content fits on screen (maxY === 0), iOS still reports positive contentOffset.y when bouncing past the bottom edge.
      const overscrollPastBottom = maxY <= 0 ? contentOffset.y : contentOffset.y - maxY;

      if (overscrollPastBottom <= 0) {
        armedRef.current = false;
      }

      if (overscrollPastBottom > thresholdPx && !refreshing) {
        if (!armedRef.current) {
          armedRef.current = true;
          void Promise.resolve(runRefresh());
        }
      }
    },
    [refreshing, runRefresh, thresholdPx]
  );

  return { onScroll, scrollEventThrottle: 16 };
}
