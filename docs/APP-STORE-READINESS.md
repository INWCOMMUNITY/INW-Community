# App Store Review Guidelines – Readiness Checklist

This document maps the [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) to the INW Community mobile app and lists what’s done and what you must do at submit time.

---

## Before You Submit (Apple’s checklist)

| Requirement | Status | Notes |
|-------------|--------|--------|
| Test for crashes and bugs | ✅ Your responsibility | Run on device; fix any known issues before submit. |
| Complete, accurate app info and metadata | ⚠️ At submit | Fill in App Store Connect: description, keywords, screenshots, preview, age rating. |
| Update contact information for App Review | ⚠️ At submit | In App Store Connect set **Support URL** (e.g. `https://www.inwcommunity.com/support-nwc`) and ensure contact info is reachable. |
| Provide demo account or demo mode | ⚠️ At submit | In **App Review Notes** provide a test account (email + password) so reviewers can sign in. Turn on backend during review. |
| Backend services live during review | ✅ Your responsibility | Ensure API and site are up when the app is in review. |
| Explain non-obvious features / IAP in review notes | ⚠️ At submit | Describe subscriptions (Resident/Business/Seller), storefront checkout, resale, points, and any paywalled features. |

---

## 1. Safety

| Guideline | Requirement | App status |
|-----------|-------------|------------|
| **1.2 User-generated content** | Filtering, report, block, contact info | ✅ Report (posts, comments, events, messages); block user; `/api/reports`, `/api/members/block`. |
| **1.2** | Published contact so users can reach you | ✅ **Support & Contact** in Profile → Legal opens support-nwc. Ensure the site has clear contact (email/form). |
| **1.5 Developer information** | Support URL + easy way to contact | ✅ In-app: Profile → Legal → **Email support** (donivan@pnwcommunity.com), **Support & Contact** page. In App Store Connect: set Support URL (e.g. mailto:donivan@pnwcommunity.com or your support page). |
| **1.6 Data security** | Handle user data appropriately | ✅ Auth via your API; no obvious leaks. Keep API and env secure. |

---

## 2. Performance

| Guideline | Requirement | App status |
|-----------|-------------|------------|
| **2.1 App completeness** | No placeholders; tested; demo account if login | ✅ No placeholder content in code. Provide demo account in App Review notes. |
| **2.3 Accurate metadata** | Description, screenshots, privacy, age rating match app | ⚠️ At submit: set in App Store Connect; keep updated. |
| **2.3.1** | No hidden/undocumented features | ✅ App behavior matches described features. |
| **2.3.6** | Age rating answered honestly | ⚠️ At submit: answer questionnaire in Connect (likely 4+ or 12+). |
| **2.5** | Public APIs, no downloading code to change app | ✅ Standard Expo/React Native; no runtime code download. |

---

## 3. Business

| Guideline | Requirement | App status |
|-----------|-------------|------------|
| **3.1.3(e) Goods outside the app** | Physical goods may use payment other than IAP | ✅ Storefront/resale use Stripe (Apple Pay, card). No IAP for physical items. |
| **3.1.1 In-app purchase** | Unlocking features in the app generally requires IAP | ⚠️ **Subscriptions** (Resident/Business/Seller) currently use Stripe via web/redirect. If Apple treats these as “unlocking features within the app,” they may require IAP. Many community/membership apps use external billing; be prepared to explain in review notes or to add IAP if requested. |

---

## 4. Design

| Guideline | Requirement | App status |
|-----------|-------------|------------|
| **4.2 Minimum functionality** | Not just a repackaged website | ✅ Native flows (feed, messages, cart, seller hub, etc.); WebView only where appropriate (terms, privacy, support). |
| **4.8 Sign in with Apple** | If you offer third-party social login, also offer Apple | ✅ App uses **email/password only** (no Google/Facebook in app). Sign in with Apple not required. |
| **4.9 Apple Pay** | If used, disclose before sale and use correctly | ✅ Stripe Payment Sheet with Apple Pay; purchase info shown before payment. |

---

## 5. Legal

| Guideline | Requirement | App status |
|-----------|-------------|------------|
| **5.1.1(i) Privacy policy** | Link in App Store Connect **and** in app, easily accessible | ✅ In app: Login (Terms/Privacy), signup flows, Profile → Legal (Terms, Privacy). ⚠️ In Connect: set Privacy Policy URL. |
| **5.1.1(v) Account deletion** | If account creation, offer account deletion in the app | ✅ Profile → Edit Profile → “Delete account” with confirmation; calls `POST /api/me/delete`. |
| **5.6.1 App Store reviews** | Use system API for review prompt; no custom “rate us” that bypasses it | ✅ No custom review prompt in app. If you add one later, use `expo-store-review`’s `StoreReview.requestReview()`. |

---

## Code / config changes made for readiness

- **Support & Contact in app:** Profile side menu → Legal section now includes **Support & Contact** (opens support-nwc) so users and reviewers can reach you (Guidelines 1.2, 1.5).

---

## What to do in App Store Connect when submitting

1. **App information**  
   - **Support URL:** e.g. `https://www.inwcommunity.com/support-nwc` or `mailto:donivan@pnwcommunity.com`. Contact email in app: **donivan@pnwcommunity.com** (Profile → Legal → Email support).  
   - **Privacy Policy URL:** e.g. `https://www.inwcommunity.com/privacy`.

2. **App Review notes**  
   - Demo account: email + password for a Resident (and optionally Business/Seller) so reviewers can sign in.  
   - Short description of main features: feed, messages, storefront, resale, subscriptions, points, seller hub.  
   - If asked about subscriptions: they support the community and unlock features; payments are processed via your website/Stripe.

3. **Age rating**  
   - Complete the questionnaire (content is community/commerce; choose the appropriate rating, e.g. 4+ or 12+).

4. **Screenshots & preview**  
   - Per 2.3.3/2.3.4: show the app in use on device, not only logos or login.

5. **Backend**  
   - Ensure the main API and website are live and stable during the review window.

---

## Summary

- **Already in place:** Privacy & Terms in app, account deletion, report/block for UGC, Support & Contact link, email-only login (no Sign in with Apple required), physical-goods payments via Stripe/Apple Pay, no custom review prompt.
- **At submit time:** Set Support URL and Privacy Policy URL in App Store Connect, provide a demo account and feature explanation in App Review notes, complete age rating and metadata, keep backend on.
- **Watch for:** Possible questions about subscriptions (Stripe vs IAP); respond with your use case and be ready to discuss IAP if Apple requires it.

Last updated: March 2026 (guidelines as of [Apple’s page](https://developer.apple.com/app-store/review/guidelines/)).
