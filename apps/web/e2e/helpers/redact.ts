const SECRET_QUERY = /([?&](?:token|key|password|secret|code|access_token|refresh_token|apikey)=)[^&]*/gi;
const BEARER = /Bearer\s+[A-Za-z0-9._\-]+/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function redactText(value: string): string {
  return value
    .replace(SECRET_QUERY, "$1[redacted]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(EMAIL, "[redacted-email]");
}

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/token|key|password|secret|code|apikey/i.test(key)) {
        u.searchParams.set(key, "[redacted]");
      }
    }
    return redactText(u.toString());
  } catch {
    return redactText(url);
  }
}
