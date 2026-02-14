"use client";

import { useState, useEffect, useCallback } from "react";
import type { PageStructure, Section, Column, ContentBlock, BlockType, BlockStyles } from "types";
import { DesignPanel } from "./DesignPanel";
import { RichTextBlock } from "./RichTextBlock";
import { ImageBlockEditor } from "./ImageBlockEditor";

function generateId(): string {
  return `b_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const BLOCK_TYPES: { type: BlockType; label: string }[] = [
  { type: "heading", label: "Heading" },
  { type: "paragraph", label: "Paragraph" },
  { type: "image", label: "Image" },
  { type: "button", label: "Button" },
  { type: "link", label: "Link" },
  { type: "video", label: "Video" },
  { type: "line", label: "Line" },
  { type: "box", label: "Box" },
];

function defaultContent(type: BlockType): Record<string, unknown> {
  switch (type) {
    case "heading":
      return { html: "<h2>Heading</h2>", level: "2" };
    case "paragraph":
      return { html: "<p>Paragraph text</p>" };
    case "image":
      return { src: "", alt: "" };
    case "button":
      return { text: "Button", href: "#" };
    case "link":
      return { text: "Link", href: "#" };
    case "video":
      return { src: "", title: "" };
    case "line":
      return { style: "solid" };
    case "box":
      return { style: "border" };
    default:
      return {};
  }
}

interface BlockEditorProps {
  pageId: string;
  token: string;
  onSave?: () => void;
}

async function uploadImage(file: File, token: string): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/admin/upload", {
    method: "POST",
    headers: { "x-admin-code": token },
    body: formData,
  });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return data.url ?? "";
}

export function BlockEditor({ pageId, token, onSave }: BlockEditorProps) {
  const [structure, setStructure] = useState<PageStructure>({ sections: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gridlines, setGridlines] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ si: number; ci: number; bi: number } | null>(null);
  const [history, setHistory] = useState<PageStructure[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [seeding, setSeeding] = useState(false);

  const pushHistory = useCallback((next: PageStructure) => {
    setHistory((prev) => prev.slice(0, historyIndex + 1).concat(JSON.parse(JSON.stringify(next))));
    setHistoryIndex((prev) => prev + 1);
  }, [historyIndex]);

  useEffect(() => {
    fetch(`/api/admin/site-content/${pageId}`, {
      headers: { "x-admin-code": token },
    })
      .then((r) => r.json())
      .then((data) => {
        const s = data?.sections ? { sections: data.sections } : { sections: [] };
        setStructure(s);
        setHistory([s]);
        setHistoryIndex(0);
      })
      .finally(() => setLoading(false));
  }, [pageId, token]);

  function addSection() {
    const next: PageStructure = {
      sections: [
        ...structure.sections,
        { id: generateId(), columns: [{ id: generateId(), blocks: [] }], layout: "single" },
      ],
    };
    setStructure(next);
    pushHistory(next);
  }

  function addColumn(sectionIndex: number) {
    const sections = [...structure.sections];
    const sec = sections[sectionIndex];
    if (!sec || sec.columns.length >= 2) return;
    sec.columns = [...sec.columns, { id: generateId(), blocks: [] }];
    sec.layout = "two-col";
    setStructure({ sections });
    pushHistory({ sections });
  }

  function addBlock(sectionIndex: number, columnIndex: number, type: BlockType) {
    const sections = JSON.parse(JSON.stringify(structure.sections)) as Section[];
    const col = sections[sectionIndex]?.columns[columnIndex];
    if (!col) return;
    col.blocks.push({
      id: generateId(),
      type,
      content: defaultContent(type),
    });
    setStructure({ sections });
    pushHistory({ sections });
  }

  function duplicateBlock(sectionIndex: number, columnIndex: number, blockIndex: number) {
    const sections = JSON.parse(JSON.stringify(structure.sections)) as Section[];
    const col = sections[sectionIndex]?.columns[columnIndex];
    const block = col?.blocks[blockIndex];
    if (!col || !block) return;
    const copy = { ...block, id: generateId(), content: { ...block.content } };
    col.blocks.splice(blockIndex + 1, 0, copy);
    setStructure({ sections });
    pushHistory({ sections });
  }

  function deleteBlock(sectionIndex: number, columnIndex: number, blockIndex: number) {
    const sections = JSON.parse(JSON.stringify(structure.sections)) as Section[];
    const col = sections[sectionIndex]?.columns[columnIndex];
    if (!col) return;
    col.blocks.splice(blockIndex, 1);
    setStructure({ sections });
    pushHistory({ sections });
    setSelectedId(null);
  }

  function updateBlockContent(
    sectionIndex: number,
    columnIndex: number,
    blockIndex: number,
    content: Record<string, unknown>
  ) {
    const sections = JSON.parse(JSON.stringify(structure.sections)) as Section[];
    const block = sections[sectionIndex]?.columns[columnIndex]?.blocks[blockIndex];
    if (!block) return;
    block.content = { ...block.content, ...content };
    setStructure({ sections });
  }

  function updateBlockStyles(
    sectionIndex: number,
    columnIndex: number,
    blockIndex: number,
    styles: Partial<BlockStyles>
  ) {
    const sections = JSON.parse(JSON.stringify(structure.sections)) as Section[];
    const block = sections[sectionIndex]?.columns[columnIndex]?.blocks[blockIndex];
    if (!block) return;
    const current = (block.content?.styles as Partial<BlockStyles>) ?? {};
    block.content = { ...block.content, styles: { ...current, ...styles } };
    setStructure({ sections });
    pushHistory({ sections });
  }

  function updateBlockZIndex(
    sectionIndex: number,
    columnIndex: number,
    blockIndex: number,
    direction: "front" | "back"
  ) {
    const sections = JSON.parse(JSON.stringify(structure.sections)) as Section[];
    const col = sections[sectionIndex]?.columns[columnIndex];
    const block = col?.blocks[blockIndex];
    if (!col || !block) return;
    const maxZ = Math.max(0, ...col.blocks.map((b) => b.zIndex ?? 0));
    const current = block.zIndex ?? 0;
    block.zIndex = direction === "front" ? maxZ + 1 : Math.max(0, current - 1);
    setStructure({ sections });
    pushHistory({ sections });
  }

  function updateBlockPosition(
    sectionIndex: number,
    columnIndex: number,
    blockIndex: number,
    position: Partial<{ x: number; y: number; width: number; height: number }>
  ) {
    const sections = JSON.parse(JSON.stringify(structure.sections)) as Section[];
    const block = sections[sectionIndex]?.columns[columnIndex]?.blocks[blockIndex];
    if (!block) return;
    block.position = { ...(block.position ?? {}), ...position };
    setStructure({ sections });
    pushHistory({ sections });
  }

  function addSectionAbove(sectionIndex: number) {
    const sections = JSON.parse(JSON.stringify(structure.sections)) as Section[];
    const newSec = { id: generateId(), columns: [{ id: generateId(), blocks: [] }], layout: "single" as const };
    sections.splice(sectionIndex, 0, newSec);
    setStructure({ sections });
    pushHistory({ sections });
  }

  function addSectionBelow(sectionIndex: number) {
    const sections = JSON.parse(JSON.stringify(structure.sections)) as Section[];
    const newSec = { id: generateId(), columns: [{ id: generateId(), blocks: [] }], layout: "single" as const };
    sections.splice(sectionIndex + 1, 0, newSec);
    setStructure({ sections });
    pushHistory({ sections });
  }

  function alignBlock(
    sectionIndex: number,
    columnIndex: number,
    blockIndex: number,
    align: "left" | "center" | "right" | "top" | "middle" | "bottom"
  ) {
    const sections = JSON.parse(JSON.stringify(structure.sections)) as Section[];
    const col = sections[sectionIndex]?.columns[columnIndex];
    const block = col?.blocks[blockIndex];
    if (!col || !block) return;
    block.position = block.position ?? { x: 0, y: 0, width: 200, height: 80 };
    const sectionWidth = 800;
    const sectionHeight = 400;
    const w = block.position.width ?? 200;
    const h = block.position.height ?? 80;
    if (align === "left") block.position.x = 0;
    else if (align === "center") block.position.x = (sectionWidth - w) / 2;
    else if (align === "right") block.position.x = sectionWidth - w;
    else if (align === "top") block.position.y = 0;
    else if (align === "middle") block.position.y = (sectionHeight - h) / 2;
    else if (align === "bottom") block.position.y = sectionHeight - h;
    setStructure({ sections });
    pushHistory({ sections });
  }

  function getSelectedBlockLocation(): { block: ContentBlock; si: number; ci: number; bi: number } | null {
    if (!selectedId) return null;
    for (let si = 0; si < structure.sections.length; si++) {
      const sec = structure.sections[si];
      for (let ci = 0; ci < sec.columns.length; ci++) {
        const col = sec.columns[ci];
        const bi = col.blocks.findIndex((b) => b.id === selectedId);
        if (bi >= 0) return { block: col.blocks[bi], si, ci, bi };
      }
    }
    return null;
  }

  const selectedLoc = getSelectedBlockLocation();

  function moveBlock(
    sectionIndex: number,
    columnIndex: number,
    fromIndex: number,
    toIndex: number
  ) {
    const sections = JSON.parse(JSON.stringify(structure.sections)) as Section[];
    const col = sections[sectionIndex]?.columns[columnIndex];
    if (!col || toIndex < 0 || toIndex >= col.blocks.length) return;
    const [removed] = col.blocks.splice(fromIndex, 1);
    col.blocks.splice(toIndex, 0, removed);
    setStructure({ sections });
    pushHistory({ sections });
  }

  function handleBlockDrop(toSi: number, toCi: number, toBi: number) {
    if (!dragging) return;
    const { si: fromSi, ci: fromCi, bi: fromBi } = dragging;
    setDragging(null);
    if (fromSi === toSi && fromCi === toCi && fromBi === toBi) return;
    const sections = JSON.parse(JSON.stringify(structure.sections)) as Section[];
    const fromCol = sections[fromSi]?.columns[fromCi];
    const toCol = sections[toSi]?.columns[toCi];
    const block = fromCol?.blocks[fromBi];
    if (!fromCol || !toCol || !block) return;
    fromCol.blocks.splice(fromBi, 1);
    let insertAt = toBi;
    if (fromSi === toSi && fromCi === toCi && fromBi < toBi) insertAt = toBi - 1;
    toCol.blocks.splice(insertAt, 0, block);
    setStructure({ sections });
    pushHistory({ sections });
  }

  function undo() {
    if (historyIndex <= 0) return;
    const i = historyIndex - 1;
    setHistoryIndex(i);
    setStructure(history[i]);
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    const i = historyIndex + 1;
    setHistoryIndex(i);
    setStructure(history[i]);
  }

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/admin/site-content/${pageId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-code": token },
        body: JSON.stringify(structure),
      });
      onSave?.();
    } finally {
      setSaving(false);
    }
  }

  async function initializeContent() {
    setSeeding(true);
    try {
      const res = await fetch("/api/admin/seed-site-content", {
        method: "POST",
        headers: { "x-admin-code": token },
      });
      if (!res.ok) throw new Error("Seed failed");
      const data = await res.json();
      if (data?.seeded?.some((r: { pageId: string }) => r.pageId === pageId)) {
        const r = await fetch(`/api/admin/site-content/${pageId}`, {
          headers: { "x-admin-code": token },
        });
        const json = await r.json();
        const s = json?.sections ? { sections: json.sections } : { sections: [] };
        setStructure(s);
        setHistory([s]);
        setHistoryIndex(0);
      }
    } finally {
      setSeeding(false);
    }
  }

  if (loading) return <p className="p-4 text-gray-500">Loading…</p>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-2 p-2 bg-gray-100 border-b">
        <button type="button" onClick={undo} disabled={historyIndex <= 0} className="btn text-sm">
          Undo
        </button>
        <button type="button" onClick={redo} disabled={historyIndex >= history.length - 1} className="btn text-sm">
          Redo
        </button>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={gridlines} onChange={(e) => setGridlines(e.target.checked)} />
          Gridlines
        </label>
        <button type="button" onClick={addSection} className="btn text-sm">
          Add section
        </button>
        {selectedLoc && (
          <>
            <span className="text-gray-400 text-sm">|</span>
            <button
              type="button"
              onClick={() => updateBlockZIndex(selectedLoc.si, selectedLoc.ci, selectedLoc.bi, "front")}
              className="btn text-sm"
            >
              Bring to front
            </button>
            <button
              type="button"
              onClick={() => updateBlockZIndex(selectedLoc.si, selectedLoc.ci, selectedLoc.bi, "back")}
              className="btn text-sm"
            >
              Send to back
            </button>
            <select
              className="text-xs border rounded px-2 py-1"
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value as "left" | "center" | "right" | "top" | "middle" | "bottom";
                if (v) alignBlock(selectedLoc.si, selectedLoc.ci, selectedLoc.bi, v);
                e.target.value = "";
              }}
            >
              <option value="">Auto-align</option>
              <option value="left">Align left</option>
              <option value="center">Align center</option>
              <option value="right">Align right</option>
              <option value="top">Align top</option>
              <option value="middle">Align middle</option>
              <option value="bottom">Align bottom</option>
            </select>
          </>
        )}
        <button type="button" onClick={save} disabled={saving} className="btn text-sm ml-auto">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="flex flex-1 min-h-0">
        <div
          className={`flex-1 overflow-auto p-4 ${gridlines ? "bg-[linear-gradient(to_right,#eee_1px,transparent_1px),linear-gradient(to_bottom,#eee_1px,transparent_1px)] bg-[size:20px_20px]" : ""}`}
        >
          {structure.sections.length === 0 ? (
            <div className="space-y-3">
              <p className="text-gray-500">No sections. Click &quot;Add section&quot; to start, or load starter content for all editable pages.</p>
              <button
                type="button"
                onClick={initializeContent}
                disabled={seeding}
                className="btn text-sm"
              >
                {seeding ? "Loading…" : "Initialize content for all pages"}
              </button>
            </div>
          ) : (
            structure.sections.map((section, si) => (
              <div
                key={section.id}
                className="mb-6 border-2 border-dashed border-gray-300 rounded p-4 bg-white relative min-h-[120px]"
              >
                <div className="flex justify-between items-center mb-2 gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-500">Section {si + 1}</span>
                  <div className="flex gap-1 flex-wrap">
                    <button type="button" onClick={() => addSectionAbove(si)} className="text-xs btn">
                      Add above
                    </button>
                    <button type="button" onClick={() => addSectionBelow(si)} className="text-xs btn">
                      Add below
                    </button>
                    <button
                      type="button"
                      onClick={() => addColumn(si)}
                      disabled={section.columns.length >= 2}
                      className="text-xs btn"
                    >
                      Add column
                    </button>
                  </div>
                </div>
                <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${section.columns.length}, 1fr)` }}>
                  {section.columns.map((col, ci) => (
                    <div key={col.id} className="min-h-[80px] border border-gray-200 rounded p-2 bg-gray-50 relative">
                      <div className="text-xs text-gray-400 mb-2">Column {ci + 1}</div>
                      <div className="space-y-2 relative min-h-[60px]">
                        {[...col.blocks]
                          .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
                          .map((block) => {
                            const bi = col.blocks.findIndex((b) => b.id === block.id);
                            return (
                              <BlockItem
                                key={block.id}
                                block={block}
                                selected={selectedId === block.id}
                                onSelect={() => setSelectedId(block.id)}
                                onContentChange={(content) => updateBlockContent(si, ci, bi, content)}
                                onStylesChange={(styles) => updateBlockStyles(si, ci, bi, styles)}
                                onPositionChange={(pos) => updateBlockPosition(si, ci, bi, pos)}
                                onDuplicate={() => duplicateBlock(si, ci, bi)}
                                onDelete={() => deleteBlock(si, ci, bi)}
                                onMoveUp={bi > 0 ? () => moveBlock(si, ci, bi, bi - 1) : undefined}
                                onMoveDown={
                                  bi < col.blocks.length - 1 ? () => moveBlock(si, ci, bi, bi + 1) : undefined
                                }
                                onDragStart={() => setDragging({ si, ci, bi })}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => handleBlockDrop(si, ci, bi)}
                                uploadToken={token}
                              />
                            );
                          })}
                      </div>
                      <div className="mt-2">
                        <select
                          className="text-xs border rounded p-1"
                          defaultValue=""
                          onChange={(e) => {
                            const v = e.target.value as BlockType;
                            if (v) addBlock(si, ci, v);
                            e.target.value = "";
                          }}
                        >
                          <option value="">Add block</option>
                          {BLOCK_TYPES.map((t) => (
                            <option key={t.type} value={t.type}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
          <div className="py-4">
            <button type="button" onClick={save} disabled={saving} className="btn text-sm">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        {selectedLoc && (
          <DesignPanel
            block={selectedLoc.block}
            onStylesChange={(styles) => updateBlockStyles(selectedLoc.si, selectedLoc.ci, selectedLoc.bi, styles)}
          />
        )}
      </div>
    </div>
  );
}

interface BlockItemProps {
  block: ContentBlock;
  selected: boolean;
  onSelect: () => void;
  onContentChange: (content: Record<string, unknown>) => void;
  onStylesChange?: (styles: Partial<import("types").BlockStyles>) => void;
  onPositionChange?: (position: Partial<{ x: number; y: number; width: number; height: number }>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  uploadToken?: string;
}

function getBlockInlineStyles(block: ContentBlock): React.CSSProperties {
  const styles = (block.content?.styles as Partial<import("types").BlockStyles>) ?? {};
  const s: React.CSSProperties = {};
  if (styles.fontSize) s.fontSize = styles.fontSize;
  if (styles.fontFamily) s.fontFamily = styles.fontFamily;
  if (styles.color) s.color = styles.color;
  if (styles.backgroundColor) s.backgroundColor = styles.backgroundColor;
  if (styles.borderWidth) s.borderWidth = styles.borderWidth;
  if (styles.borderColor) s.borderColor = styles.borderColor;
  if (styles.borderRadius) s.borderRadius = styles.borderRadius;
  if (styles.textAlign) s.textAlign = styles.textAlign;
  return s;
}

function BlockItem({
  block,
  selected,
  onSelect,
  onContentChange,
  onStylesChange,
  onPositionChange,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  uploadToken,
}: BlockItemProps) {
  const content = block.content as Record<string, string>;
  const blockStyles = getBlockInlineStyles(block);
  const pos = block.position;
  const hasPosition = pos && (pos.x !== undefined || pos.y !== undefined);
  const positionStyle: React.CSSProperties = hasPosition
    ? {
        position: "absolute",
        left: pos?.x ?? 0,
        top: pos?.y ?? 0,
        width: pos?.width,
        height: pos?.height,
        zIndex: block.zIndex ?? 0,
      }
    : {};

  const wrapper = (
    <div
      className={`border-2 rounded p-2 bg-white cursor-move ${selected ? "border-[var(--color-primary)]" : "border-gray-200"}`}
      style={{ ...blockStyles, ...positionStyle, minWidth: hasPosition ? 80 : undefined }}
      onClick={onSelect}
      draggable={!!onDragStart}
      onDragStart={(e) => { onDragStart?.(); e.dataTransfer.setData("text/plain", block.id); }}
      onDragOver={onDragOver}
      onDrop={(e) => { e.preventDefault(); onDrop?.(); }}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          {block.type === "heading" && (
            <RichTextBlock
              content={(content.html ?? content.text ?? "<h2>Heading</h2>") as string}
              onChange={(html) => onContentChange({ html })}
              placeholder="Heading"
              tag="h2"
              className="w-full border rounded px-2 py-1 text-lg font-bold min-h-[2em]"
              style={blockStyles}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          {block.type === "paragraph" && (
            <RichTextBlock
              content={(content.html ?? content.text ?? "<p>Paragraph text</p>") as string}
              onChange={(html) => onContentChange({ html })}
              placeholder="Paragraph text"
              tag="p"
              className="w-full border rounded px-2 py-1 text-sm min-h-[3em]"
              style={blockStyles}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          {block.type === "image" && uploadToken && (
            <ImageBlockEditor
              src={(content.src as string) ?? ""}
              alt={(content.alt as string) ?? ""}
              width={typeof content.width === "number" ? content.width : undefined}
              height={typeof content.height === "number" ? content.height : undefined}
              crop={content.crop as unknown as { x: number; y: number; width: number; height: number } | undefined}
              onChange={(updates) =>
                onContentChange({
                  ...(updates.src !== undefined && { src: updates.src }),
                  ...(updates.alt !== undefined && { alt: updates.alt }),
                  ...(updates.width !== undefined && { width: updates.width }),
                  ...(updates.height !== undefined && { height: updates.height }),
                  ...(updates.crop !== undefined && { crop: updates.crop }),
                })
              }
              onUpload={(file) => uploadImage(file, uploadToken)}
            />
          )}
          {block.type === "image" && !uploadToken && (
            <input
              type="url"
              value={content.src ?? ""}
              onChange={(e) => onContentChange({ src: e.target.value })}
              placeholder="Image URL"
              className="w-full border rounded px-1 text-sm"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          {block.type === "button" && (
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                value={content.text ?? ""}
                onChange={(e) => onContentChange({ text: e.target.value })}
                placeholder="Button text"
                className="border rounded px-1 text-sm w-24"
                style={blockStyles}
                onClick={(e) => e.stopPropagation()}
              />
              <input
                type="text"
                value={content.href ?? ""}
                onChange={(e) => onContentChange({ href: e.target.value })}
                placeholder="Link"
                className="border rounded px-1 text-sm flex-1"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          {block.type === "link" && (
            <div className="flex gap-2">
              <input
                type="text"
                value={content.text ?? ""}
                onChange={(e) => onContentChange({ text: e.target.value })}
                placeholder="Link text"
                className="border rounded px-1 text-sm"
                style={blockStyles}
                onClick={(e) => e.stopPropagation()}
              />
              <input
                type="text"
                value={content.href ?? ""}
                onChange={(e) => onContentChange({ href: e.target.value })}
                placeholder="URL"
                className="border rounded px-1 text-sm flex-1"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          {block.type === "line" && <div className="border-t border-gray-300 h-0" />}
          {block.type === "box" && (
            <div className="border border-gray-300 rounded p-2 text-sm text-gray-500" style={blockStyles}>
              Box
            </div>
          )}
          {(block.type === "video" || (block.type === "heading" && !content.html && !content.text)) && (
            <span className="text-sm text-gray-400">{block.type}</span>
          )}
        </div>
        <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {selected && onPositionChange && (
            <>
              <button
                type="button"
                onClick={() => onPositionChange({ width: 200, height: 80 })}
                className="text-xs border rounded px-1"
                title="Set size"
              >
                Resize
              </button>
            </>
          )}
          {onMoveUp && (
            <button type="button" onClick={onMoveUp} className="text-xs border rounded px-1">
              Up
            </button>
          )}
          {onMoveDown && (
            <button type="button" onClick={onMoveDown} className="text-xs border rounded px-1">
              Down
            </button>
          )}
          <button type="button" onClick={onDuplicate} className="text-xs border rounded px-1">
            Duplicate
          </button>
          <button type="button" onClick={onDelete} className="text-xs border rounded px-1 text-red-600">
            Delete
          </button>
        </div>
      </div>
    </div>
  );

  return wrapper;
}
