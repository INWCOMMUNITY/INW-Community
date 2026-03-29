"use client";

import type { ChatTypingPeer } from "@/components/ChatTypingIndicator";

/**
 * Small avatars for peers currently viewing the thread, next to optional "Seen" label.
 */
export function ChatSeenPresenceRow({
  showSeen,
  peers,
}: {
  showSeen: boolean;
  peers: ChatTypingPeer[];
}) {
  if (!showSeen && peers.length === 0) return null;

  return (
    <div className="flex items-center justify-end gap-2 pr-1 pt-1 flex-wrap">
      {peers.map((p) => (
        <div
          key={p.id}
          className="w-6 h-6 rounded-full border-2 border-white shadow shrink-0 overflow-hidden bg-gray-200 ring-1 ring-black/10"
          title={`${p.name} is in this chat`}
        >
          {p.photoUrl ? (
            <img src={p.photoUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-[10px] font-bold flex items-center justify-center w-full h-full text-gray-600">
              {(p.name.trim()[0] || "?").toUpperCase()}
            </span>
          )}
        </div>
      ))}
      {showSeen && <span className="text-xs text-gray-400">Seen</span>}
    </div>
  );
}
