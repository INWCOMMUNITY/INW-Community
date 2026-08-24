import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
} from "react-native";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

export interface ListingTemplate {
  id: string;
  name: string;
  category?: string | null;
  subcategory?: string | null;
  condition?: string | null;
  shippingDisabled?: boolean;
  localDeliveryAvailable?: boolean;
  inStorePickupAvailable?: boolean;
  shippingCostCents?: number | null;
  shippingOptionId?: string | null;
  localDeliveryFeeCents?: number | null;
  shippingPolicy?: string | null;
  localDeliveryTerms?: string | null;
  pickupTerms?: string | null;
  etsyWhoMade?: string | null;
  etsyWhenMade?: string | null;
  etsyIsSupply?: boolean | null;
  ebayCategoryId?: number | null;
  ebayAspects?: { name: string; value: string }[] | null;
  variantsTemplate?: { axes?: { name: string; options: string[] }[] } | null;
  createdAt?: string;
  updatedAt?: string;
}

interface TemplateSelectorProps {
  onSelectTemplate: (template: ListingTemplate) => void;
  disabled?: boolean;
  currentStoreItemId?: string;
}

export function TemplateSelector({
  onSelectTemplate,
  disabled,
  currentStoreItemId,
}: TemplateSelectorProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [templates, setTemplates] = useState<ListingTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ templates: ListingTemplate[] }>("/api/listing-templates");
      setTemplates(data.templates || []);
    } catch (e) {
      setError("Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (modalVisible) {
      fetchTemplates();
    }
  }, [modalVisible, fetchTemplates]);

  const handleSelect = (template: ListingTemplate) => {
    setModalVisible(false);
    onSelectTemplate(template);
  };

  const handleDelete = async (templateId: string, templateName: string) => {
    Alert.alert("Delete Template", `Are you sure you want to delete "${templateName}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await apiDelete(`/api/listing-templates/${templateId}`);
            setTemplates((prev) => prev.filter((t) => t.id !== templateId));
          } catch {
            Alert.alert("Error", "Failed to delete template");
          }
        },
      },
    ]);
  };

  return (
    <>
      <Pressable
        style={({ pressed }) => [
          styles.templateButton,
          pressed && { opacity: 0.8 },
          disabled && styles.templateButtonDisabled,
        ]}
        onPress={() => setModalVisible(true)}
        disabled={disabled}
      >
        <Text style={styles.templateButtonText}>Start from Template</Text>
      </Pressable>

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Listing Templates</Text>
            <Pressable onPress={() => setModalVisible(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Done</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={styles.loadingText}>Loading templates...</Text>
            </View>
          ) : error ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable style={styles.retryButton} onPress={fetchTemplates}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : templates.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No templates yet</Text>
              <Text style={styles.emptyText}>
                Save a listing as a template to reuse its settings for future items.
              </Text>
            </View>
          ) : (
            <ScrollView style={styles.templateList} contentContainerStyle={styles.templateListContent}>
              {templates.map((template) => (
                <View key={template.id} style={styles.templateCard}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.templateCardContent,
                      pressed && { backgroundColor: "#f0f0f0" },
                    ]}
                    onPress={() => handleSelect(template)}
                  >
                    <Text style={styles.templateName}>{template.name}</Text>
                    <View style={styles.templateDetails}>
                      {template.category && (
                        <Text style={styles.templateDetail}>
                          Category: {template.category}
                          {template.subcategory ? ` / ${template.subcategory}` : ""}
                        </Text>
                      )}
                      {template.condition && (
                        <Text style={styles.templateDetail}>
                          Condition: {template.condition === "new" ? "New" : "Used"}
                        </Text>
                      )}
                      {template.etsyWhoMade && (
                        <Text style={styles.templateDetail}>Etsy fields included</Text>
                      )}
                      {template.ebayCategoryId && (
                        <Text style={styles.templateDetail}>eBay category included</Text>
                      )}
                    </View>
                  </Pressable>
                  <Pressable
                    style={styles.deleteButton}
                    onPress={() => handleDelete(template.id, template.name)}
                  >
                    <Text style={styles.deleteButtonText}>Delete</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </>
  );
}

interface SaveTemplateButtonProps {
  storeItemId: string;
  onSaved?: () => void;
}

export function SaveTemplateButton({ storeItemId, onSaved }: SaveTemplateButtonProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!templateName.trim()) {
      setError("Template name is required");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await apiPost(`/api/listing-templates/from-item/${storeItemId}`, {
        name: templateName.trim(),
      });
      setModalVisible(false);
      setTemplateName("");
      Alert.alert("Success", "Template saved successfully!");
      onSaved?.();
    } catch (e) {
      setError((e as { error?: string })?.error || "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.saveTemplateButton, pressed && { opacity: 0.8 }]}
        onPress={() => setModalVisible(true)}
      >
        <Text style={styles.saveTemplateButtonText}>Save as Template</Text>
      </Pressable>

      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.saveModalOverlay}>
          <View style={styles.saveModalCard}>
            <Text style={styles.saveModalTitle}>Save as Template</Text>
            <Text style={styles.saveModalSubtitle}>
              Save this listing's settings to quickly create similar items in the future.
            </Text>

            <TextInput
              style={styles.saveModalInput}
              placeholder="Template name"
              placeholderTextColor="#999"
              value={templateName}
              onChangeText={setTemplateName}
              maxLength={100}
            />

            {error && <Text style={styles.saveModalError}>{error}</Text>}

            <View style={styles.saveModalButtons}>
              <Pressable
                style={[styles.saveModalButton, styles.saveModalButtonCancel]}
                onPress={() => {
                  setModalVisible(false);
                  setTemplateName("");
                  setError(null);
                }}
              >
                <Text style={styles.saveModalButtonCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.saveModalButton, styles.saveModalButtonSave, saving && { opacity: 0.5 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveModalButtonSaveText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  templateButton: {
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    marginBottom: 16,
    backgroundColor: "#fff",
  },
  templateButtonDisabled: {
    opacity: 0.5,
  },
  templateButtonText: {
    color: theme.colors.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#000",
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: "600",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    color: "#666",
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  errorText: {
    color: "#c62828",
    fontSize: 14,
    marginBottom: 16,
  },
  retryButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 8,
  },
  retryButtonText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
  },
  templateList: {
    flex: 1,
  },
  templateListContent: {
    padding: 16,
    gap: 12,
  },
  templateCard: {
    flexDirection: "row",
    alignItems: "stretch",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  templateCardContent: {
    flex: 1,
    padding: 16,
  },
  templateName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
    marginBottom: 6,
  },
  templateDetails: {
    gap: 2,
  },
  templateDetail: {
    fontSize: 13,
    color: "#666",
  },
  deleteButton: {
    justifyContent: "center",
    paddingHorizontal: 16,
    borderLeftWidth: 1,
    borderLeftColor: "#eee",
  },
  deleteButtonText: {
    color: "#c62828",
    fontSize: 13,
    fontWeight: "600",
  },
  saveTemplateButton: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  saveTemplateButtonText: {
    color: "#333",
    fontSize: 14,
    fontWeight: "600",
  },
  saveModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  saveModalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 340,
  },
  saveModalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#000",
    marginBottom: 8,
  },
  saveModalSubtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
    lineHeight: 20,
  },
  saveModalInput: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
    color: "#000",
  },
  saveModalError: {
    color: "#c62828",
    fontSize: 13,
    marginBottom: 12,
  },
  saveModalButtons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  saveModalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  saveModalButtonCancel: {
    borderWidth: 1,
    borderColor: "#ccc",
  },
  saveModalButtonCancelText: {
    color: "#333",
    fontSize: 15,
    fontWeight: "600",
  },
  saveModalButtonSave: {
    backgroundColor: theme.colors.primary,
  },
  saveModalButtonSaveText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
