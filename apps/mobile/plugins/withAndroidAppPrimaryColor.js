/**
 * Sets AppTheme colorPrimary / colorAccent so Material date/time pickers (and other Material
 * widgets) use brand green. The datetimepicker plugin themes dialog-specific styles; Material
 * pickers also read the activity theme's colorPrimary.
 *
 * Applies after `npx expo prebuild` or EAS Build — not in Expo Go's prebuilt binary.
 */
const { withAndroidStyles, withAndroidColors, AndroidConfig } = require("expo/config-plugins");

const COLOR_RESOURCE = "inw_primary";
const PRIMARY_HEX = "#505542";

function withAndroidAppPrimaryColor(config) {
  const { assignStylesValue, getAppThemeGroup } = AndroidConfig.Styles;
  const { assignColorValue } = AndroidConfig.Colors;

  config = withAndroidColors(config, (c) => {
    c.modResults = assignColorValue(c.modResults, {
      name: COLOR_RESOURCE,
      value: PRIMARY_HEX,
    });
    return c;
  });

  config = withAndroidStyles(config, (c) => {
    c.modResults = assignStylesValue(c.modResults, {
      add: true,
      parent: getAppThemeGroup(),
      name: "colorPrimary",
      value: `@color/${COLOR_RESOURCE}`,
    });
    c.modResults = assignStylesValue(c.modResults, {
      add: true,
      parent: getAppThemeGroup(),
      name: "colorAccent",
      value: `@color/${COLOR_RESOURCE}`,
    });
    return c;
  });

  return config;
}

module.exports = withAndroidAppPrimaryColor;
