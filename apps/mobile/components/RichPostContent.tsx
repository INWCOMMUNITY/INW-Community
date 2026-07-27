import { useCallback } from "react";
import { Text, type TextStyle } from "react-native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";

interface RichPostContentProps {
  content: string;
  style?: TextStyle;
  numberOfLines?: number;
}

type Segment =
  | { type: "text"; value: string }
  | { type: "hashtag"; value: string; tag: string }
  | { type: "mention"; value: string; name: string };

const SEGMENT_RE = /(#[\w]+)|(@[\w]+(?:\s[\w]+){0,2})/g;

function parseContent(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(SEGMENT_RE)) {
    const start = match.index!;
    if (start > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, start) });
    }
    const raw = match[0];
    if (raw.startsWith("#")) {
      segments.push({
        type: "hashtag",
        value: raw,
        tag: raw.slice(1).toLowerCase(),
      });
    } else {
      segments.push({
        type: "mention",
        value: raw,
        name: raw.slice(1).trim(),
      });
    }
    lastIndex = start + raw.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}

export function RichPostContent({
  content,
  style,
  numberOfLines,
}: RichPostContentProps) {
  const router = useRouter();

  const handleHashtag = useCallback(
    (tag: string) => {
      (router.push as (href: string) => void)(
        `/community/tag/${encodeURIComponent(tag)}`
      );
    },
    [router]
  );

  const handleMention = useCallback(
    (name: string) => {
      (router.push as (href: string) => void)(
        `/community/search?q=${encodeURIComponent("@" + name)}`
      );
    },
    [router]
  );

  const segments = parseContent(content);

  if (segments.length === 1 && segments[0].type === "text") {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {content}
      </Text>
    );
  }

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return seg.value;
        }
        if (seg.type === "hashtag") {
          return (
            <Text
              key={i}
              style={linkStyle}
              onPress={() => handleHashtag(seg.tag)}
            >
              {seg.value}
            </Text>
          );
        }
        return (
          <Text
            key={i}
            style={linkStyle}
            onPress={() => handleMention(seg.name)}
          >
            {seg.value}
          </Text>
        );
      })}
    </Text>
  );
}

const linkStyle: TextStyle = {
  color: theme.colors.primary,
  fontWeight: "600",
};
