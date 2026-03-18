import { useState, useRef, useCallback } from "react";
import {
  Modal,
  View,
  Image,
  Pressable,
  StyleSheet,
  Dimensions,
  Text,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GestureDetector, Gesture, GestureHandlerRootView, FlatList } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  runOnJS,
  type SharedValue,
} from "react-native-reanimated";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const ZOOM_LOCK_THRESHOLD = 1.4;
const DISMISS_THRESHOLD = 120;

interface ZoomableImageProps {
  uri: string;
  onZoomChange: (zoomed: boolean) => void;
  onDismiss: () => void;
  dismissY: SharedValue<number>;
}

function ZoomableImage({ uri, onZoomChange, onDismiss, dismissY }: ZoomableImageProps) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const notifyZoom = useCallback(
    (zoomed: boolean) => onZoomChange(zoomed),
    [onZoomChange],
  );

  const resetPosition = useCallback(() => {
    "worklet";
    scale.value = withTiming(1, { duration: 200 });
    savedScale.value = 1;
    translateX.value = withTiming(0, { duration: 200 });
    translateY.value = withTiming(0, { duration: 200 });
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    runOnJS(notifyZoom)(false);
  }, [scale, savedScale, translateX, translateY, savedTranslateX, savedTranslateY, notifyZoom]);

  const clampTranslation = useCallback(() => {
    "worklet";
    const s = scale.value;
    if (s <= 1) {
      translateX.value = withTiming(0, { duration: 150 });
      translateY.value = withTiming(0, { duration: 150 });
      savedTranslateX.value = 0;
      savedTranslateY.value = 0;
      return;
    }
    const maxX = ((s - 1) * SCREEN_WIDTH) / 2;
    const maxY = ((s - 1) * SCREEN_HEIGHT * 0.4) / 2;
    const clampedX = Math.max(-maxX, Math.min(maxX, translateX.value));
    const clampedY = Math.max(-maxY, Math.min(maxY, translateY.value));
    translateX.value = withTiming(clampedX, { duration: 150 });
    translateY.value = withTiming(clampedY, { duration: 150 });
    savedTranslateX.value = clampedX;
    savedTranslateY.value = clampedY;
  }, [scale, translateX, translateY, savedTranslateX, savedTranslateY]);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const newScale = savedScale.value * e.scale;
      scale.value = Math.max(MIN_SCALE * 0.5, Math.min(MAX_SCALE, newScale));
    })
    .onEnd(() => {
      if (scale.value < ZOOM_LOCK_THRESHOLD) {
        resetPosition();
      } else {
        savedScale.value = scale.value;
        runOnJS(notifyZoom)(true);
        clampTranslation();
      }
    });

  // Pan for moving around when zoomed
  const zoomPanGesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_e, state) => {
      if (savedScale.value >= ZOOM_LOCK_THRESHOLD) {
        state.activate();
      } else {
        state.fail();
      }
    })
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      clampTranslation();
    });

  // Vertical drag to dismiss when not zoomed
  const startTouchY = useSharedValue(0);
  const startTouchX = useSharedValue(0);
  const dismissDecided = useSharedValue(false);

  const dismissPanGesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => {
      const t = e.allTouches[0];
      if (t) {
        startTouchX.value = t.absoluteX;
        startTouchY.value = t.absoluteY;
      }
      dismissDecided.value = false;
    })
    .onTouchesMove((e, state) => {
      if (savedScale.value >= ZOOM_LOCK_THRESHOLD || e.allTouches.length > 1) {
        state.fail();
        return;
      }
      if (dismissDecided.value) return;
      const t = e.allTouches[0];
      if (!t) return;
      const dx = Math.abs(t.absoluteX - startTouchX.value);
      const dy = Math.abs(t.absoluteY - startTouchY.value);

      // Fail fast on any horizontal movement so FlatList swipe isn't blocked
      if (dx > 8) {
        dismissDecided.value = true;
        state.fail();
        return;
      }
      // Only activate dismiss for clearly vertical drags (dy must dominate)
      if (dy > 20 && dy > dx * 2.5) {
        dismissDecided.value = true;
        state.activate();
        return;
      }
      // If total movement is large but no clear direction, fail
      if (dx + dy > 30) {
        dismissDecided.value = true;
        state.fail();
      }
    })
    .onUpdate((e) => {
      dismissY.value = e.translationY;
    })
    .onEnd((e) => {
      if (Math.abs(e.translationY) > DISMISS_THRESHOLD) {
        dismissY.value = withTiming(
          e.translationY > 0 ? SCREEN_HEIGHT : -SCREEN_HEIGHT,
          { duration: 200 },
        );
        runOnJS(onDismiss)();
      } else {
        dismissY.value = withTiming(0, { duration: 200 });
      }
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (scale.value > 1) {
        resetPosition();
      } else {
        const targetScale = 3;
        scale.value = withTiming(targetScale, { duration: 250 });
        savedScale.value = targetScale;

        const focalX = e.x - SCREEN_WIDTH / 2;
        const focalY = e.y - SCREEN_HEIGHT / 2;
        const newX = -focalX * (targetScale - 1) / targetScale;
        const newY = -focalY * (targetScale - 1) / targetScale;
        translateX.value = withTiming(newX, { duration: 250 });
        translateY.value = withTiming(newY, { duration: 250 });
        savedTranslateX.value = newX;
        savedTranslateY.value = newY;
        runOnJS(notifyZoom)(true);
      }
    });

  const composed = Gesture.Simultaneous(
    pinchGesture,
    zoomPanGesture,
    dismissPanGesture,
    doubleTapGesture,
  );

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const dismissStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dismissY.value }],
  }));

  return (
    <View style={styles.slide}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.slideInner, dismissStyle]}>
          <Animated.View style={[styles.imageWrap, zoomStyle]}>
            <Image
              source={{ uri }}
              style={styles.image}
              resizeMode="contain"
            />
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

interface ImageGalleryViewerProps {
  visible: boolean;
  images: string[];
  initialIndex?: number;
  onClose: () => void;
}

export function ImageGalleryViewer({
  visible,
  images,
  initialIndex = 0,
  onClose,
}: ImageGalleryViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isZoomed, setIsZoomed] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const dismissY = useSharedValue(0);

  const handleZoomChange = useCallback((zoomed: boolean) => {
    setIsZoomed(zoomed);
  }, []);

  const handlePageChange = useCallback((newIndex: number) => {
    setCurrentIndex(newIndex);
    setIsZoomed(false);
  }, []);

  const handleDismiss = useCallback(() => {
    onClose();
    setTimeout(() => { dismissY.value = 0; }, 250);
  }, [onClose, dismissY]);

  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: `rgba(0,0,0,${interpolate(
      Math.abs(dismissY.value),
      [0, DISMISS_THRESHOLD * 2],
      [1, 0.2],
      "clamp",
    )})`,
  }));

  if (!visible || images.length === 0) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[styles.container, bgStyle]}>
          <View style={styles.topBar}>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>
            {images.length > 1 && (
              <Text style={styles.counter}>
                {currentIndex + 1} / {images.length}
              </Text>
            )}
          </View>

          <FlatList
            ref={flatListRef}
            data={images}
            horizontal
            pagingEnabled
            scrollEnabled={!isZoomed}
            directionalLockEnabled={false}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={initialIndex}
            getItemLayout={(_, index) => ({
              length: SCREEN_WIDTH,
              offset: SCREEN_WIDTH * index,
              index,
            })}
            onMomentumScrollEnd={(e) => {
              const newIndex = Math.round(
                e.nativeEvent.contentOffset.x / SCREEN_WIDTH
              );
              handlePageChange(newIndex);
            }}
            keyExtractor={(_, i) => i.toString()}
            renderItem={({ item }) => (
              <ZoomableImage
                uri={item}
                onZoomChange={handleZoomChange}
                onDismiss={handleDismiss}
                dismissY={dismissY}
              />
            )}
          />
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  counter: {
    fontSize: 16,
    color: "#fff",
    fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  slide: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  slideInner: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  imageWrap: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
