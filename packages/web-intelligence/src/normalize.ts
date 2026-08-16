import type { WebSource } from "./types.js";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
]);

export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    const params = new URLSearchParams(u.search);
    for (const key of [...params.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) params.delete(key);
    }
    u.search = params.toString() ? `?${params.toString()}` : "";
    let href = u.toString();
    if (href.endsWith("/") && u.pathname !== "/") href = href.slice(0, -1);
    return href;
  } catch {
    return raw.trim();
  }
}

export function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function freshnessScore(publishedAt: string | null, retrievedAt: string): number {
  if (!publishedAt) return 0.4;
  const ageMs = Date.parse(retrievedAt) - Date.parse(publishedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) return 0.4;
  const days = ageMs / 86_400_000;
  if (days < 30) return 1;
  if (days < 180) return 0.7;
  if (days < 365) return 0.5;
  return 0.3;
}

export function sourceQuality(domain: string): number {
  if (!domain) return 0.4;
  if (/\.(go\.jp|gov|ac\.jp)$/i.test(domain)) return 0.95;
  if (/(reuters|nikkei|bloomberg|oecd|imf)\./i.test(domain)) return 0.85;
  return 0.55;
}

export function dedupeSources(sources: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  const out: WebSource[] = [];
  for (const s of sources) {
    const key = canonicalizeUrl(s.canonicalUrl || s.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...s, canonicalUrl: key });
  }
  return out;
}

export function rankSources(sources: WebSource[]): WebSource[] {
  return [...sources].sort((a, b) => {
    const sa = a.relevance * 0.5 + a.freshness * 0.25 + a.sourceQuality * 0.25;
    const sb = b.relevance * 0.5 + b.freshness * 0.25 + b.sourceQuality * 0.25;
    return sb - sa;
  });
}

export function makeSourceId(url: string): string {
  const canon = canonicalizeUrl(url);
  let hash = 0;
  for (let i = 0; i < canon.length; i++) {
    hash = (hash << 5) - hash + canon.charCodeAt(i);
    hash |= 0;
  }
  return `web-${Math.abs(hash).toString(16)}`;
}
