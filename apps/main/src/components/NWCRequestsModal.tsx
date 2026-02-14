"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useLockBodyScroll } from "@/lib/scroll-lock";

interface NWCRequestsModalProps {
  open: boolean;
  onClose: () => void;
}

export function NWCRequestsModal({ open, onClose }: NWCRequestsModalProps) {
  const { data: session } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (open && session?.user) {
      if (session.user.name) setName(session.user.name);
      if (session.user.email) setEmail(session.user.email);
    }
  }, [open, session?.user?.name, session?.user?.email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const submitName = name.trim();
    const submitEmail = email.trim();
    const submitMessage = message.trim();
    if (!submitName || !submitEmail || !submitMessage) {
      setError("Please fill in name, email, and message.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/nwc-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: submitName,
          email: submitEmail,
          message: submitMessage,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to send. Please try again.");
        setLoading(false);
        return;
      }
      setSent(true);
      setMessage("");
      setLoading(false);
      setTimeout(() => {
        setSent(false);
        onClose();
      }, 1800);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  useLockBodyScroll(open);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 isolate overflow-hidden"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative w-full max-w-md rounded-lg bg-white shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-xl font-bold">NWC Requests</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded hover:bg-gray-100 text-gray-600"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4">
          <p className="text-gray-600 text-sm mb-4">
            Send a request or message to the Northwest Community team.
          </p>
          <div className="mb-4 rounded-lg border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 px-3 py-2 text-sm text-gray-700">
            Your email is included with your request so the NWC team can reach out to you if needed.
          </div>
          {sent ? (
            <p className="text-center py-6 text-green-700 font-medium">Thank you! Your message has been sent.</p>
          ) : (
            <>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 mb-3 focus:ring focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
                placeholder="Your name"
                required
              />
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 mb-3 focus:ring focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]"
                placeholder="your@email.com"
                required
              />
              <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                className="w-full border border-gray-300 rounded px-3 py-2 mb-3 focus:ring focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)] resize-y"
                placeholder="Your request or message..."
                required
              />
              {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={onClose} className="btn border border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={loading} className="btn">
                  {loading ? "Sending…" : "Send"}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
