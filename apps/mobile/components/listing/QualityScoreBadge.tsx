import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Modal,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

interface ScoreBreakdown {
  score: number;
  max: number;
  tips: string[];
}

interface QualityScoreData {
  overall: number;
  grade: "A" | "B" | "C" | "D" | "F";
  breakdown: {
    title: ScoreBreakdown;
    description: ScoreBreakdown;
    photos: ScoreBreakdown;
    pricing: ScoreBreakdown;
    completeness: ScoreBreakdown;
  };
  topIssues: string[];
}

interface Props {
  storeItemId: string;
  compact?: boolean;
  onScoreLoaded?: (score: QualityScoreData) => void;
}

function getGradeColor(grade: string): string {
  switch (grade) {
    case "A":
      return "#22c55e";
    case "B":
      return "#84cc16";
    case "C":
      return "#eab308";
    case "D":
      return "#f97316";
    case "F":
      return "#ef4444";
    default:
      return "#9ca3af";
  }
}

function getScoreBarColor(score: number, max: number): string {
  const ratio = score / max;
  if (ratio >= 0.8) return "#22c55e";
  if (ratio >= 0.6) return "#84cc16";
  if (ratio >= 0.4) return "#eab308";
  return "#ef4444";
}

export function QualityScoreBadge({ storeItemId, compact = false, onScoreLoaded }: Props) {
  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState<QualityScoreData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function fetchScore() {
      try {
        const data = await apiGet<QualityScoreData>(
          `/api/store-items/${storeItemId}/quality-score?analyzePhotos=true`
        );
        if (mounted) {
          setScore(data);
          onScoreLoaded?.(data);
        }
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchScore();

    return () => {
      mounted = false;
    };
  }, [storeItemId, onScoreLoaded]);

  if (loading) {
    return (
      <View style={[styles.badge, compact && styles.badgeCompact]}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  }

  if (error || !score) {
    return null;
  }

  const gradeColor = getGradeColor(score.grade);

  if (compact) {
    return (
      <Pressable
        style={[styles.badge, styles.badgeCompact, { borderColor: gradeColor }]}
        onPress={() => setModalVisible(true)}
      >
        <Text style={[styles.gradeText, styles.gradeTextCompact, { color: gradeColor }]}>
          {score.grade}
        </Text>
        <Text style={styles.scoreTextCompact}>{score.overall}/100</Text>
      </Pressable>
    );
  }

  return (
    <>
      <Pressable
        style={[styles.badge, { borderColor: gradeColor }]}
        onPress={() => setModalVisible(true)}
      >
        <View style={styles.badgeHeader}>
          <View style={[styles.gradeCircle, { backgroundColor: gradeColor }]}>
            <Text style={styles.gradeText}>{score.grade}</Text>
          </View>
          <View style={styles.badgeInfo}>
            <Text style={styles.badgeTitle}>Quality Score</Text>
            <Text style={styles.scoreText}>{score.overall}/100</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#999" />
        </View>
        {score.topIssues.length > 0 && (
          <View style={styles.tipsPreview}>
            <Text style={styles.tipPreviewText} numberOfLines={1}>
              {score.topIssues[0]}
            </Text>
          </View>
        )}
      </Pressable>

      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Quality Score Details</Text>
            <Pressable onPress={() => setModalVisible(false)} hitSlop={8}>
              <Ionicons name="close" size={24} color="#333" />
            </Pressable>
          </View>
          <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentInner}>
            {/* Overall Score */}
            <View style={styles.overallSection}>
              <View style={[styles.gradeCircleLarge, { backgroundColor: gradeColor }]}>
                <Text style={styles.gradeTextLarge}>{score.grade}</Text>
              </View>
              <Text style={styles.overallScore}>{score.overall}/100</Text>
              <Text style={styles.overallLabel}>Overall Quality</Text>
            </View>

            {/* Breakdown */}
            <View style={styles.breakdownSection}>
              <Text style={styles.sectionTitle}>Score Breakdown</Text>
              {Object.entries(score.breakdown).map(([key, data]) => (
                <View key={key} style={styles.breakdownItem}>
                  <View style={styles.breakdownHeader}>
                    <Text style={styles.breakdownLabel}>
                      {key.charAt(0).toUpperCase() + key.slice(1)}
                    </Text>
                    <Text style={styles.breakdownScore}>
                      {data.score}/{data.max}
                    </Text>
                  </View>
                  <View style={styles.breakdownBarBg}>
                    <View
                      style={[
                        styles.breakdownBarFill,
                        {
                          width: `${(data.score / data.max) * 100}%`,
                          backgroundColor: getScoreBarColor(data.score, data.max),
                        },
                      ]}
                    />
                  </View>
                  {data.tips.length > 0 && (
                    <View style={styles.tipsList}>
                      {data.tips.map((tip, i) => (
                        <View key={i} style={styles.tipItem}>
                          <Ionicons
                            name="alert-circle-outline"
                            size={14}
                            color="#f59e0b"
                            style={styles.tipIcon}
                          />
                          <Text style={styles.tipText}>{tip}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 2,
    padding: 12,
    marginBottom: 12,
  },
  badgeCompact: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 0,
  },
  badgeHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  gradeCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  gradeText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  gradeTextCompact: {
    fontSize: 14,
    marginRight: 6,
  },
  badgeInfo: {
    flex: 1,
    marginLeft: 12,
  },
  badgeTitle: {
    fontSize: 12,
    color: "#666",
    marginBottom: 2,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#222",
  },
  scoreTextCompact: {
    fontSize: 12,
    color: "#666",
  },
  tipsPreview: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  tipPreviewText: {
    fontSize: 13,
    color: "#666",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#222",
  },
  modalContent: {
    flex: 1,
  },
  modalContentInner: {
    padding: 16,
    paddingBottom: 32,
  },
  overallSection: {
    alignItems: "center",
    paddingVertical: 24,
    marginBottom: 16,
  },
  gradeCircleLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  gradeTextLarge: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "700",
  },
  overallScore: {
    fontSize: 28,
    fontWeight: "700",
    color: "#222",
  },
  overallLabel: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  breakdownSection: {
    gap: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#222",
    marginBottom: 8,
  },
  breakdownItem: {
    backgroundColor: "#f9f9f9",
    borderRadius: 12,
    padding: 12,
  },
  breakdownHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  breakdownLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  breakdownScore: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
  },
  breakdownBarBg: {
    height: 6,
    backgroundColor: "#e5e5e5",
    borderRadius: 3,
    overflow: "hidden",
  },
  breakdownBarFill: {
    height: "100%",
    borderRadius: 3,
  },
  tipsList: {
    marginTop: 10,
    gap: 6,
  },
  tipItem: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  tipIcon: {
    marginRight: 6,
    marginTop: 1,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    color: "#666",
    lineHeight: 18,
  },
});
