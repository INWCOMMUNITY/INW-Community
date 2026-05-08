import { useEffect, useMemo, type MutableRefObject } from "react";
import { View, Image, StyleSheet, Platform } from "react-native";
import {
  Gesture,
  GestureDetector,
  type GestureType,
} from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

const MEANINGFUL_ZOOM = 1.06;
const MAX_SCALE = 5;
/** Lower bound during pinch only — avoids jitter while allowing smooth pinch-in. */
const PINCH_GESTURE_MIN_SCALE = 0.82;
const SNAP_MS = 220;
const DOUBLE_TAP_PEAK = 2.25;
const DOUBLE_TAP_SPRING_IN = { damping: 17, stiffness: 220, mass: 0.92 };
const DOUBLE_TAP_SPRING_OUT = { damping: 20, stiffness: 185, mass: 0.95 };
const PAN_RANGE_MULTIPLIER = 1.22;

function clampTranslationWorklet(
  effectiveScale: number,
  tx: number,
  ty: number,
  fittedW: number,
  fittedH: number,
  availW: number,
  availH: number
): { x: number; y: number } {
  "worklet";
  const halfW = (fittedW * effectiveScale) / 2;
  const halfH = (fittedH * effectiveScale) / 2;
  const maxTX = Math.max(0, halfW - availW / 2) * PAN_RANGE_MULTIPLIER;
  const maxTY = Math.max(0, halfH - availH / 2) * PAN_RANGE_MULTIPLIER;
  return {
    x: Math.min(maxTX, Math.max(-maxTX, tx)),
    y: Math.min(maxTY, Math.max(-maxTY, ty)),
  };
}

export type FeedPinchZoomGalleryPageProps = {
  uri: string;
  fittedW: number;
  fittedH: number;
  availW: number;
  availH: number;
  slotIndex: number;
  isActive: boolean;
  activeGalleryIndexSV: SharedValue<number>;
  galleryDismissScale: SharedValue<number>;
  /** Bumped from parent to reset pinch/pan before close glide. */
  resetNonceSV: SharedValue<number>;
  onPagerLockedChange: (locked: boolean) => void;
  onPulseSnapComplete: () => void;
  /** Single tap on the photo (when not zoomed) closes the gallery — backdrop taps alone miss the image area in multi-photo mode. */
  onTapToDismiss?: () => void;
  /** Registered on parent GHScrollView `simultaneousHandlers` so taps work inside the horizontal pager. */
  scrollSimultaneousRef: MutableRefObject<GestureType | undefined>;
};

export function FeedPinchZoomGalleryPage({
  uri,
  fittedW,
  fittedH,
  availW,
  availH,
  slotIndex,
  isActive,
  activeGalleryIndexSV,
  galleryDismissScale,
  resetNonceSV,
  onPagerLockedChange,
  onPulseSnapComplete,
  onTapToDismiss,
  scrollSimultaneousRef,
}: FeedPinchZoomGalleryPageProps) {
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const pinchBaseScale = useSharedValue(1);
  const panStartTX = useSharedValue(0);
  const panStartTY = useSharedValue(0);
  const prevResetNonce = useSharedValue(0);

  useAnimatedReaction(
    () => resetNonceSV.value,
    (n) => {
      if (n !== prevResetNonce.value && n > 0) {
        prevResetNonce.value = n;
        scale.value = 1;
        translateX.value = 0;
        translateY.value = 0;
      }
    }
  );

  useEffect(() => {
    if (!isActive) {
      scale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
    }
  }, [isActive, scale, translateX, translateY]);

  useAnimatedReaction(
    () => ({
      s: scale.value,
      active: activeGalleryIndexSV.value === slotIndex,
    }),
    (curr, prev) => {
      if (!curr.active) return;
      galleryDismissScale.value = curr.s;
      const locked = curr.s >= MEANINGFUL_ZOOM;
      if (prev === null) {
        runOnJS(onPagerLockedChange)(locked);
        return;
      }
      const prevLocked = prev.s >= MEANINGFUL_ZOOM;
      if (locked !== prevLocked) runOnJS(onPagerLockedChange)(locked);
    },
    []
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          pinchBaseScale.value = scale.value;
        })
        .onUpdate((e) => {
          const oldScale = scale.value;
          const newScale = Math.min(
            MAX_SCALE,
            Math.max(PINCH_GESTURE_MIN_SCALE, pinchBaseScale.value * e.scale)
          );
          // Pinch focal is in the gesture view's coords (fitted letterbox), not full page.
          const fx = e.focalX - fittedW / 2;
          const fy = e.focalY - fittedH / 2;
          translateX.value =
            fx + (translateX.value - fx) * (newScale / Math.max(oldScale, 1e-6));
          translateY.value =
            fy + (translateY.value - fy) * (newScale / Math.max(oldScale, 1e-6));
          scale.value = newScale;
        })
        .onEnd(() => {
          const eff = scale.value;
          if (scale.value < MEANINGFUL_ZOOM) {
            scale.value = withTiming(1, { duration: SNAP_MS });
            translateX.value = withTiming(0, { duration: SNAP_MS });
            translateY.value = withTiming(0, { duration: SNAP_MS });
          } else {
            const c = clampTranslationWorklet(
              eff,
              translateX.value,
              translateY.value,
              fittedW,
              fittedH,
              availW,
              availH
            );
            translateX.value = c.x;
            translateY.value = c.y;
          }
        }),
    [availW, availH, fittedW, fittedH]
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .averageTouches(Platform.OS === "android")
        .manualActivation(true)
        .onTouchesMove((_e, state) => {
          if (scale.value > 1.03) state.activate();
          else state.fail();
        })
        .onStart(() => {
          panStartTX.value = translateX.value;
          panStartTY.value = translateY.value;
        })
        .onUpdate((ev) => {
          const eff = scale.value;
          translateX.value = panStartTX.value + ev.translationX;
          translateY.value = panStartTY.value + ev.translationY;
          const c = clampTranslationWorklet(
            eff,
            translateX.value,
            translateY.value,
            fittedW,
            fittedH,
            availW,
            availH
          );
          translateX.value = c.x;
          translateY.value = c.y;
        })
        .onEnd(() => {
          const eff = scale.value;
          const c = clampTranslationWorklet(
            eff,
            translateX.value,
            translateY.value,
            fittedW,
            fittedH,
            availW,
            availH
          );
          translateX.value = c.x;
          translateY.value = c.y;
        }),
    [availW, availH, fittedW, fittedH]
  );

  const doubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDistance(22)
        .onEnd((e: { x: number; y: number }) => {
          if (scale.value > MEANINGFUL_ZOOM) {
            translateX.value = withSpring(0, DOUBLE_TAP_SPRING_OUT);
            translateY.value = withSpring(0, DOUBLE_TAP_SPRING_OUT);
            scale.value = withSpring(1, DOUBLE_TAP_SPRING_OUT);
            return;
          }
          const peak = DOUBLE_TAP_PEAK;
          const fx = e.x - fittedW / 2;
          const fy = e.y - fittedH / 2;
          const tx = fx * (1 - peak);
          const ty = fy * (1 - peak);
          translateX.value = withSpring(tx, DOUBLE_TAP_SPRING_IN);
          translateY.value = withSpring(ty, DOUBLE_TAP_SPRING_IN);
          scale.value = withSpring(peak, DOUBLE_TAP_SPRING_IN, (fin) => {
            if (!fin) return;
            translateX.value = withSpring(0, DOUBLE_TAP_SPRING_OUT);
            translateY.value = withSpring(0, DOUBLE_TAP_SPRING_OUT);
            scale.value = withSpring(1, DOUBLE_TAP_SPRING_OUT, (done) => {
              if (done) runOnJS(onPulseSnapComplete)();
            });
          });
        }),
    [fittedW, fittedH, onPulseSnapComplete]
  );

  const singleTapDismissGesture = useMemo(() => {
    if (!onTapToDismiss) return null;
    return Gesture.Tap()
      .numberOfTaps(1)
      .maxDistance(22)
      .withRef(scrollSimultaneousRef)
      .onEnd((_e, success) => {
        if (!success || scale.value >= MEANINGFUL_ZOOM) return;
        runOnJS(onTapToDismiss)();
      });
  }, [onTapToDismiss, scrollSimultaneousRef]);

  const zoomTapGroup = useMemo(() => {
    if (singleTapDismissGesture) {
      return Gesture.Exclusive(doubleTapGesture, singleTapDismissGesture);
    }
    return doubleTapGesture;
  }, [doubleTapGesture, singleTapDismissGesture]);

  const composed = useMemo(
    () => Gesture.Simultaneous(pinchGesture, panGesture, zoomTapGroup),
    [pinchGesture, panGesture, zoomTapGroup]
  );

  const pinchPanStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View pointerEvents="box-none" style={[styles.page, { width: availW, height: availH }]}>
      <GestureDetector gesture={composed}>
        <Animated.View
          style={[styles.liftWrap, { width: fittedW, height: fittedH }, pinchPanStyle]}
        >
          <Image source={{ uri }} style={styles.image} resizeMode="contain" />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    justifyContent: "center",
    alignItems: "center",
  },
  liftWrap: {
    overflow: "visible",
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
