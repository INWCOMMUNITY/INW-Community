const path = require("path");
const fs = require("fs");
const { PrismaPlugin } = require("@prisma/nextjs-monorepo-workaround-plugin");

// Load root .env so DATABASE_URL is always available when running from monorepo root
const rootEnv = path.join(__dirname, "..", "..", ".env");
if (fs.existsSync(rootEnv)) {
  const content = fs.readFileSync(rootEnv, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["database", "design-tokens", "types"],
  experimental: {
    outputFileTracingRoot: path.join(__dirname, "../../"),
  },
  async redirects() {
    return [
      { source: "/community", destination: "/my-community", permanent: true },
      { source: "/community/feed", destination: "/my-community", permanent: true },
      { source: "/community/my-page", destination: "/my-community/my-page", permanent: true },
      { source: "/community/profile", destination: "/my-community/profile", permanent: true },
      { source: "/community/friends", destination: "/my-community/friends", permanent: true },
      { source: "/community/groups", destination: "/my-community/groups", permanent: true },
      { source: "/community/tags", destination: "/my-community/tags", permanent: true },
      { source: "/community/businesses", destination: "/my-community/businesses", permanent: true },
      { source: "/community/events", destination: "/my-community/local-events", permanent: true },
      { source: "/community/events/:type", destination: "/my-community/local-events/:type", permanent: true },
      { source: "/community/post-event", destination: "/my-community/post-event", permanent: true },
      { source: "/community/feed/new", destination: "/my-community/feed/new", permanent: true },
      { source: "/my-community/following", destination: "/my-community/friends", permanent: true },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
    // Sharp uses Lanczos3 by default. Larger sizes for retina/high-DPI (2x, 3x).
    // imageSizes must be < smallest deviceSize (640)
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 2560, 3840, 5760, 7680],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384, 512],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://hooks.stripe.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https: http:",
              "connect-src 'self' https://api.stripe.com https://*.stripe.com https://static.wixstatic.com https://hooks.stripe.com",
              "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
            ].join("; "),
          },
        ],
      },
    ];
  },
  // Use memory cache in dev to avoid filesystem cache corruption on Windows
  // (fixes "Cannot find module './xxxx.js'", 404 on chunks, "It is not loading")
  webpack: (config, { dev, isServer }) => {
    if (dev) config.cache = { type: "memory" };
    if (isServer) {
      config.plugins = [...(config.plugins || []), new PrismaPlugin()];
    }
    return config;
  },
};

module.exports = nextConfig;
