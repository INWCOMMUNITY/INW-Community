/** Strip Etsy token-shaped secrets before logging or surfacing errors. */
const SECRET_PATTERNS: RegExp[] = [
  // access/refresh tokens are `{user_id}.{opaque}`
  /\b\d+\.[A-Za-z0-9_-]{20,}\b/g,
  /code_verifier=[^&\s]+/gi,
  /refresh_token=[^&\s]+/gi,
  /access_token=[^&\s]+/gi,
];

export function redactEtsySecrets(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}
