"use client";

import type { ContentBlock, BlockStyles } from "types";

const FONT_OPTIONS = [
  { value: "", label: "Default" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Helvetica, sans-serif", label: "Helvetica" },
  { value: "'Fahkwang', sans-serif", label: "Fahkwang" },
  { value: "'Open Sans', sans-serif", label: "Open Sans" },
  { value: "'Roboto', sans-serif", label: "Roboto" },
];

interface DesignPanelProps {
  block: ContentBlock | null;
  onStylesChange: (styles: Partial<BlockStyles>) => void;
}

export function DesignPanel({ block, onStylesChange }: DesignPanelProps) {
  if (!block) return null;

  const styles = (block.content?.styles as Partial<BlockStyles>) ?? {};

  return (
    <div className="w-64 flex-shrink-0 border-l border-gray-200 bg-gray-50 p-3 overflow-auto">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Design</h3>
      <div className="space-y-3 text-sm">
        <div>
          <label className="block text-gray-600 mb-1">Font size</label>
          <input
            type="text"
            value={styles.fontSize ?? ""}
            onChange={(e) => onStylesChange({ fontSize: e.target.value })}
            placeholder="e.g. 1rem"
            className="w-full border rounded px-2 py-1 text-xs"
          />
        </div>
        <div>
          <label className="block text-gray-600 mb-1">Font</label>
          <select
            value={styles.fontFamily ?? ""}
            onChange={(e) => onStylesChange({ fontFamily: e.target.value })}
            className="w-full border rounded px-2 py-1 text-xs"
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.value || "default"} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-gray-600 mb-1">Text color</label>
          <div className="flex gap-1">
            <input
              type="color"
              value={styles.color ?? "#000000"}
              onChange={(e) => onStylesChange({ color: e.target.value })}
              className="w-8 h-8 rounded border cursor-pointer"
            />
            <input
              type="text"
              value={styles.color ?? ""}
              onChange={(e) => onStylesChange({ color: e.target.value })}
              placeholder="#000000"
              className="flex-1 border rounded px-2 py-1 text-xs"
            />
          </div>
        </div>
        <div>
          <label className="block text-gray-600 mb-1">Background color</label>
          <div className="flex gap-1">
            <input
              type="color"
              value={styles.backgroundColor ?? "#ffffff"}
              onChange={(e) => onStylesChange({ backgroundColor: e.target.value })}
              className="w-8 h-8 rounded border cursor-pointer"
            />
            <input
              type="text"
              value={styles.backgroundColor ?? ""}
              onChange={(e) => onStylesChange({ backgroundColor: e.target.value })}
              placeholder="#ffffff"
              className="flex-1 border rounded px-2 py-1 text-xs"
            />
          </div>
        </div>
        {(block.type === "button" || block.type === "link") && (
          <>
            <div>
              <label className="block text-gray-600 mb-1">Hover background</label>
              <div className="flex gap-1">
                <input
                  type="color"
                  value={styles.hoverColor ?? "#f5f5f5"}
                  onChange={(e) => onStylesChange({ hoverColor: e.target.value })}
                  className="w-8 h-8 rounded border cursor-pointer"
                />
                <input
                  type="text"
                  value={styles.hoverColor ?? ""}
                  onChange={(e) => onStylesChange({ hoverColor: e.target.value })}
                  placeholder="#f5f5f5"
                  className="flex-1 border rounded px-2 py-1 text-xs"
                />
              </div>
            </div>
            <div>
              <label className="block text-gray-600 mb-1">Hover text color</label>
              <div className="flex gap-1">
                <input
                  type="color"
                  value={styles.hoverTextColor ?? "#000000"}
                  onChange={(e) => onStylesChange({ hoverTextColor: e.target.value })}
                  className="w-8 h-8 rounded border cursor-pointer"
                />
                <input
                  type="text"
                  value={styles.hoverTextColor ?? ""}
                  onChange={(e) => onStylesChange({ hoverTextColor: e.target.value })}
                  placeholder="#000000"
                  className="flex-1 border rounded px-2 py-1 text-xs"
                />
              </div>
            </div>
          </>
        )}
        <div>
          <label className="block text-gray-600 mb-1">Border width</label>
          <input
            type="text"
            value={styles.borderWidth ?? ""}
            onChange={(e) => onStylesChange({ borderWidth: e.target.value })}
            placeholder="e.g. 1px"
            className="w-full border rounded px-2 py-1 text-xs"
          />
        </div>
        <div>
          <label className="block text-gray-600 mb-1">Border color</label>
          <div className="flex gap-1">
            <input
              type="color"
              value={styles.borderColor ?? "#cccccc"}
              onChange={(e) => onStylesChange({ borderColor: e.target.value })}
              className="w-8 h-8 rounded border cursor-pointer"
            />
            <input
              type="text"
              value={styles.borderColor ?? ""}
              onChange={(e) => onStylesChange({ borderColor: e.target.value })}
              placeholder="#cccccc"
              className="flex-1 border rounded px-2 py-1 text-xs"
            />
          </div>
        </div>
        <div>
          <label className="block text-gray-600 mb-1">Border radius</label>
          <input
            type="text"
            value={styles.borderRadius ?? ""}
            onChange={(e) => onStylesChange({ borderRadius: e.target.value })}
            placeholder="e.g. 4px"
            className="w-full border rounded px-2 py-1 text-xs"
          />
        </div>
        <div>
          <label className="block text-gray-600 mb-1">Text align</label>
          <select
            value={styles.textAlign ?? ""}
            onChange={(e) =>
              onStylesChange({
                textAlign: (e.target.value || undefined) as BlockStyles["textAlign"],
              })
            }
            className="w-full border rounded px-2 py-1 text-xs"
          >
            <option value="">Default</option>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
            <option value="justify">Justify</option>
          </select>
        </div>
      </div>
    </div>
  );
}
