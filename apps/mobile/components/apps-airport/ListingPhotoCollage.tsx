import { Image, StyleSheet, View } from "react-native";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function resolvePhotoUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** Up to four listing photos, matching the website Sync Airport collage. */
export function ListingPhotoCollage({
  photos,
  size = 64,
}: {
  photos?: string[] | null;
  size?: number;
}) {
  const shown = (photos ?? []).map(resolvePhotoUrl).filter(Boolean).slice(0, 4);
  const frame = { width: size, height: size };

  if (shown.length === 0) {
    return <View style={[styles.frame, frame]} />;
  }

  if (shown.length === 1) {
    return (
      <View style={[styles.frame, frame]}>
        <Image source={{ uri: shown[0] }} style={styles.fill} resizeMode="cover" />
      </View>
    );
  }

  if (shown.length === 2) {
    return (
      <View style={[styles.frame, frame, styles.row]}>
        {shown.map((uri) => (
          <Image key={uri} source={{ uri }} style={styles.fill} resizeMode="cover" />
        ))}
      </View>
    );
  }

  if (shown.length === 3) {
    return (
      <View style={[styles.frame, frame, styles.row]}>
        <Image source={{ uri: shown[0] }} style={styles.fill} resizeMode="cover" />
        <View style={styles.stack}>
          <Image source={{ uri: shown[1] }} style={styles.fill} resizeMode="cover" />
          <Image source={{ uri: shown[2] }} style={styles.fill} resizeMode="cover" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.frame, frame, styles.grid]}>
      {shown.map((uri) => (
        <Image key={uri} source={{ uri }} style={styles.cell} resizeMode="cover" />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  fill: { flex: 1 },
  row: { flexDirection: "row", gap: 1 },
  stack: { flex: 1, gap: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "50%", height: "50%" },
});
