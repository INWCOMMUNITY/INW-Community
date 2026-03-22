"use client";

import { getStandaloneGifImageUrl } from "@/lib/message-gif-url";

type MessageBubbleBodyProps = {
  content: string;
  isMe?: boolean;
};

export function MessageBubbleBody({ content, isMe }: MessageBubbleBodyProps) {
  const gifUrl = getStandaloneGifImageUrl(content);
  if (gifUrl) {
    return (
      <img
        src={gifUrl}
        alt=""
        className="max-w-[min(100%,280px)] max-h-[220px] w-auto h-auto rounded-lg object-contain"
        loading="lazy"
      />
    );
  }
  return (
    <p
      className={`text-[15px] whitespace-pre-wrap ${isMe ? "text-white" : "text-[var(--color-heading)]"}`}
    >
      {content}
    </p>
  );
}
