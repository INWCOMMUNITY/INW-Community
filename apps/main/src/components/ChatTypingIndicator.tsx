"use client";

export type ChatTypingPeer = {
  id: string;
  name: string;
  photoUrl: string | null;
};

/**
 * Avatar stack + three bouncing dots (iMessage-style typing).
 */
export function ChatTypingIndicator({ peers }: { peers: ChatTypingPeer[] }) {
  if (peers.length === 0) return null;

  const label =
    peers.length === 1
      ? `${peers[0].name} is actively typing`
      : `${peers.length} people are actively typing`;

  return (
    <div
      className="flex items-end gap-2 px-4 py-2 border-b border-gray-100 shrink-0 bg-gray-50"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div className="flex shrink-0 -space-x-2">
        {peers.slice(0, 3).map((p) => (
          <div
            key={p.id}
            className="relative w-9 h-9 rounded-full border-2 border-white overflow-hidden bg-[var(--color-section-alt)] flex items-center justify-center text-xs font-bold text-gray-500 ring-1 ring-black/10"
            title={`${p.name} is typing`}
          >
            {p.photoUrl ? (
              <img src={p.photoUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span>{p.name.trim().charAt(0) || "?"}</span>
            )}
          </div>
        ))}
      </div>
      <div
        className="flex items-center gap-1.5 px-3 py-2 rounded-2xl border-2 border-black/10 min-h-[40px]"
        style={{ backgroundColor: "var(--color-section-alt)" }}
      >
        <span
          className="w-2.5 h-2.5 rounded-full bg-gray-600 animate-bounce [animation-duration:520ms]"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="w-2.5 h-2.5 rounded-full bg-gray-600 animate-bounce [animation-duration:520ms]"
          style={{ animationDelay: "160ms" }}
        />
        <span
          className="w-2.5 h-2.5 rounded-full bg-gray-600 animate-bounce [animation-duration:520ms]"
          style={{ animationDelay: "320ms" }}
        />
      </div>
    </div>
  );
}
