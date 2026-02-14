"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getErrorMessage } from "@/lib/api-error";
import { signOut } from "next-auth/react";

export function ProfileForm() {
  const router = useRouter();
  const [profilePhotoUrl, setProfilePhotoUrl] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bio, setBio] = useState("");
  const [city, setCity] = useState("");
  const [privacyLevel, setPrivacyLevel] = useState<"public" | "friends_only" | "completely_private">("public");
  const [phone, setPhone] = useState("");
  const [deliveryStreet, setDeliveryStreet] = useState("");
  const [deliveryCity, setDeliveryCity] = useState("");
  const [deliveryState, setDeliveryState] = useState("");
  const [deliveryZip, setDeliveryZip] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        if (d?.profilePhotoUrl) setProfilePhotoUrl(d.profilePhotoUrl);
        if (d?.firstName) setFirstName(d.firstName);
        if (d?.lastName) setLastName(d.lastName);
        if (d?.bio) setBio(d.bio);
        if (d?.city) setCity(d.city);
        if (d?.privacyLevel) setPrivacyLevel(d.privacyLevel);
        if (d?.phone) setPhone(d.phone);
        const addr = d?.deliveryAddress;
        if (addr && typeof addr === "object") {
          setDeliveryStreet(addr.street ?? "");
          setDeliveryCity(addr.city ?? "");
          setDeliveryState(addr.state ?? "");
          setDeliveryZip(addr.zip ?? "");
        }
      })
      .catch(() => {});
  }, []);

  async function uploadFile(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload/profile", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Upload failed");
    const url = data.url;
    if (!url) throw new Error("No URL returned");
    if (url.startsWith("/")) return `${window.location.origin}${url}`;
    return url;
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    setError("");
    try {
      const url = await uploadFile(file);
      setProfilePhotoUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingPhoto(false);
      e.target.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profilePhotoUrl: profilePhotoUrl || null,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          bio: bio || null,
          city: city || null,
          privacyLevel,
          phone: phone.trim() || null,
          deliveryAddress:
            deliveryStreet.trim() || deliveryCity.trim() || deliveryState.trim() || deliveryZip.trim()
              ? {
                  street: deliveryStreet.trim() || undefined,
                  city: deliveryCity.trim() || undefined,
                  state: deliveryState.trim() || undefined,
                  zip: deliveryZip.trim() || undefined,
                }
              : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(getErrorMessage(data.error, "Failed to update."));
        return;
      }
      router.push("/my-community/profile");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteAccount() {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/me/delete", { method: "POST" });
      if (res.ok) {
        await signOut({ redirect: false });
        router.push("/");
        router.refresh();
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Profile Pic - centered at top with upload button */}
        <div className="flex flex-col items-center">
          <div className="relative mb-3">
            {profilePhotoUrl ? (
              <img
                src={profilePhotoUrl}
                alt="Profile"
                className="w-32 h-32 rounded-full object-cover border-2 border-gray-200"
              />
            ) : (
              <div className="w-32 h-32 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm">
                No photo
              </div>
            )}
          </div>
          <label className="cursor-pointer">
            <span className="inline-block px-4 py-2 border rounded hover:bg-gray-100">
              {uploadingPhoto ? "Uploading…" : profilePhotoUrl ? "Change photo" : "Upload photo"}
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={handlePhotoChange}
              disabled={uploadingPhoto}
              className="sr-only"
            />
          </label>
          <p className="text-xs text-gray-500 mt-1">Upload from your device or camera. Max 40MB. JPEG, PNG, WebP, GIF.</p>
        </div>

        {/* First Name | Last Name - side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">First Name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Last Name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

        {/* Bio */}
        <div>
          <label className="block text-sm font-medium mb-1">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            className="w-full border rounded px-3 py-2"
            placeholder="Tell us about yourself..."
          />
        </div>

        {/* Privacy */}
        <div>
          <label className="block text-sm font-medium mb-1">Privacy</label>
          <select
            value={privacyLevel}
            onChange={(e) => setPrivacyLevel(e.target.value as "public" | "friends_only" | "completely_private")}
            className="w-full border rounded px-3 py-2"
          >
            <option value="public">Public – Profile and posts visible to everyone</option>
            <option value="friends_only">Friends only – Visible only to accepted friends</option>
            <option value="completely_private">Completely private – No profile, cannot post or comment</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Completely private accounts cannot post blogs, comment, or join groups.
          </p>
        </div>

        {/* City | Badges - side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">City</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full border rounded px-3 py-2"
              placeholder="Your city"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Badges</label>
            <div className="w-full border rounded px-3 py-2 bg-gray-50 text-gray-500 text-sm min-h-[42px] flex items-center">
              Coming soon
            </div>
          </div>
        </div>

        {/* Phone & delivery address – private, for orders/deliveries only */}
        <div className="border-t pt-6 space-y-4">
          <h3 className="font-semibold text-gray-800">Orders &amp; deliveries</h3>
          <p className="text-xs text-gray-500">
            The following are used only for checkout and local delivery. They are not shown on your public profile.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Phone (optional)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border rounded px-3 py-2 max-w-xs"
              placeholder="e.g. 555-123-4567"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Delivery address (optional)</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={deliveryStreet}
                onChange={(e) => setDeliveryStreet(e.target.value)}
                className="sm:col-span-2 border rounded px-3 py-2"
                placeholder="Street"
              />
              <input
                type="text"
                value={deliveryCity}
                onChange={(e) => setDeliveryCity(e.target.value)}
                className="border rounded px-3 py-2"
                placeholder="City"
              />
              <input
                type="text"
                value={deliveryState}
                onChange={(e) => setDeliveryState(e.target.value)}
                className="border rounded px-3 py-2"
                placeholder="State"
              />
              <input
                type="text"
                value={deliveryZip}
                onChange={(e) => setDeliveryZip(e.target.value)}
                className="border rounded px-3 py-2"
                placeholder="ZIP"
              />
            </div>
          </div>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? "Saving…" : "Save profile"}
        </button>
      </form>

      {/* Log out */}
      <div className="mt-8 pt-6 border-t border-gray-200">
        <button
          type="button"
          onClick={async () => {
            await signOut({ redirect: false });
            router.push("/");
            router.refresh();
          }}
          className="text-gray-600 hover:text-gray-800 hover:underline text-sm"
        >
          Log out
        </button>
      </div>

      {/* Delete account - only in Edit Profile */}
      <div className="mt-12 pt-8 border-t">
        <p className="text-sm font-medium text-gray-700 mb-2">Delete account</p>
        <p className="text-sm text-gray-500 mb-2">
          Permanently delete your account and all saved items. This cannot be undone.
        </p>
        {!deleteConfirm ? (
          <button
            type="button"
            onClick={() => setDeleteConfirm(true)}
            className="text-red-600 hover:underline text-sm"
          >
            I want to delete my account
          </button>
        ) : (
          <div className="flex gap-2 items-center">
            <button
              type="button"
              onClick={handleDeleteAccount}
              disabled={deleting}
              className="bg-red-600 text-white rounded px-3 py-1 text-sm hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Yes, delete my account"}
            </button>
            <button
              type="button"
              onClick={() => setDeleteConfirm(false)}
              className="text-gray-600 hover:underline text-sm"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
