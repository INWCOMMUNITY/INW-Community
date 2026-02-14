/**
 * Extract a user-friendly string from an API error response.
 * APIs may return { error: string } or { error: { formErrors, fieldErrors } } from Zod.
 */
export function getErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error == null) return fallback;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;
    if (Array.isArray(obj.formErrors) && obj.formErrors[0]) {
      return String(obj.formErrors[0]);
    }
    if (obj.fieldErrors && typeof obj.fieldErrors === "object") {
      const fe = obj.fieldErrors as Record<string, string[]>;
      const first = Object.values(fe).flat()[0];
      if (first) return first;
    }
    if (typeof obj.message === "string") return obj.message;
  }
  return fallback;
}
