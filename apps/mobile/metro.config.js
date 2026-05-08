// Learn more https://docs.expo.io/guides/customizing-metro
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const { getDefaultConfig } = require("expo/metro-config");

const requireFromMobile = createRequire(path.join(__dirname, "package.json"));

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

/** Monorepo root (…/INW Community). Helps Metro + pnpm find linked packages. */
const workspaceRoot = path.resolve(__dirname, "../..");
const mobileNodeModules = path.resolve(__dirname, "node_modules");
const rootNodeModules = path.resolve(workspaceRoot, "node_modules");
const watchExtra = [workspaceRoot, rootNodeModules].filter(
  (p, i, a) => a.indexOf(p) === i && !config.watchFolders?.includes(p)
);
if (watchExtra.length) {
  config.watchFolders = [...(config.watchFolders ?? []), ...watchExtra];
}
config.resolver.nodeModulesPaths = [
  mobileNodeModules,
  rootNodeModules,
  ...(config.resolver.nodeModulesPaths ?? []),
];

const stripeWebStub = path.resolve(__dirname, "shims/stripe-react-native-web.js");
const defaultResolveRequest = config.resolver.resolveRequest;

/** Resolve `expo-calendar` entry via Node (pnpm-safe); fallback to direct path. */
function resolveExpoCalendarSourceFile() {
  try {
    const resolved = requireFromMobile.resolve("expo-calendar");
    if (resolved && fs.existsSync(resolved)) return resolved;
  } catch {
    /* ignore */
  }
  const main = path.join(mobileNodeModules, "expo-calendar", "build", "Calendar.js");
  try {
    if (fs.existsSync(main) && fs.statSync(main).isFile()) return main;
  } catch {
    /* ignore */
  }
  return null;
}

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

  if (moduleName === "expo-calendar") {
    const calendarMain = resolveExpoCalendarSourceFile();
    if (calendarMain) {
      return { type: "sourceFile", filePath: calendarMain };
    }
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
