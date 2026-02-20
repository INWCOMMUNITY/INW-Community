import { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { CALENDAR_TYPES, EVENT_CITIES_FORM, type CalendarType } from "@/lib/calendars";
import { apiPost, apiUploadFile, getToken } from "@/lib/api";

interface PostEventFormProps {
  initialCalendarType?: CalendarType;
  onSuccess?: () => void;
}

function formatDateForApi(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTimeForApi(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDateDisplay(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTimeDisplay(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${ampm}`;
}

const today = new Date();
today.setHours(0, 0, 0, 0);

export function PostEventForm({
  initialCalendarType,
  onSuccess,
}: PostEventFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [dateValue, setDateValue] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [timeValue, setTimeValue] = useState<Date>(() => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return d;
  });
  const [endTimeValue, setEndTimeValue] = useState<Date>(() => {
    const d = new Date();
    d.setHours(17, 0, 0, 0);
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState<"start" | "end" | null>(null);
  const [city, setCity] = useState<string>("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [calendarType, setCalendarType] = useState<CalendarType>(
    initialCalendarType ?? "fun_events"
  );
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState("");

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos to add images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled) return;
    setUploadingPhoto(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) {
        setError("Sign in to upload photos.");
        return;
      }
      for (const asset of result.assets) {
        const formData = new FormData();
        formData.append("file", {
          uri: asset.uri,
          type: asset.mimeType ?? "image/jpeg",
          name: "photo.jpg",
        } as unknown as Blob);
        const { url } = await apiUploadFile("/api/upload/event", formData);
        const base =
          process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
        const siteBase = base.replace(/\/api.*$/, "").replace(/\/$/, "");
        const fullUrl = url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
        setPhotos((p) => (p.includes(fullUrl) ? p : [...p, fullUrl]));
      }
    } catch (e) {
      setError(
        (e as { error?: string }).error ?? "Photo upload failed. Try again."
      );
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removePhoto = (i: number) => {
    setPhotos((p) => p.filter((_, idx) => idx !== i));
  };

  const handleSubmit = async () => {
    setError("");
    if (!title.trim()) {
      setError("Event title is required.");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/api/events", {
        title: title.trim(),
        date: formatDateForApi(dateValue),
        time: formatTimeForApi(timeValue),
        endTime: formatTimeForApi(endTimeValue),
        location: location.trim() || null,
        city: city.trim() || null,
        description: description.trim() || null,
        calendarType,
        photos,
      });
      Alert.alert(
        "Event Posted!",
        "Thanks for posting an event on the Northwest Community Calendar!",
        [
          {
            text: "OK",
            onPress: () => {
              if (onSuccess) onSuccess();
              else router.back();
            },
          },
        ]
      );
    } catch (e) {
      setError(
        (e as { error?: string }).error ?? "Failed to post event. Try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
    >
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.field}>
        <Text style={styles.label}>Event title *</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Enter event title"
          placeholderTextColor={theme.colors.placeholder}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Calendar *</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.pickerScroll}
          contentContainerStyle={styles.pickerRow}
        >
          {CALENDAR_TYPES.map((c) => (
            <Pressable
              key={c.value}
              style={[
                styles.pickerOption,
                calendarType === c.value && styles.pickerOptionSelected,
              ]}
              onPress={() => setCalendarType(c.value as CalendarType)}
            >
              <Text
                style={[
                  styles.pickerOptionText,
                  calendarType === c.value && styles.pickerOptionTextSelected,
                ]}
                numberOfLines={1}
              >
                {c.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>City</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.pickerScroll}
          contentContainerStyle={styles.pickerRow}
        >
          {EVENT_CITIES_FORM.map((c) => (
            <Pressable
              key={c}
              style={[
                styles.pickerOption,
                city === c && styles.pickerOptionSelected,
              ]}
              onPress={() => setCity(c)}
            >
              <Text
                style={[
                  styles.pickerOptionText,
                  city === c && styles.pickerOptionTextSelected,
                ]}
                numberOfLines={1}
              >
                {c}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Date *</Text>
        <Pressable
          style={styles.dateBar}
          onPress={() => {
            if (Platform.OS === "android") {
              DateTimePickerAndroid.open({
                value: dateValue,
                mode: "date",
                minimumDate: today,
                onChange: (event, selectedDate) => {
                  if (event.type === "set" && selectedDate) {
                    setDateValue(selectedDate);
                  }
                },
              });
            } else {
              setShowDatePicker(true);
            }
          }}
        >
          <Text style={styles.dateBarText}>{formatDateDisplay(dateValue)}</Text>
          <Text style={styles.dateBarHint}>Tap to choose</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <View style={[styles.field, styles.half]}>
          <Text style={styles.label}>Start time</Text>
          <Pressable
            style={styles.timeBar}
            onPress={() => setShowTimePicker("start")}
          >
            <Text style={styles.timeBarText}>{formatTimeDisplay(timeValue)}</Text>
          </Pressable>
        </View>
        <View style={[styles.field, styles.half]}>
          <Text style={styles.label}>End time</Text>
          <Pressable
            style={styles.timeBar}
            onPress={() => setShowTimePicker("end")}
          >
            <Text style={styles.timeBarText}>{formatTimeDisplay(endTimeValue)}</Text>
          </Pressable>
        </View>
      </View>

      {Platform.OS === "ios" && showDatePicker && (
        <Modal
          visible={showDatePicker}
          transparent
          animationType="slide"
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setShowDatePicker(false)}
          >
            <Pressable style={styles.pickerModal} onPress={(e) => e.stopPropagation()}>
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="spinner"
                onChange={(_, selectedDate) => {
                  if (selectedDate) setDateValue(selectedDate);
                }}
                minimumDate={today}
                textColor={theme.colors.primary}
              />
              <Pressable
                style={styles.savePickerBtn}
                onPress={() => setShowDatePicker(false)}
              >
                <Text style={styles.savePickerBtnText}>Save</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {showTimePicker && (
        <Modal
          visible={!!showTimePicker}
          transparent
          animationType="slide"
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setShowTimePicker(null)}
          >
            <Pressable style={styles.pickerModal} onPress={(e) => e.stopPropagation()}>
              <DateTimePicker
                value={showTimePicker === "start" ? timeValue : endTimeValue}
                mode="time"
                display="spinner"
                onChange={(_, selectedDate) => {
                  if (selectedDate && showTimePicker === "start") {
                    setTimeValue(selectedDate);
                  } else if (selectedDate && showTimePicker === "end") {
                    setEndTimeValue(selectedDate);
                  }
                }}
                {...(Platform.OS === "ios" && { textColor: theme.colors.primary })}
              />
              <Pressable
                style={styles.savePickerBtn}
                onPress={() => setShowTimePicker(null)}
              >
                <Text style={styles.savePickerBtnText}>Save</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
      <View style={styles.field}>
        <Text style={styles.label}>Location</Text>
        <TextInput
          style={styles.input}
          value={location}
          onChangeText={setLocation}
          placeholder="Event location"
          placeholderTextColor={theme.colors.placeholder}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={description}
          onChangeText={setDescription}
          placeholder="Event description"
          placeholderTextColor={theme.colors.placeholder}
          multiline
          numberOfLines={3}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Photos (optional)</Text>
        <Pressable
          style={[styles.uploadBtn, uploadingPhoto && styles.uploadBtnDisabled]}
          onPress={pickImage}
          disabled={uploadingPhoto}
        >
          <Text style={styles.uploadBtnText}>
            {uploadingPhoto ? "Uploading…" : "Add photos"}
          </Text>
        </Pressable>
        {photos.length > 0 && (
          <View style={styles.photosRow}>
            {photos.map((url, i) => (
              <View key={i} style={styles.photoWrap}>
                <Image
                  source={{ uri: url }}
                  style={styles.photo}
                  resizeMode="cover"
                />
                <Pressable
                  style={styles.removePhoto}
                  onPress={() => removePhoto(i)}
                >
                  <Text style={styles.removePhotoText}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitBtnText}>Post event</Text>
        )}
      </Pressable>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: { padding: 16, paddingBottom: 40 },
  field: { marginBottom: 16 },
  half: { flex: 1 },
  row: { flexDirection: "row", gap: 12 },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 6,
  },
  input: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
    color: theme.colors.text,
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  pickerScroll: { marginHorizontal: -16 },
  pickerRow: { flexDirection: "row", gap: 8, paddingHorizontal: 4 },
  pickerOption: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  pickerOptionSelected: {
    backgroundColor: theme.colors.primary,
  },
  pickerOptionText: {
    fontSize: 13,
    color: theme.colors.heading,
  },
  pickerOptionTextSelected: {
    color: theme.colors.buttonText,
  },
  uploadBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  uploadBtnDisabled: { opacity: 0.6 },
  uploadBtnText: {
    fontSize: 16,
    color: theme.colors.primary,
    fontWeight: "600",
  },
  photosRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  photoWrap: { position: "relative" },
  photo: { width: 64, height: 64, borderRadius: 6 },
  removePhoto: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#c00",
    justifyContent: "center",
    alignItems: "center",
  },
  removePhotoText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  dateBar: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dateBarText: {
    fontSize: 16,
    color: theme.colors.text,
    flex: 1,
  },
  dateBarHint: {
    fontSize: 12,
    color: "#999",
  },
  timeBar: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    padding: 16,
  },
  timeBarText: {
    fontSize: 16,
    color: theme.colors.text,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  pickerModal: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 34,
  },
  savePickerBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  savePickerBtnText: {
    color: theme.colors.buttonText,
    fontSize: 18,
    fontWeight: "600",
  },
  error: { color: "#c00", fontSize: 14, marginBottom: 12 },
  submitBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: {
    color: theme.colors.buttonText,
    fontSize: 18,
    fontWeight: "600",
  },
});
