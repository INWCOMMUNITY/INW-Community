const path = require("path");

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "module-resolver",
        {
          root: [path.resolve(__dirname)],
          alias: { "@": path.resolve(__dirname) },
          extensions: [".ios.js", ".android.js", ".js", ".jsx", ".json", ".tsx", ".ts"],
        },
      ],
      "react-native-reanimated/plugin",
    ],
  };
};
