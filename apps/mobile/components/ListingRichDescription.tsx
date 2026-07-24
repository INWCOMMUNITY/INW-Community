import type { ReactNode } from "react";
import { Text, View, StyleSheet, type TextStyle, type StyleProp } from "react-native";

type Props = {
  html: string;
  style?: StyleProp<TextStyle>;
};

type Node =
  | { type: "text"; text: string }
  | { type: "br" }
  | { type: "block"; tag: string; children: Node[] }
  | { type: "inline"; tag: string; children: Node[] };

const BLOCK_TAGS = new Set(["p", "ul", "ol", "li", "h2", "h3", "blockquote"]);
const INLINE_TAGS = new Set(["b", "strong", "i", "em", "u"]);

/**
 * Lightweight renderer for the INW listing HTML subset (no font/size/color).
 * Avoids an extra HTML library dependency on Expo.
 */
export function ListingRichDescription({ html, style }: Props) {
  const nodes = parseHtml(html);
  if (nodes.length === 0) {
    return <Text style={[styles.base, style]}>{stripTags(html)}</Text>;
  }
  return <View>{nodes.map((n, i) => renderNode(n, i, style, false))}</View>;
}

function renderNode(
  node: Node,
  key: number,
  style: StyleProp<TextStyle> | undefined,
  parentBold: boolean
): ReactNode {
  if (node.type === "text") {
    return (
      <Text key={key} style={[styles.base, style, parentBold && styles.bold]}>
        {node.text}
      </Text>
    );
  }
  if (node.type === "br") {
    return (
      <Text key={key} style={[styles.base, style]}>
        {"\n"}
      </Text>
    );
  }
  if (node.type === "inline") {
    const bold = parentBold || node.tag === "b" || node.tag === "strong";
    const italic = node.tag === "i" || node.tag === "em";
    return (
      <Text
        key={key}
        style={[styles.base, style, bold && styles.bold, italic && styles.italic]}
      >
        {node.children.map((c, i) => renderInlineChild(c, i, bold))}
      </Text>
    );
  }
  // block
  if (node.tag === "ul" || node.tag === "ol") {
    return (
      <View key={key} style={styles.list}>
        {node.children.map((c, i) => renderNode(c, i, style, parentBold))}
      </View>
    );
  }
  if (node.tag === "li") {
    return (
      <View key={key} style={styles.li}>
        <Text style={[styles.base, style]}>{"\u2022 "}</Text>
        <View style={styles.liBody}>
          {node.children.map((c, i) => renderNode(c, i, style, parentBold))}
        </View>
      </View>
    );
  }
  return (
    <View key={key} style={styles.block}>
      <Text style={[styles.base, style, node.tag.startsWith("h") && styles.heading]}>
        {node.children.map((c, i) => renderInlineChild(c, i, parentBold))}
      </Text>
    </View>
  );
}

function renderInlineChild(node: Node, key: number, parentBold: boolean): ReactNode {
  if (node.type === "text") {
    return (
      <Text key={key} style={parentBold ? styles.bold : undefined}>
        {node.text}
      </Text>
    );
  }
  if (node.type === "br") return "\n";
  if (node.type === "inline") {
    const bold = parentBold || node.tag === "b" || node.tag === "strong";
    const italic = node.tag === "i" || node.tag === "em";
    return (
      <Text key={key} style={[bold && styles.bold, italic && styles.italic]}>
        {node.children.map((c, i) => renderInlineChild(c, i, bold))}
      </Text>
    );
  }
  return node.children.map((c, i) => renderInlineChild(c, i, parentBold));
}

function parseHtml(input: string): Node[] {
  const src = input.trim();
  if (!/<[a-z][\s\S]*>/i.test(src)) {
    return src ? [{ type: "text", text: src }] : [];
  }
  const tokens = src.split(/(<[^>]+>)/g).filter(Boolean);
  const root: Node[] = [];
  const stack: { tag: string; children: Node[] }[] = [{ tag: "root", children: root }];

  for (const tok of tokens) {
    if (tok === "<br>" || tok === "<br/>" || tok === "<br />") {
      stack[stack.length - 1].children.push({ type: "br" });
      continue;
    }
    const open = tok.match(/^<([a-z0-9]+)(?:\s[^>]*)?>$/i);
    const close = tok.match(/^<\/([a-z0-9]+)>$/i);
    if (open) {
      const tag = open[1].toLowerCase();
      if (tag === "br") {
        stack[stack.length - 1].children.push({ type: "br" });
        continue;
      }
      if (BLOCK_TAGS.has(tag) || INLINE_TAGS.has(tag)) {
        const node: Node = BLOCK_TAGS.has(tag)
          ? { type: "block", tag, children: [] }
          : { type: "inline", tag, children: [] };
        stack[stack.length - 1].children.push(node);
        stack.push({ tag, children: node.children });
      }
      continue;
    }
    if (close) {
      const tag = close[1].toLowerCase();
      if (stack.length > 1 && stack[stack.length - 1].tag === tag) stack.pop();
      continue;
    }
    const text = decodeEntities(tok);
    if (text) stack[stack.length - 1].children.push({ type: "text", text });
  }
  return root;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

const styles = StyleSheet.create({
  base: {
    fontSize: 15,
    lineHeight: 22,
    color: "#374151",
  },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  heading: { fontWeight: "700", fontSize: 17, marginBottom: 4 },
  block: { marginBottom: 10 },
  list: { marginBottom: 10, gap: 4 },
  li: { flexDirection: "row", alignItems: "flex-start", marginBottom: 4 },
  liBody: { flex: 1 },
});
