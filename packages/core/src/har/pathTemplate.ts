/**
 * Collapse concrete paths into templates so
 * /api/projects/123 and /api/projects/456 become /api/projects/{id}
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_RE = /^\d+$/;
const HEX_RE = /^[0-9a-f]{8,}$/i;

export function segmentToPlaceholder(segment: string): string {
  if (NUMERIC_RE.test(segment)) return "{id}";
  if (UUID_RE.test(segment)) return "{uuid}";
  if (HEX_RE.test(segment) && segment.length >= 16) return "{hex}";
  return segment;
}

export function toPathTemplate(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  const parts = pathname.split("/").filter((p) => p.length > 0);
  const templated = parts.map(segmentToPlaceholder);
  return "/" + templated.join("/");
}

export function extractPathParams(
  pathname: string,
  template: string,
): Record<string, string> {
  const pathParts = pathname.split("/").filter((p) => p.length > 0);
  const templateParts = template.split("/").filter((p) => p.length > 0);
  const params: Record<string, string> = {};
  if (pathParts.length !== templateParts.length) return params;

  for (let i = 0; i < templateParts.length; i++) {
    const t = templateParts[i]!;
    const p = pathParts[i]!;
    if (t.startsWith("{") && t.endsWith("}")) {
      const name = t.slice(1, -1);
      params[name] = p;
    }
  }
  return params;
}
