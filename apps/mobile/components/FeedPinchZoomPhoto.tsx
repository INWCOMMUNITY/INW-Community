import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  View,
  Image,
  StyleSheet,
  Platform,
  Pressable,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import type { MutableRefObject } from "react";
import { FeedPinchZoomGalleryPage } from "@/components/FeedPinchZoomGalleryPage";
import { Ionicons } from "@expo/vector-icons";
import {
  Gesture,
  GestureDetector,
  ScrollView as GHScrollView,
} from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MEANINGFUL_ZOOM = 1.06;
const MAX_SCALE = 5;
const PINCH_GESTURE_MIN_SCALE = 0.82;
const SNAP_MS = 220;
const LIFT_MS = 280;
const DOUBLE_TAP_PEAK = 2.25;
/** Springs feel smoother than linear timing for double-tap zoom. */
const DOUBLE_TAP_SPRING_IN = { damping: 17, stiffness: 220, mass: 0.92 };
const DOUBLE_TAP_SPRING_OUT = { damping: 20, stiffness: 185, mass: 0.95 };
/** Vertical drag distance before swipe-away commits (more deliberate than gallery default). */
const DISMISS_THRESHOLD = 220;
/** Close (X) offset from top of safe padded modal content. */
const MODAL_CLOSE_TOP = 52;
/** Extra pan range when zoomed so you can scroll further across the image edge-to-edge. */
const PAN_RANGE_MULTIPLIER = 1.22;

/**
 * Map a screen-space tap on the thumbnail (letterboxed contain) to offset from the modal image center.
 * Matches how `fittedW` / `fittedH` are computed for the fullscreen stage.
 */
function thumbTapToContentOffsetFromCenter(
  tapAbsX: number,
  tapAbsY: number,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  iw: number,
  ih: number,
  fittedW: number,
  fittedH: number
): { fx: number; fy: number } {
  const rx = tapAbsX - boxX;
  const ry = tapAbsY - boxY;
  const safeIw = iw > 0 ? iw : 1;
  const safeIh = ih > 0 ? ih : 1;
  const fit = Math.min(boxW / safeIw, boxH / safeIh);
  const ww = safeIw * fit;
  const wh = safeIh * fit;
  const ox = (boxW - ww) / 2;
  const oy = (boxH - wh) / 2;
  let px = rx - ox;
  let py = ry - oy;
  px = Math.max(0, Math.min(ww, px));
  py = Math.max(0, Math.min(wh, py));
  const cxThumb = px - ww / 2;
  const cyThumb = py - wh / 2;
  const fx = ww > 1e-6 ? (cxThumb / ww) * fittedW : 0;
  const fy = wh > 1e-6 ? (cyThumb / wh) * fittedH : 0;
  return { fx, fy };
}

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

function liftScaleWorklet(liftP: number, originLS: number): number {
  "worklet";
  return originLS + (1 - originLS) * liftP;
}

export type FeedGalleryPhotoEntry = {
  uri: string;
  intrinsicW: number;
  intrinsicH: number;
};

type FeedGalleryZoomSlotProps = {
  slotIdx: number;
  photo: FeedGalleryPhotoEntry;
  fittedW: number;
  fittedH: number;
  availW: number;
  availH: number;
  liftAnimTargetSlotSV: SharedValue<number>;
  liftProgress: SharedValue<number>;
  originLiftScale: SharedValue<number>;
  originLiftTX: SharedValue<number>;
  originLiftTY: SharedValue<number>;
  activeGalleryIndexSV: SharedValue<number>;
  galleryDismissScale: SharedValue<number>;
  galleryInteractionNonceSV: SharedValue<number>;
  isActive: boolean;
  onPagerLockedChange: (locked: boolean) => void;
  onPulseSnapComplete: () => void;
};

function FeedGalleryZoomSlot({
  slotIdx,
  photo,
  fittedW,
  fittedH,
  availW,
  availH,
  liftAnimTargetSlotSV,
  liftProgress,
  originLiftScale,
  originLiftTX,
  originLiftTY,
  activeGalleryIndexSV,
  galleryDismissScale,
  galleryInteractionNonceSV,
  isActive,
  onPagerLockedChange,
  onPulseSnapComplete,
}: FeedGalleryZoomSlotProps) {
  const liftShellStyle = useAnimatedStyle(() => {
    if (liftAnimTargetSlotSV.value !== slotIdx) {
      return {};
    }
    const ls = liftScaleWorklet(liftProgress.value, originLiftScale.value);
    const tx = interpolate(liftProgress.value, [0, 1], [originLiftTX.value, 0]);
    const ty = interpolate(liftProgress.value, [0, 1], [originLiftTY.value, 0]);
    return {
      transform: [{ translateX: tx }, { translateY: ty }, { scale: ls }],
    };
  });

  return (
    <View
      pointerEvents="box-none"
      style={{
        width: availW,
        height: availH,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Animated.View style={[styles.liftWrap, liftShellStyle]}>
        <FeedPinchZoomGalleryPage
          uri={photo.uri}
          fittedW={fittedW}
          fittedH={fittedH}
          availW={availW}
          availH={availH}
          slotIndex={slotIdx}
          isActive={isActive}
          activeGalleryIndexSV={activeGalleryIndexSV}
          galleryDismissScale={galleryDismissScale}
          resetNonceSV={galleryInteractionNonceSV}
          onPagerLockedChange={onPagerLockedChange}
          onPulseSnapComplete={onPulseSnapComplete}
        />
      </Animated.View>
    </View>
  );
}

export type FeedPinchZoomPhotoProps = {
  uri: string;
  thumbWidth: number;
  thumbHeight: number;
  intrinsicW: number;
  intrinsicH: number;
  onZoomSessionChange?: (active: boolean) => void;
  /** Multiple photos: horizontal pager inside zoom + glide-close to the visible thumbnail. */
  galleryPhotos?: FeedGalleryPhotoEntry[];
  /** Index within `galleryPhotos` for this thumbnail. */
  gallerySlotIndex?: number;
  /** Parallel to `galleryPhotos` — wrapper views for measureInWindow when closing. */
  galleryThumbWrapRefs?: MutableRefObject<(View | null)[]>;
  /** Fires when the user changes photo inside zoom (sync feed carousel). */
  onGalleryIndexChange?: (gallerySlotIndex: number) => void;
};

export function FeedPinchZoomPhoto({
  uri,
  thumbWidth,
  thumbHeight,
  intrinsicW,
  intrinsicH,
  onZoomSessionChange,
  galleryPhotos,
  gallerySlotIndex = 0,
  galleryThumbWrapRefs,
  onGalleryIndexChange,
}: FeedPinchZoomPhotoProps) {
  const { width: sw, height: sh } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [modalVisible, setModalVisible] = useState(false);
  const thumbRef = useRef<View>(null);
  const isClosingRef = useRef(false);
  const galleryMode = Boolean(galleryPhotos && galleryPhotos.length > 1);
  const galleryScrollRef = useRef<GHScrollView>(null);
  const [activeGalleryIndex, setActiveGalleryIndex] = useState(0);
  const activeGalleryIndexRef = useRef(0);
  const activeGalleryIndexSV = useSharedValue(0);
  const galleryDismissScale = useSharedValue(1);
  const liftAnimTargetSlotSV = useSharedValue(0);
  const galleryInteractionNonceSV = useSharedValue(0);
  const [galleryPagerLocked, setGalleryPagerLocked] = useState(false);

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const pinchBaseScale = useSharedValue(1);

  const panStartTX = useSharedValue(0);
  const panStartTY = useSharedValue(0);

  /** Vertical drag to dismiss (business gallery pattern). */
  const dismissY = useSharedValue(0);

  /** Interpolate from thumbnail letterbox → full stage (0 → 1). */
  const liftProgress = useSharedValue(0);
  /** Uniform scale at open: letterbox width / fitted stage width. */
  const originLiftScale = useSharedValue(1);
  /** Translate letterbox center → stage center (window coords delta). */
  const originLiftTX = useSharedValue(0);
  const originLiftTY = useSharedValue(0);

  const availW = sw;
  const availH = Math.max(1, sh - insets.top - insets.bottom);
  const stageCenterY = insets.top + availH / 2;

  const { fittedW, fittedH } = useMemo(() => {
    const iw = intrinsicW > 0 ? intrinsicW : thumbWidth;
    const ih = intrinsicH > 0 ? intrinsicH : thumbHeight;
    const fit = Math.min(availW / iw, availH / ih);
    return {
      fittedW: iw * fit,
      fittedH: ih * fit,
    };
  }, [intrinsicW, intrinsicH, thumbWidth, thumbHeight, availW, availH]);

  const fittedGallery = useMemo(() => {
    if (!galleryPhotos?.length) return [];
    return galleryPhotos.map((p) => {
      const iw = p.intrinsicW > 0 ? p.intrinsicW : thumbWidth;
      const ih = p.intrinsicH > 0 ? p.intrinsicH : thumbHeight;
      const fit = Math.min(availW / iw, availH / ih);
      return { fittedW: iw * fit, fittedH: ih * fit };
    });
  }, [galleryPhotos, availW, availH, thumbWidth, thumbHeight]);

  useEffect(() => {
    activeGalleryIndexRef.current = activeGalleryIndex;
  }, [activeGalleryIndex]);

  useEffect(() => {
    activeGalleryIndexSV.value = activeGalleryIndex;
  }, [activeGalleryIndex, activeGalleryIndexSV]);

  useEffect(() => {
    if (!galleryMode || !modalVisible) return;
    galleryDismissScale.value = 1;
  }, [activeGalleryIndex, galleryDismissScale, galleryMode, modalVisible]);

  const notifyActive = useCallback(
    (active: boolean) => {
      onZoomSessionChange?.(active);
    },
    [onZoomSessionChange]
  );

  const finishHideAfterGlide = useCallback(() => {
    isClosingRef.current = false;
    dismissY.value = 0;
    setModalVisible(false);
    notifyActive(false);
  }, [dismissY, notifyActive]);

  const applyMeasuredThumbWindow = useCallback(
    (boxX: number, boxY: number, boxW: number, boxH: number) => {
      const iw = intrinsicW > 0 ? intrinsicW : thumbWidth;
      const ih = intrinsicH > 0 ? intrinsicH : thumbHeight;
      const fit = Math.min(boxW / iw, boxH / ih);
      const ww = iw * fit;
      const wh = ih * fit;
      const ox = (boxW - ww) / 2;
      const oy = (boxH - wh) / 2;
      const wx = boxX + ox;
      const wy = boxY + oy;
      const cx = wx + ww / 2;
      const cy = wy + wh / 2;
      const fw = fittedW > 0 ? fittedW : ww;
      originLiftScale.value = Math.max(ww / fw, 1e-4);
      originLiftTX.value = cx - sw / 2;
      originLiftTY.value = cy - stageCenterY;
    },
    [
      intrinsicW,
      intrinsicH,
      thumbWidth,
      thumbHeight,
      fittedW,
      originLiftScale,
      originLiftTX,
      originLiftTY,
      sw,
      stageCenterY,
    ]
  );

  const applyMeasuredGallerySlot = useCallback(
    (slotIdx: number, boxX: number, boxY: number, boxW: number, boxH: number) => {
      const photo = galleryPhotos?.[slotIdx];
      const fitted = fittedGallery[slotIdx];
      if (!photo || !fitted) return;
      const iw = photo.intrinsicW > 0 ? photo.intrinsicW : thumbWidth;
      const ih = photo.intrinsicH > 0 ? photo.intrinsicH : thumbHeight;
      const fit = Math.min(boxW / iw, boxH / ih);
      const ww = iw * fit;
      const wh = ih * fit;
      const ox = (boxW - ww) / 2;
      const oy = (boxH - wh) / 2;
      const wx = boxX + ox;
      const wy = boxY + oy;
      const cx = wx + ww / 2;
      const cy = wy + wh / 2;
      const fw = fitted.fittedW > 0 ? fitted.fittedW : ww;
      originLiftScale.value = Math.max(ww / fw, 1e-4);
      originLiftTX.value = cx - sw / 2;
      originLiftTY.value = cy - stageCenterY;
    },
    [
      galleryPhotos,
      fittedGallery,
      thumbWidth,
      thumbHeight,
      originLiftScale,
      originLiftTX,
      originLiftTY,
      sw,
      stageCenterY,
    ]
  );

  /** Glide overlay image back to the thumbnail (reverse open), then unmount modal. */
  const glideCloseToThumbnail = useCallback(
    (skipPinchReset: boolean) => {
      if (!modalVisible || isClosingRef.current) return;
      isClosingRef.current = true;

      const runLiftDownInner = () => {
        const idx = activeGalleryIndexRef.current;
        const wrapEl =
          galleryMode && galleryThumbWrapRefs?.current?.[idx] != null
            ? galleryThumbWrapRefs.current[idx]
            : thumbRef.current;
        wrapEl?.measureInWindow((x, y, w, h) => {
          if (galleryMode && galleryPhotos?.length) {
            applyMeasuredGallerySlot(idx, x, y, w, h);
          } else {
            applyMeasuredThumbWindow(x, y, w, h);
          }
          liftProgress.value = withTiming(0, { duration: LIFT_MS }, (finished) => {
            if (finished) runOnJS(finishHideAfterGlide)();
          });
        });
      };

      const prepGalleryClose = () => {
        if (!galleryMode) return;
        galleryDismissScale.value = 1;
        liftAnimTargetSlotSV.value = activeGalleryIndexRef.current;
      };

      if (galleryMode) {
        prepGalleryClose();
        runLiftDownInner();
        return;
      }

      if (skipPinchReset) {
        runLiftDownInner();
        return;
      }

      runOnUI(() => {
        "worklet";
        const zoomed =
          scale.value > MEANINGFUL_ZOOM ||
          Math.abs(translateX.value) > 1 ||
          Math.abs(translateY.value) > 1;
        if (zoomed) {
          translateX.value = withTiming(0, { duration: SNAP_MS });
          translateY.value = withTiming(0, { duration: SNAP_MS });
          scale.value = withTiming(1, { duration: SNAP_MS }, (done) => {
            if (done) runOnJS(runLiftDownInner)();
          });
        } else {
          runOnJS(runLiftDownInner)();
        }
      })();
    },
    [
      modalVisible,
      galleryMode,
      galleryPhotos,
      galleryThumbWrapRefs,
      galleryDismissScale,
      liftAnimTargetSlotSV,
      applyMeasuredGallerySlot,
      applyMeasuredThumbWindow,
      liftProgress,
      scale,
      translateX,
      translateY,
      finishHideAfterGlide,
    ]
  );

  const handleRequestClose = useCallback(() => {
    glideCloseToThumbnail(false);
  }, [glideCloseToThumbnail]);

  const finishSnapBack = useCallback(() => {
    dismissY.value = 0;
    glideCloseToThumbnail(true);
  }, [dismissY, glideCloseToThumbnail]);

  /** Swipe-away dismiss (matches ImageGalleryViewer: fly off then hide). */
  const handleDismissSwipe = useCallback(() => {
    isClosingRef.current = false;
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    liftProgress.value = 0;
    setModalVisible(false);
    notifyActive(false);
    setTimeout(() => {
      dismissY.value = 0;
    }, 250);
  }, [dismissY, scale, translateX, translateY, liftProgress, notifyActive]);

  const runDoubleTapPulse = useCallback(
    (fx: number, fy: number) => {
      const peak = DOUBLE_TAP_PEAK;
      const tx = fx * (1 - peak);
      const ty = fy * (1 - peak);
      translateX.value = withSpring(tx, DOUBLE_TAP_SPRING_IN);
      translateY.value = withSpring(ty, DOUBLE_TAP_SPRING_IN);
      scale.value = withSpring(peak, DOUBLE_TAP_SPRING_IN, (fin) => {
        if (!fin) return;
        translateX.value = withSpring(0, DOUBLE_TAP_SPRING_OUT);
        translateY.value = withSpring(0, DOUBLE_TAP_SPRING_OUT);
        scale.value = withSpring(1, DOUBLE_TAP_SPRING_OUT, (done) => {
          if (done) runOnJS(finishSnapBack)();
        });
      });
    },
    [scale, translateX, translateY, finishSnapBack]
  );

  const onThumbnailDoubleTap = useCallback(
    (absoluteX: number, absoluteY: number) => {
      if (modalVisible || isClosingRef.current) return;
      thumbRef.current?.measureInWindow((x, y, w, h) => {
        applyMeasuredThumbWindow(x, y, w, h);
        const iw = intrinsicW > 0 ? intrinsicW : thumbWidth;
        const ih = intrinsicH > 0 ? intrinsicH : thumbHeight;
        const { fx, fy } = thumbTapToContentOffsetFromCenter(
          absoluteX,
          absoluteY,
          x,
          y,
          w,
          h,
          iw,
          ih,
          fittedW,
          fittedH
        );
        setModalVisible(true);
        notifyActive(true);
        // Run zoom after lift settles so focal offsets match the centered stage.
        if (!galleryMode) {
          setTimeout(() => runDoubleTapPulse(fx, fy), LIFT_MS);
        }
      });
    },
    [
      modalVisible,
      galleryMode,
      applyMeasuredThumbWindow,
      notifyActive,
      runDoubleTapPulse,
      intrinsicW,
      intrinsicH,
      thumbWidth,
      thumbHeight,
      fittedW,
      fittedH,
    ]
  );

  const openZoomFromSingleTap = useCallback(() => {
    if (modalVisible || isClosingRef.current) return;
    thumbRef.current?.measureInWindow((x, y, w, h) => {
      applyMeasuredThumbWindow(x, y, w, h);
      setModalVisible(true);
      notifyActive(true);
    });
  }, [modalVisible, applyMeasuredThumbWindow, notifyActive]);

  useEffect(() => {
    if (!modalVisible) {
      scale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      liftProgress.value = 0;
      dismissY.value = 0;
      isClosingRef.current = false;
      setGalleryPagerLocked(false);
      return;
    }

    dismissY.value = 0;

    if (galleryMode && galleryPhotos?.length) {
      liftProgress.value = 0;
      const idx = Math.min(Math.max(0, gallerySlotIndex), galleryPhotos.length - 1);
      activeGalleryIndexRef.current = idx;
      setActiveGalleryIndex(idx);
      activeGalleryIndexSV.value = idx;
      liftAnimTargetSlotSV.value = idx;
      galleryDismissScale.value = 1;
      galleryInteractionNonceSV.value += 1;
      scale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      queueMicrotask(() => {
        galleryScrollRef.current?.scrollTo({ x: idx * sw, animated: false });
      });
      liftProgress.value = withTiming(1, { duration: LIFT_MS });
      return;
    }

    liftProgress.value = 0;
    liftProgress.value = withTiming(1, { duration: LIFT_MS });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run open setup only when modal toggles on; `galleryPhotos` ref churn from parent was resetting the pager mid-session
  }, [modalVisible]);

  const thumbThumbnailGestures = useMemo(
    () =>
      Gesture.Exclusive(
        Gesture.Tap()
          .numberOfTaps(2)
          .onEnd((ev: { absoluteX: number; absoluteY: number }) => {
            runOnJS(onThumbnailDoubleTap)(ev.absoluteX, ev.absoluteY);
          }),
        Gesture.Tap()
          .numberOfTaps(1)
          .maxDistance(14)
          .onEnd(() => {
            runOnJS(openZoomFromSingleTap)();
          })
      ),
    [onThumbnailDoubleTap, openZoomFromSingleTap]
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
          const ls = liftScaleWorklet(liftProgress.value, originLiftScale.value);
          const effOld = ls * oldScale;
          const effNew = ls * newScale;
          const txLift = interpolate(liftProgress.value, [0, 1], [originLiftTX.value, 0]);
          const tyLift = interpolate(liftProgress.value, [0, 1], [originLiftTY.value, 0]);
          const fx = e.focalX - availW / 2 - txLift;
          const fy = e.focalY - availH / 2 - tyLift;
          translateX.value =
            fx + (translateX.value - fx) * (effNew / Math.max(effOld, 1e-6));
          translateY.value =
            fy + (translateY.value - fy) * (effNew / Math.max(effOld, 1e-6));
          scale.value = newScale;
        })
        .onEnd(() => {
          const ls = liftScaleWorklet(liftProgress.value, originLiftScale.value);
          const eff = ls * scale.value;
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
          const ls = liftScaleWorklet(liftProgress.value, originLiftScale.value);
          if (ls * scale.value > 1.03) {
            state.activate();
          } else {
            state.fail();
          }
        })
        .onStart(() => {
          panStartTX.value = translateX.value;
          panStartTY.value = translateY.value;
        })
        .onUpdate((ev) => {
          const ls = liftScaleWorklet(liftProgress.value, originLiftScale.value);
          const eff = ls * scale.value;
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
          const ls = liftScaleWorklet(liftProgress.value, originLiftScale.value);
          const eff = ls * scale.value;
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

  const dismissStartTouchX = useSharedValue(0);
  const dismissStartTouchY = useSharedValue(0);
  const dismissDecided = useSharedValue(false);

  const dismissPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((e) => {
          const t = e.allTouches[0];
          if (t) {
            dismissStartTouchX.value = t.absoluteX;
            dismissStartTouchY.value = t.absoluteY;
          }
          dismissDecided.value = false;
        })
        .onTouchesMove((e, state) => {
          const ls = liftScaleWorklet(liftProgress.value, originLiftScale.value);
          const zs = galleryMode ? galleryDismissScale.value : scale.value;
          if (ls * zs >= MEANINGFUL_ZOOM || e.allTouches.length > 1) {
            state.fail();
            return;
          }
          if (dismissDecided.value) return;
          const t = e.allTouches[0];
          if (!t) return;
          const dx = Math.abs(t.absoluteX - dismissStartTouchX.value);
          const dy = Math.abs(t.absoluteY - dismissStartTouchY.value);
          if (dx > 16 && dx > dy * 0.85) {
            dismissDecided.value = true;
            state.fail();
            return;
          }
          if (dy > 20 && dy > dx * 2.2) {
            dismissDecided.value = true;
            state.activate();
            return;
          }
          if (dx + dy > 36) {
            dismissDecided.value = true;
            state.fail();
          }
        })
        .onUpdate((ev) => {
          dismissY.value = ev.translationY;
        })
        .onEnd((ev) => {
          if (Math.abs(ev.translationY) > DISMISS_THRESHOLD) {
            dismissY.value = withTiming(
              ev.translationY > 0 ? sh : -sh,
              { duration: 200 }
            );
            runOnJS(handleDismissSwipe)();
          } else {
            dismissY.value = withTiming(0, { duration: 200 });
          }
        }),
    [sh, handleDismissSwipe, galleryMode, galleryDismissScale, scale]
  );

  const modalDoubleTapGesture = useMemo(
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
          const txLift = interpolate(liftProgress.value, [0, 1], [originLiftTX.value, 0]);
          const tyLift = interpolate(liftProgress.value, [0, 1], [originLiftTY.value, 0]);
          const fx = e.x - availW / 2 - txLift;
          const fy = e.y - availH / 2 - tyLift;
          const tx = fx * (1 - peak);
          const ty = fy * (1 - peak);
          translateX.value = withSpring(tx, DOUBLE_TAP_SPRING_IN);
          translateY.value = withSpring(ty, DOUBLE_TAP_SPRING_IN);
          scale.value = withSpring(peak, DOUBLE_TAP_SPRING_IN);
        }),
    [availW, availH]
  );

  const composedModalGesture = useMemo(
    () =>
      Gesture.Simultaneous(
        pinchGesture,
        panGesture,
        dismissPanGesture,
        modalDoubleTapGesture
      ),
    [pinchGesture, panGesture, dismissPanGesture, modalDoubleTapGesture]
  );

  const dismissDragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dismissY.value }],
  }));

  const liftAnimStyle = useAnimatedStyle(() => {
    const ls = liftScaleWorklet(liftProgress.value, originLiftScale.value);
    const tx = interpolate(liftProgress.value, [0, 1], [originLiftTX.value, 0]);
    const ty = interpolate(liftProgress.value, [0, 1], [originLiftTY.value, 0]);
    return {
      transform: [{ translateX: tx }, { translateY: ty }, { scale: ls }],
    };
  });

  const pinchPanAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const backdropAnimStyle = useAnimatedStyle(() => {
    const liftAlpha = interpolate(
      liftProgress.value,
      [0, 0.12, 0.45, 1],
      [0, 0.18, 0.52, 0.88],
      Extrapolation.CLAMP
    );
    const zs = galleryMode ? galleryDismissScale.value : scale.value;
    const pinchBoost = interpolate(
      zs,
      [1, MEANINGFUL_ZOOM, MAX_SCALE],
      [0, 0.06, 0.12],
      Extrapolation.CLAMP
    );
    const base = Math.min(1, liftAlpha + pinchBoost);
    const dismissFade = interpolate(
      Math.abs(dismissY.value),
      [0, DISMISS_THRESHOLD * 2],
      [1, 0.28],
      Extrapolation.CLAMP
    );
    return {
      opacity: base * dismissFade,
    };
  }, [galleryMode]);

  const handleGalleryMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!galleryPhotos?.length) return;
      const idx = Math.round(e.nativeEvent.contentOffset.x / sw);
      const clamped = Math.max(0, Math.min(idx, galleryPhotos.length - 1));
      setActiveGalleryIndex(clamped);
      liftAnimTargetSlotSV.value = clamped;
      onGalleryIndexChange?.(clamped);
    },
    [galleryPhotos, sw, onGalleryIndexChange, liftAnimTargetSlotSV]
  );

  const handleGalleryPulseSnapComplete = useCallback(() => {
    glideCloseToThumbnail(true);
  }, [glideCloseToThumbnail]);

  return (
    <>
      <View
        ref={thumbRef}
        style={{ width: thumbWidth, height: thumbHeight, backgroundColor: "#eee" }}
        collapsable={false}
      >
        <GestureDetector gesture={thumbThumbnailGestures}>
          <View style={{ width: thumbWidth, height: thumbHeight }}>
            <Image
              source={{ uri }}
              style={{ width: thumbWidth, height: thumbHeight }}
              resizeMode="contain"
            />
          </View>
        </GestureDetector>
      </View>

      <Modal
        visible={modalVisible}
        transparent
        animationType="none"
        presentationStyle="overFullScreen"
        statusBarTranslucent={Platform.OS === "android"}
        onRequestClose={handleRequestClose}
      >
        <View style={[styles.modalRoot, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss photo zoom"
            onPress={handleRequestClose}
            style={styles.modalBackdropPressable}
          >
            <Animated.View pointerEvents="none" style={[styles.modalBackdrop, backdropAnimStyle]} />
          </Pressable>
          {galleryMode && galleryPhotos ? (
            <GestureDetector gesture={dismissPanGesture}>
              <Animated.View
                pointerEvents="box-none"
                style={[styles.modalGestureLayer, dismissDragStyle]}
              >
                <GHScrollView
                  ref={galleryScrollRef}
                  horizontal
                  pagingEnabled
                  nestedScrollEnabled={Platform.OS === "android"}
                  scrollEnabled={!galleryPagerLocked}
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  onMomentumScrollEnd={handleGalleryMomentumEnd}
                  style={{ flex: 1 }}
                  contentContainerStyle={{ flexGrow: 1, minHeight: availH }}
                >
                  {galleryPhotos.map((photo, idx) => {
                    const fitted = fittedGallery[idx];
                    if (!fitted) return null;
                    return (
                      <View
                        key={`${photo.uri}-${idx}`}
                        pointerEvents="box-none"
                        style={{ width: sw, flex: 1, minHeight: availH }}
                        collapsable={false}
                      >
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Dismiss photo zoom"
                          onPress={handleRequestClose}
                          style={StyleSheet.absoluteFillObject}
                        />
                        <FeedGalleryZoomSlot
                          slotIdx={idx}
                          photo={photo}
                          fittedW={fitted.fittedW}
                          fittedH={fitted.fittedH}
                          availW={availW}
                          availH={availH}
                          liftAnimTargetSlotSV={liftAnimTargetSlotSV}
                          liftProgress={liftProgress}
                          originLiftScale={originLiftScale}
                          originLiftTX={originLiftTX}
                          originLiftTY={originLiftTY}
                          activeGalleryIndexSV={activeGalleryIndexSV}
                          galleryDismissScale={galleryDismissScale}
                          galleryInteractionNonceSV={galleryInteractionNonceSV}
                          isActive={activeGalleryIndex === idx}
                          onPagerLockedChange={setGalleryPagerLocked}
                          onPulseSnapComplete={handleGalleryPulseSnapComplete}
                        />
                      </View>
                    );
                  })}
                </GHScrollView>
              </Animated.View>
            </GestureDetector>
          ) : (
            <GestureDetector gesture={composedModalGesture}>
              <Animated.View
                pointerEvents="box-none"
                style={[styles.modalGestureLayer, dismissDragStyle]}
              >
                <View pointerEvents="box-none" style={styles.modalGestureInner}>
                  <Animated.View style={[styles.liftWrap, liftAnimStyle]}>
                    <Animated.View
                      style={[styles.imageFrame, { width: fittedW, height: fittedH }, pinchPanAnimStyle]}
                    >
                      <Image source={{ uri }} style={styles.overlayImage} resizeMode="contain" />
                    </Animated.View>
                  </Animated.View>
                </View>
              </Animated.View>
            </GestureDetector>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close photo zoom"
            onPress={handleRequestClose}
            style={({ pressed }) => [
              styles.modalCloseBtn,
              { top: MODAL_CLOSE_TOP, right: 14 },
              pressed && styles.modalCloseBtnPressed,
            ]}
          >
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "transparent",
  },
  modalCloseBtn: {
    position: "absolute",
    zIndex: 20,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(0,0,0,0.52)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseBtnPressed: {
    opacity: 0.82,
  },
  modalBackdropPressable: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  /** Full-screen layer: box-none so taps outside the photo hit the backdrop Pressable beneath. */
  modalGestureLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  modalGestureInner: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    pointerEvents: "box-none",
  },
  liftWrap: {
    justifyContent: "center",
    alignItems: "center",
  },
  imageFrame: {
    overflow: "visible",
  },
  overlayImage: {
    width: "100%",
    height: "100%",
  },
});
