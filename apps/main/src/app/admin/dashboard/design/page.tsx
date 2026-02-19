import { DesignTokensEditor } from "./DesignTokensEditor";

export default function AdminDesignPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Design (Site theme)</h1>
      <p className="text-gray-600 mb-6">
        Edit fonts, colors, font sizes, button design (color, corners, hover effects), line spacing, section padding, and max width. These values are applied site-wide.
      </p>
      <DesignTokensEditor />
    </div>
  );
}
