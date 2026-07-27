import { useState, useCallback } from "react";
import { StyleSheet, View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiPost } from "@/lib/api";

interface PollOption {
  id: string;
  label: string;
  voteCount: number;
}

interface PollCardProps {
  postId: string;
  poll: {
    question: string;
    options: PollOption[];
    totalVotes: number;
    myVote?: string;
  };
}

const BAR_COLORS = [
  theme.colors.primary,
  "#c99d5f",
  "#5fa3c9",
  "#8bc95f",
  "#c95f8b",
];

export function PollCard({ postId, poll: initialPoll }: PollCardProps) {
  const [poll, setPoll] = useState(initialPoll);
  const [voting, setVoting] = useState(false);

  const hasVoted = !!poll.myVote;

  const handleVote = useCallback(
    async (optionId: string) => {
      if (voting) return;
      setVoting(true);
      try {
        const result = await apiPost<{
          question: string;
          options: PollOption[];
          totalVotes: number;
          myVote?: string;
        }>(`/api/posts/${postId}/poll/vote`, { optionId });
        setPoll(result);
      } catch {
        // Ignore errors
      } finally {
        setVoting(false);
      }
    },
    [postId, voting]
  );

  return (
    <View style={styles.container}>
      <View style={styles.questionRow}>
        <Ionicons name="bar-chart-outline" size={18} color={theme.colors.primary} />
        <Text style={styles.question}>{poll.question}</Text>
      </View>

      <View style={styles.options}>
        {poll.options.map((option, index) => {
          const pct =
            poll.totalVotes > 0
              ? Math.round((option.voteCount / poll.totalVotes) * 100)
              : 0;
          const isMyVote = poll.myVote === option.id;
          const barColor = BAR_COLORS[index % BAR_COLORS.length];

          if (hasVoted) {
            return (
              <View key={option.id} style={styles.resultRow}>
                <View style={styles.resultLabelRow}>
                  <Text
                    style={[styles.optionLabel, isMyVote && styles.optionLabelActive]}
                  >
                    {option.label}
                    {isMyVote ? " ✓" : ""}
                  </Text>
                  <Text style={styles.pctText}>{pct}%</Text>
                </View>
                <View style={styles.barBg}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${Math.max(pct, 2)}%`,
                        backgroundColor: barColor,
                      },
                    ]}
                  />
                </View>
              </View>
            );
          }

          return (
            <Pressable
              key={option.id}
              style={({ pressed }) => [
                styles.voteButton,
                pressed && styles.voteButtonPressed,
              ]}
              onPress={() => handleVote(option.id)}
              disabled={voting}
            >
              <Text style={styles.voteButtonText}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.totalVotes}>
        {poll.totalVotes} {poll.totalVotes === 1 ? "vote" : "votes"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 14,
    backgroundColor: "#f9f9f9",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  questionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  question: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    flex: 1,
  },
  options: {
    gap: 8,
  },
  voteButton: {
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  voteButtonPressed: {
    backgroundColor: `${theme.colors.primary}15`,
  },
  voteButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  resultRow: {
    gap: 4,
  },
  resultLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
  },
  optionLabelActive: {
    fontWeight: "700",
    color: theme.colors.heading,
  },
  pctText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666",
  },
  barBg: {
    height: 8,
    backgroundColor: "#e5e5e5",
    borderRadius: 4,
    overflow: "hidden",
  },
  barFill: {
    height: 8,
    borderRadius: 4,
  },
  totalVotes: {
    fontSize: 12,
    color: "#888",
    marginTop: 10,
    textAlign: "right",
  },
});
