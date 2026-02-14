"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

export default function AdminLoginPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (code.trim() !== ADMIN_CODE) {
      setError("Invalid code.");
      return;
    }
    if (typeof window !== "undefined") {
      sessionStorage.setItem("nwc_admin", "1");
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-sm w-full">
        <h1 className="text-2xl font-bold mb-6">NWC Admin</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="code" className="block text-sm font-medium mb-1">Admin code</label>
            <input
              id="code"
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              className="w-full border rounded px-3 py-2"
              autoComplete="off"
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" className="w-full rounded px-4 py-2" style={{ backgroundColor: "#505542", color: "#fff" }}>
            Log in
          </button>
        </form>
      </div>
    </div>
  );
}
