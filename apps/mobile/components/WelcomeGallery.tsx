/**
 * First-launch welcome gallery. A swipeable, themed popup that introduces the
 * app across several slides. Shown automatically on first launch (see
 * WelcomeGalleryHost) and re-openable from the community side menu.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  Image,
  Pressable,
  FlatList,
  StyleSheet,
  useWindowDimensions,
  type ImageSourcePropType,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

const NWC_LOGO = require("../assets/images/nwc-logo.png");

type Slide = {
  key: string;
  title: string;
  image: ImageSourcePropType;
  body: string;
  caption?: string;
  showLogo?: boolean;
};

const SLIDES: Slide[] = [
  {
    key: "welcome",
    title: "Welcome to the Inland Northwest Community",
    image: require("../assets/images/welcome/slide-1.png"),
    body:
      "This app is made exclusively for residents of our area, primarily Kootenai County and the Spokane region. Take a look around at everything the app has to offer, and thank you for downloading!",
    showLogo: true,
  },
  {
    key: "directory",
    title: "Local Business Directory",
    image: require("../assets/images/welcome/slide-2.png"),
    body:
      "We're in the early stages, so here's what we have so far. Find and save your favorite local businesses, and together we'll prioritize the support of local.",
    caption:
      "As we grow, support from local businesses is what keeps this app possible, and free for the community.",
  },
  {
    key: "community",
    title: "Community, Groups & Events",
    image: require("../assets/images/welcome/slide-3.png"),
    body:
      "Tap the Community tab to find friends, create posts, and share updates. Join a group to connect with like-minded neighbors, browse events in the area, and save them straight to your calendar, or share your own.",
  },
  {
    key: "shopping",
    title: "INW Online Shopping",
    image: require("../assets/images/welcome/slide-4.png"),
    body:
      "One of the biggest hurdles to supporting local is how convenient online shopping has become. Shop for goods right here on our storefront, so you can shop online while still shopping local.",
  },
  {
    key: "rewards",
    title: "Northwest Community Rewards",
    image: require("../assets/images/welcome/slide-5.png"),
    body:
      "Support local businesses with our rewards system. Use the in-app camera to scan QR codes from businesses in the directory and earn points. Redeem points for free prizes, and score in the Top 10 to win something awesome.",
    caption: "Another part of the app that's still growing, so stay tuned!",
  },
  {
    key: "coupons",
    title: "Coupons",
    image: require("../assets/images/welcome/slide-6.png"),
    body:
      "This app is fully set up for a coupon book. The more businesses that join and offer coupons, the more we can give back to the community with discounts to local shops.",
    caption:
      "Once the book has enough coupons, residents can pay $1-$15 a month for access, the price is up to the community.",
  },
  {
    key: "join",
    title: "Join the Community!",
    image: require("../assets/images/welcome/slide-7.png"),
    body:
      "Signing up as a resident is free. Join groups, comment on posts, list events on the calendar, and more.",
    caption: "Signing up really helps this app grow, so thanks for being here!",
  },
];

export interface WelcomeGalleryProps {
  visible: boolean;
  /** When true, the final slide shows a single "Get Started" button instead of Sign Up / Just Looking. */
  isSignedIn: boolean;
  onClose: () => void;
  onSignUp: () => void;
}

export function WelcomeGallery({ visible, isSignedIn, onClose, onSignUp }: WelcomeGalleryProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const cardWidth = Math.min(screenW - 24, 440);
  const cardHeight = Math.min(screenH * 0.86, 720);

  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);
  /** Exact FlatList viewport width (card width minus borders); each slide is sized to this so paging never drifts. */
  const [pageWidth, setPageWidth] = useState(cardWidth);
  const isLast = index === SLIDES.length - 1;

  useEffect(() => {
    if (visible) {
      setIndex(0);
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
      });
    }
  }, [visible]);

  const handleScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
      if (next !== index) setIndex(next);
    },
    [pageWidth, index]
  );

  const goNext = useCallback(() => {
    const next = Math.min(index + 1, SLIDES.length - 1);
    listRef.current?.scrollToOffset({ offset: next * pageWidth, animated: true });
    setIndex(next);
  }, [index, pageWidth]);

  const renderSlide = useCallback(
    ({ item }: { item: Slide }) => {
      const src = Image.resolveAssetSource(item.image);
      const ar = src && src.height ? src.width / src.height : 4 / 3;
      /** Fit the photo inside a box while preserving its true aspect ratio, so nothing is cropped. Small margin to the card edge. */
      const boundW = pageWidth - 32;
      /** The final (portrait) slide gets a taller cap so its photo reads a bit bigger. */
      const boundH = cardHeight * (item.key === "join" ? 0.52 : 0.42);
      let photoW = boundW;
      let photoH = photoW / ar;
      if (photoH > boundH) {
        photoH = boundH;
        photoW = photoH * ar;
      }
      return (
        <View style={[styles.slide, { width: pageWidth }]}>
          <View style={styles.slideContent}>
            {item.showLogo && (
              <View style={styles.logoWrap}>
                <Image source={NWC_LOGO} style={styles.logo} resizeMode="contain" />
              </View>
            )}
            <Text style={styles.title}>{item.title}</Text>
            <Image
              source={item.image}
              style={[styles.photo, { width: photoW, height: photoH }]}
              resizeMode="cover"
            />
            <Text style={styles.body}>{item.body}</Text>
            {item.caption ? <Text style={styles.caption}>{item.caption}</Text> : null}
          </View>
        </View>
      );
    },
    [pageWidth, cardHeight]
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.card, { width: cardWidth, height: cardHeight }]}>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={26} color={theme.colors.heading} />
          </Pressable>

          <FlatList
            ref={listRef}
            data={SLIDES}
            keyExtractor={(s) => s.key}
            renderItem={renderSlide}
            extraData={pageWidth}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleScrollEnd}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              if (w > 0 && Math.abs(w - pageWidth) > 0.5) setPageWidth(w);
            }}
            getItemLayout={(_, i) => ({
              length: pageWidth,
              offset: pageWidth * i,
              index: i,
            })}
            style={styles.list}
          />

          <View style={styles.footer}>
            <View style={styles.dots}>
              {SLIDES.map((s, i) => (
                <View
                  key={s.key}
                  style={[styles.dot, i === index ? styles.dotActive : null]}
                />
              ))}
            </View>

            {isLast ? (
              isSignedIn ? (
                <Pressable
                  style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                  onPress={onClose}
                >
                  <Text style={styles.primaryBtnText}>Get Started</Text>
                </Pressable>
              ) : (
                <View style={styles.finalRow}>
                  <Pressable
                    style={({ pressed }) => [styles.primaryBtn, styles.finalBtn, pressed && styles.pressed]}
                    onPress={onSignUp}
                  >
                    <Text style={styles.primaryBtnText}>Sign Up!</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.secondaryBtn, styles.finalBtn, pressed && styles.pressed]}
                    onPress={onClose}
                  >
                    <Text style={styles.secondaryBtnText}>Just Looking!</Text>
                  </Pressable>
                </View>
              )
            ) : (
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                onPress={goNext}
              >
                <Text style={styles.primaryBtnText}>Continue</Text>
                <Ionicons name="arrow-forward" size={18} color={theme.colors.buttonText} />
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  closeBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    flex: 1,
  },
  slide: {
    height: "100%",
  },
  slideContent: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 16,
    alignItems: "center",
  },
  logoWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    backgroundColor: "#fff",
  },
  logo: {
    width: 64,
    height: 64,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    textAlign: "center",
    marginBottom: 16,
  },
  photo: {
    alignSelf: "center",
    borderRadius: 16,
    backgroundColor: "#e9e9e9",
    marginBottom: 16,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: theme.colors.text,
    textAlign: "center",
  },
  caption: {
    fontSize: 13,
    lineHeight: 19,
    color: theme.colors.placeholder,
    textAlign: "center",
    marginTop: 12,
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginBottom: 16,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#d6d6d6",
  },
  dotActive: {
    backgroundColor: theme.colors.primary,
    width: 20,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: {
    color: theme.colors.buttonText,
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  secondaryBtnText: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: "700",
  },
  finalRow: {
    flexDirection: "row",
    gap: 12,
  },
  finalBtn: {
    flex: 1,
  },
  pressed: {
    opacity: 0.85,
  },
});
