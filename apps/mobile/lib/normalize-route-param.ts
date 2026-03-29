/** Expo Router search params can be `string | string[]`. */
export function normalizeRouteParam(
  param: string | string[] | undefined
): string | undefined {
  if (param == null) return undefined;
  if (Array.isArray(param)) return param[0]?.trim() || undefined;
  const s = param.trim();
  return s || undefined;
}
