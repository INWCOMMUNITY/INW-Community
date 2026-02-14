"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import LinkExtension from "@tiptap/extension-link";
import { useCallback, useEffect } from "react";

interface RichTextBlockProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  tag?: "h1" | "h2" | "h3" | "h4" | "p";
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
}

export function RichTextBlock({
  content,
  onChange,
  placeholder = "Type here…",
  tag = "p",
  className = "",
  style,
  onClick,
}: RichTextBlockProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Placeholder.configure({ placeholder }),
      Underline,
      LinkExtension.configure({ openOnClick: false, HTMLAttributes: { target: "_blank", rel: "noopener" } }),
    ],
    content: content || (tag.startsWith("h") ? "<" + tag + ">Heading</" + tag + ">" : "<p></p>"),
    editorProps: {
      attributes: {
        class: "focus:outline-none min-h-[1.5em] [&_p]:mb-1 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      const defaultHtml = tag.startsWith("h") ? "<" + tag + "></" + tag + ">" : "<p></p>";
      editor.commands.setContent(content || defaultHtml, { emitUpdate: false });
    }
  }, [content, tag, editor]);

  const setLink = useCallback(() => {
    const previousUrl = editor?.getAttributes("link").href;
    const url = window.prompt("URL", previousUrl);
    if (url === null) return;
    if (url === "") editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor?.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div className={className} style={style} onClick={onClick}>
      <BubbleMenu
        editor={editor}
        className="flex gap-1 p-1 bg-white border rounded shadow-lg"
      >
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`px-2 py-1 text-xs rounded ${editor.isActive("bold") ? "bg-gray-200" : ""}`}
        >
          Bold
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`px-2 py-1 text-xs rounded ${editor.isActive("italic") ? "bg-gray-200" : ""}`}
        >
          Italic
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`px-2 py-1 text-xs rounded ${editor.isActive("underline") ? "bg-gray-200" : ""}`}
        >
          Underline
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`px-2 py-1 text-xs rounded ${editor.isActive("strike") ? "bg-gray-200" : ""}`}
        >
          Strike
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`px-2 py-1 text-xs rounded ${editor.isActive("bulletList") ? "bg-gray-200" : ""}`}
        >
          List
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`px-2 py-1 text-xs rounded ${editor.isActive("orderedList") ? "bg-gray-200" : ""}`}
        >
          Numbered
        </button>
        <button type="button" onClick={setLink} className="px-2 py-1 text-xs rounded">
          Link
        </button>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  );
}
