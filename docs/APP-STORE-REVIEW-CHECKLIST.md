# App Store Connect review checklist (INW Community)

Use this before submitting a build for App Review. Apple’s decisions are final; this list reduces common rejection causes.

## Account and authentication

- **Sign-in required:** Provide a demo account in App Review Notes (email + password) if reviewers cannot use Sign in with Apple or public signup.
- **Account deletion:** The app exposes account deletion under Profile → Delete account (`apps/mobile/app/profile-edit.tsx`). Ensure the flow completes against production and matches your privacy disclosures.

## Privacy and data

- **Privacy Policy:** Linked from the app (e.g. Profile menu, auth screens). Keep the live URL and in-app copy aligned with [`apps/main` privacy content](apps/main/src/app/privacy/page.tsx) when you change data practices.
- **App Privacy (nutrition labels):** In App Store Connect, declare data collected (e.g. contact info, photos, location if used) to match actual SDK and API usage. Update when you add analytics, push, or new permissions.

## Payments and external flows

- **Physical goods / services:** Seller shipping labels and Shippo run in an in-app WebView to the website; Stripe is used for subscriptions and checkout. Ensure metadata and review notes describe that some seller actions open the website—no surprise for reviewers.
- **IAP vs web:** Do not use the web flow to sell digital content or features that must use In-App Purchase under App Store rules. Current flows are for memberships, physical shipping, and account management as implemented.

## Permissions

- Confirm [`apps/mobile/app.json`](apps/mobile/app.json) usage strings (camera, notifications, etc.) match real behavior.

## Encryption export compliance

- `ITSAppUsesNonExemptEncryption` is set in `app.json`. Confirm with your legal/compliance stance (standard HTTPS-only often uses exempt encryption).

## Stability

- Smoke-test on a release build: sign-in, feed, messages, seller hub, **WebView seller flows** (labels after this launch work), and GIF picker (requires `GIPHY_API_KEY` on the main site).

## Metadata

- Screenshots and description should reflect the current UI. Mention that seller shipping may use an in-app browser if that remains true.

## Optional improvements

- **Associated Domains / Universal Links:** Not required for review if `inwcommunity://` deep links work; consider later for smoother `https://` → app handoff.
