"use client";

import { useState, useCallback } from "react";
import { IonIcon } from "@/components/IonIcon";

const BAR_COLORS = ["var(--color-primary)", "#c99d5f", "#5fa3c9", "#8bc95f", "#c95f8b"];

type PollOption = { id: string; label: string; voteCount: number };

type PollCardProps = {
  postId: string;
  poll: {
    question: string;
    options: PollOption[];
    totalVotes: number;
    myVote?: string;
  };
};

export function PollCard({ postId, poll: initialPoll }: PollCardProps) {
  const [poll, setPoll] = useState(initialPoll);
  const [voting, setVoting] = useState(false);
  const hasVoted = !!poll.myVote;

  const handleVote = useCallback(
    async (optionId: string) => {
      if (voting || hasVoted) return;
      setVoting(true);
      try {
        const res = await fetch(`/api/posts/${postId}/poll/vote`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ optionId }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data) setPoll(data);
      } finally {
        setVoting(false);
      }
    },
    [postId, voting, hasVoted]
  );

  return (
    <div className="mt-3 rounded-lg border border-[var(--color-primary)]/20 bg-[#faf8f5] p-3">
      <div className="flex items-start gap-2 mb-3">
        <IonIcon name="bar-chart-outline" size={18} className="text-[var(--color-primary)] shrink-0 mt-0.5" />
        <p className="font-semibold text-sm">{poll.question}</p>
      </div>
      <div className="space-y-2">
        {poll.options.map((option, index) => {
          const pct =
            poll.totalVotes > 0 ? Math.round((option.voteCount / poll.totalVotes) * 100) : 0;
          const isMyVote = poll.myVote === option.id;
          const barColor = BAR_COLORS[index % BAR_COLORS.length];

          if (hasVoted) {
            return (
              <div key={option.id} className="relative overflow-hidden rounded-md bg-white/80 px-3 py-2">
                <div
                  className="absolute inset-y-0 left-0 opacity-20"
                  style={{ width: `${pct}%`, backgroundColor: barColor }}
                />
                <div className="relative flex justify-between text-sm">
                  <span className={isMyVote ? "font-semibold" : ""}>{option.label}</span>
                  <span className="text-gray-600 tabular-nums">{pct}%</span>
                </div>
              </div>
            );
          }

          return (
            <button
              key={option.id}
              type="button"
              disabled={voting}
              onClick={() => void handleVote(option.id)}
              className="w-full text-left rounded-md border border-[var(--color-primary)]/30 bg-white px-3 py-2 text-sm hover:bg-[var(--color-section-alt)] disabled:opacity-50"
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-gray-500 mt-2">{poll.totalVotes} vote{poll.totalVotes === 1 ? "" : "s"}</p>
    </div>
  );
}
