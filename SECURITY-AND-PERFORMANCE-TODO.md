# Security & Performance – Your Implementation Checklist

Items you need to implement yourself (or with a DevOps/hosting provider). Check off as you complete each one.

---

## Security – Do Before Launch

### 1. Environment & Secrets
- [ ] **Set NEXTAUTH_SECRET** in production (32+ character random string)
  - Generate: `openssl rand -base64 32`
- [ ] **Set ADMIN_CODE** in production and rotate from the default
- [ ] **Confirm .env is never committed** (already in `.gitignore`)
- [ ] **Use different Stripe keys** for production (live keys, not test)

### 2. HTTPS & Headers
- [ ] **HTTPS only** – Ensure your host (Vercel, etc.) uses HTTPS
- [ ] **Add HSTS header** (often handled by host; if self-hosting, add `Strict-Transport-Security: max-age=31536000; includeSubDomains`)
- [ ] **Add production admin origin** to `ADMIN_ORIGINS` in [apps/main/src/middleware.ts](apps/main/src/middleware.ts) when you deploy the admin app

### 3. Database
- [ ] **Use pooled connection** (e.g. Prisma connection pooling for serverless)
- [ ] **Restrict DB access** – Firewall so only app can reach PostgreSQL
- [ ] **Back up the database** regularly

### 4. Monitoring & Alerts
- [ ] **Log failed logins** for review and abuse detection
- [ ] **Set up error monitoring** (e.g. Sentry)
- [ ] **Review rate-limit logs** if using a logging service

---

## Performance – Implement When Possible

### 5. Rate Limiting (Production Grade)
- [ ] **Replace in-memory rate limit** with Redis (e.g. Upstash)
  - Current: [apps/main/src/lib/rate-limit.ts](apps/main/src/lib/rate-limit.ts) – works per instance only
  - Use `@upstash/ratelimit` for multi-instance protection

### 6. Images & Assets
- [x] **Convert `<img>` to `next/image`** in FeedPostCard and BlogCard ✓ (implemented)
- [ ] **Convert remaining `<img>` to `next/image`** in other high-traffic components (e.g. member profile pages, storefront cards, business listings)
- [ ] **Add `priority`** to above-the-fold hero image if it becomes an `<Image>`
- [ ] **Preload critical fonts** if needed (Fahkwang is already using `display: swap`)

### 7. API Performance
- [x] **Optimize feed API** – Batched Prisma calls with `Promise.all` ✓ (implemented)
- [x] **Add response caching** for blog categories API (Cache-Control: s-maxage=60) ✓ (implemented)
- [ ] **Add response caching** for other public endpoints (e.g. design tokens, business listings)
- [ ] **Use database indexes** – Review slow queries and add indexes as needed

### 8. Build & Bundles
- [x] **Code-split editor** – BlockEditor dynamically imported on /editor page ✓ (implemented)
- [ ] **Code-split PDF-related code** – Load on demand when user accesses PDF features
- [ ] **Review bundle size** – `pnpm run build` shows First Load JS; trim large dependencies if possible

---

## Optional Security Enhancements

### 9. CAPTCHA
- [ ] **Add CAPTCHA to NWC Requests form** to reduce spam
- [ ] **Consider CAPTCHA on signup** if you see abuse

### 10. Password Policy
- [ ] **Optional: Stronger password rules** (e.g. 1 uppercase, 1 number)
- [ ] **Optional: Password breach check** via HaveIBeenPwned API on signup

### 11. Session & Cookies
- [ ] **Verify secure cookies** – In production with `NEXTAUTH_URL=https://...`, NextAuth uses secure cookies automatically
- [ ] **Optional: Shorter session max age** in [apps/main/src/lib/auth.ts](apps/main/src/lib/auth.ts) if you want sessions to expire sooner

### 12. Security Scans
- [ ] **Run `pnpm audit`** periodically and address critical/high issues
- [ ] **Run OWASP ZAP** or similar for a basic penetration test
- [ ] **Review dependency updates** before upgrading

### 13. Dependency Vulnerabilities (as of last audit)
- [ ] **Upgrade Next.js** to 15.0.8+ (or 15.5.10+ for Image Optimizer fix) – addresses DoS vulnerabilities
- [ ] **Upgrade glob** (via eslint-config-next) – command injection in glob CLI
- [ ] **Upgrade undici** (via @vercel/blob) – decompression exhaustion; may require Vercel blob update

---

### 14. Future Speed Improvements (To Implement)

- [ ] **CDN/Edge caching** – Use Vercel Edge or a CDN for static assets and API responses
- [ ] **Image optimization at source** – Store images in WebP/AVIF where possible; use responsive srcset
- [ ] **Reduce third-party scripts** – Defer or lazy-load analytics, chat widgets, etc.
- [ ] **Lazy-load below-fold components** – SideCart, TagsSidebar, etc. with `next/dynamic`
- [ ] **Service Worker / PWA** – Cache static assets for repeat visits
- [ ] **Database connection pooling** – Use PgBouncer or Prisma Data Proxy for serverless

---

## Already Implemented (No Action Needed)

- .env in `.gitignore`
- Security headers (X-Frame-Options, X-XSS-Protection, CSP, etc.)
- HTML sanitization (DOMPurify) for blog and site content
- ADMIN_CODE required (no fallback)
- Rate limiting on NWC Requests (5/min per IP)
- Rate limiting on Signup (5/min per IP)
- Rate limiting on Login (10/min per IP)
- Password hashing with bcrypt
- Stripe webhook signature verification
- Sensitive fields excluded from API responses (Prisma `select`)
- FeedPostCard & BlogCard use `next/image` for optimized loading
- Feed API batched with `Promise.all` for faster responses
- Blog categories API cached (s-maxage=60)
- Editor page uses dynamic import for BlockEditor
