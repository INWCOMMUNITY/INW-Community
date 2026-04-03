// Learn more https://docs.expo.io/guides/customizing-metro
const fs = require("fs");
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const stripeWebStub = path.resolve(__dirname, "shims/stripe-react-native-web.js");
const defaultResolveRequest = config.resolver.resolveRequest;

/**
 * Resolve `@/` like tsconfig paths, using this app's directory at bundle time.
 * Babel module-resolver rewrote imports to absolute paths, which broke when Metro
 * ran from another clone (e.g. StudioProjects) or stale cache pointed there.
 */
function resolveAtAlias(moduleName) {
  if (!moduleName.startsWith("@/")) return null;
  const rel = moduleName.slice(2);
  const base = path.resolve(__dirname, rel);
  const extList = config.resolver.sourceExts || ["tsx", "ts", "jsx", "js", "json"];
  const dotted = extList.map((e) => (e.startsWith(".") ? e : `.${e}`));

  for (const ext of dotted) {
    const full = base + ext;
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        return full;
      }
    } catch {
      /* ignore */
    }
  }
  for (const ext of dotted) {
    const indexFile = path.join(base, `index${ext}`);
    try {
      if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
        return indexFile;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isWeb = platform === "web";
  if (isWeb && moduleName === "@stripe/stripe-react-native") {
    return { type: "sourceFile", filePath: stripeWebStub };
  }

  const atFile = resolveAtAlias(moduleName);
  if (atFile) {
    return { type: "sourceFile", filePath: atFile };
  }

  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
