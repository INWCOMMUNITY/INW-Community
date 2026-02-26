# App Store Resubmission Checklist

Use this checklist to address Apple’s rejection reasons and resubmit. All fixes are in **App Store Connect** and your **demo account**; no app code changes are required.

---

## 1. Guideline 2.1 – Demo Account (Sign-in)

### 1.1 Ensure the demo account works

- The app signs in with **Email** and **Password** (not “username”). The field on the sign-in screen is **Email**.
- Create or fix a dedicated reviewer account:
  - Use a real **email address** (e.g. `appreview@inwcommunity.com` or the email for the account you will give Apple).
  - Give it an **active Resident (subscribe) subscription** so reviewers can use Rewards, QR scanner, and points.
  - Set a simple, typo-free password.
- **Verify login on a physical device** with the same build you submit (e.g. TestFlight): open app → Login → choose **Login as Resident** → enter email and password → confirm you reach the main app.

### 1.2 What to paste in App Store Connect (Review Notes)

In App Store Connect: your app → version → **Review Notes**. Paste the following, then replace the placeholders with your real demo email and password.

```
Sign in with EMAIL and PASSWORD (not username).

For full access to all features (Rewards, QR scanner, points, store, etc.), choose "Login as Resident" on the login screen, then enter:

Email:    [YOUR_DEMO_EMAIL]
Password: [YOUR_DEMO_PASSWORD]

Example: If your demo email is appreview@inwcommunity.com, type that in the Email field.
```

---

## 2. Guideline 5.1.2 – Privacy / Tracking

The app does **not** track users (no ATT, no third-party ad/tracking SDKs). Fix the labels so they do not say you use data for tracking.

### 2.1 Update App Privacy in App Store Connect

1. In App Store Connect, open your app → **App Privacy**.
2. For every data type you collect (Email, Name, Precise Location, etc.):
   - **Do not** mark any use as “used for tracking” or “Tracking.”
   - Set uses to “App functionality,” “Account management,” “Analytics” (first-party only), etc., as appropriate.
3. Save. Ensure the summary no longer states that data is collected “in order to track the user.”

### 2.2 Optional reply to Apple (Resolution Center)

You can reply to the rejection with:

```
We do not track users. Our app does not use the App Tracking Transparency framework because we do not link user data with third-party data for advertising or share data with data brokers. We have updated our App Privacy labels in App Store Connect accordingly.
```

---

## 3. Guideline 2.3.6 – Age Rating / In-App Controls

The app does not include Parental Controls or Age Assurance.

### 3.1 What to do in App Store Connect

1. Open your app → **App Information** (or the Age Rating section).
2. Set **Parental Controls** to **None**.
3. Set **Age Assurance** to **None**.
4. Save.

---

## 4. Verify Scanner, QR → Points, and Popups (Before Submitting)

Test on a **custom build** (EAS/TestFlight), not Expo Go (camera scanner is not available in Expo Go).

### 4.1 Test checklist

1. **Login**  
   Log in with the **exact** demo account (email + password) you will give Apple. Choose **Login as Resident**.

2. **Open scanner**  
   Go to **Rewards** → tap **Scan QR Code** (or use the scan action in the tab bar). Grant camera access if prompted.

3. **Scan a valid QR**  
   Use a QR code that encodes either:
   - URL: `https://www.inwcommunity.com/scan/{businessId}`  
   - Or raw **businessId** (20+ alphanumeric characters).  
   The business must exist in your database, must **not** be owned by the demo user, and must **not** have been scanned by that user today.

4. **Points popup**  
   After a successful scan, the **Points Earned** popup should appear with business name, points awarded, and new total.

5. **Badge popup (optional)**  
   If the scan qualifies for a badge (e.g. 10th distinct business → “Super Scanner,” or a category-scan badge), the **Badge Earned** popup should appear. You can verify this by scanning 10 different businesses or by having a test business in a category that has a low-threshold badge.

6. **Same build**  
   Run this flow on the same build you submit (e.g. TestFlight) on a real device.

---

## 5. Resubmission Steps (Summary)

1. **Demo account**  
   Create/fix Resident demo account; verify login on device. In **Review Notes**, provide **Email** and **Password** and the note that login uses email (not username) and to choose “Login as Resident.”

2. **Privacy**  
   In **App Privacy**, remove “used for tracking” from all data types. Optionally reply in Resolution Center that you do not track and have updated the labels.

3. **Age rating**  
   In **App Information** / Age Rating, set **Parental Controls** and **Age Assurance** to **None**.

4. **Verify**  
   Test login → Rewards → Scan QR → points popup (and badge popup if applicable) on your submission build.

5. **Submit**  
   Submit the build. In Review Notes you can add: “Demo login uses email + password. Parental Controls and Age Assurance set to None. App Privacy updated (no tracking).”
