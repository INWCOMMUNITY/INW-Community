import { theme } from "@/lib/theme";

/**
 * Runtime props for @react-native-community/datetimepicker on Android (dialog action buttons).
 *
 * Calendar / clock **accent** colors need native theme resources: `app.json` datetimepicker plugin,
 * `./plugins/withAndroidAppPrimaryColor.js`, and a **dev client or release build** after
 * `expo prebuild` — they do **not** apply inside Expo Go’s generic binary.
 */
export const androidDateTimePickerThemeProps = {
  positiveButton: { textColor: theme.colors.primary },
  negativeButton: { textColor: theme.colors.primary },
} as const;
