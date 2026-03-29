import { useEffect, useState } from "react";
import {
  View,
  Image,
  ActivityIndicator,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { theme } from "@/lib/theme";

type Props = {
  uri: string;
  maxWidth: number;
  maxHeight: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Shows the full image scaled down (only) so it fits inside maxWidth × maxHeight,
 * preserving aspect ratio and centering. No cropping.
 */
export function ScaledImageFit({ uri, maxWidth, maxHeight, style }: Props) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDims(null);
    setFailed(false);
    Image.getSize(
      uri,
      (nw, nh) => {
        if (cancelled || nw <= 0 || nh <= 0) return;
        const scale = Math.min(maxWidth / nw, maxHeight / nh);
        setDims({ w: Math.round(nw * scale), h: Math.round(nh * scale) });
      },
      () => {
        if (!cancelled) setFailed(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [uri, maxWidth, maxHeight]);

  return (
    <View
      style={[
        {
          width: maxWidth,
          height: maxHeight,
          backgroundColor: "#eee",
          justifyContent: "center",
          alignItems: "center",
        },
        style,
      ]}
    >
      {failed ? (
        <Image
          source={{ uri }}
          style={{ width: maxWidth, height: maxHeight }}
          resizeMode="contain"
        />
      ) : dims ? (
        <Image
          source={{ uri }}
          style={{ width: dims.w, height: dims.h }}
          resizeMode="contain"
        />
      ) : (
        <ActivityIndicator size="small" color={theme.colors.primary} />
      )}
    </View>
  );
}
