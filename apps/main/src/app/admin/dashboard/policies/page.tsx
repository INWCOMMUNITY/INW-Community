import Link from "next/link";
import { PolicyList } from "./PolicyList";

export default function AdminPoliciesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Policies</h1>
      <p className="text-gray-600 mb-6">
        Edit Terms of Service, Privacy Policy, and other legal pages. These are shown on the main site (e.g. /policies/terms).
      </p>
      <PolicyList />
    </div>
  );
}
