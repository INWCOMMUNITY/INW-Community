"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";

export interface NwcRequestFormBodyProps {
  /** Show subject line (e.g. full contact page, app support). */
  showSubject?: boolean;
  onCancel?: () => void;
  /** After thank-you is shown, auto-dismiss (e.g. close modal). Omit on standalone pages. */
  afterThankYou?: () => void;
  /** Extra classes on the root form element. */
  formClassName?: string;
}

export function NwcRequestFormBody({
  showSubject = false,
  onCancel,
  afterThankYou,
  formClassName = "",
}: NwcRequestFormBodyProps) {
  const { data: session } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (session?.user) {
      if (session.user.name) setName(session.user.name);
      if (session.user.email) setEmail(session.user.email);
    }
  }, [session?.user?.name, session?.user?.email]);

  const runAfterThankYou = () => {
    if (afterThankYou) {
      setTimeout(() => {
        afterThankYou();
      }, 1800);
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const submitName = name.trim();
    const submitEmail = email.trim();
    const submitPhone = phone.trim();
    const submitSubject = subject.trim();
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
          ...(submitPhone ? { phone: submitPhone } : {}),
          ...(submitSubject ? { subject: submitSubject } : {}),
          message: submitMessage,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to send. Please try again.");
        setLoading(false);
        return;
      }
      setLoading(false);
      setMessage("");
      if (showSubject) setSubject("");
      setSent(true);
      runAfterThankYou();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  const inputClass =
    "w-full border border-gray-300 rounded px-3 py-2 mb-3 focus:ring focus:ring-[var(--color-primary)] focus:border-[var(--color-primary)]";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
      <form onSubmit={handleSubmit} className={formClassName}>
        <p className="text-gray-600 text-sm mb-4">
          Send a request or message to the Northwest Community team.
        </p>
        <div className="mb-4 rounded-lg border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5 px-3 py-2 text-sm text-gray-700">
          Your email is included with your request so the NWC team can reach out to you if needed. Phone is optional.
        </div>
        {sent ? (
          <p className="text-center py-6 text-green-700 font-medium">Thank you! Your message has been sent.</p>
        ) : (
          <>
            <label className={labelClass}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="Your name"
              required
              autoComplete="name"
            />
            <label className={labelClass}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="your@email.com"
              required
              autoComplete="email"
            />
            <label className={labelClass}>
              Phone <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
              placeholder="e.g. (555) 123-4567"
              autoComplete="tel"
            />
            {showSubject ? (
              <>
                <label className={labelClass}>
                  Subject <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className={inputClass}
                  placeholder="e.g. App feedback, account help"
                  maxLength={200}
                />
              </>
            ) : null}
            <label className={labelClass}>Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={showSubject ? 8 : 4}
              className={`${inputClass} resize-y min-h-[120px]`}
              placeholder="Your request or message..."
              required
            />
            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
            <div className="flex gap-2 justify-end flex-wrap">
              {onCancel ? (
                <button
                  type="button"
                  onClick={onCancel}
                  className="btn border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              ) : null}
              <button type="submit" disabled={loading} className="btn">
                {loading ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </form>
  );
}
