const SECRET_KEYS = [
  "password",
  "token",
  "apiKey",
  "api_key",
  "secret",
  "authorization",
  "cookie",
  "AI_GATEWAY_API_KEY",
  "LANGFUSE_SECRET_KEY",
  "TAVILY_API_KEY",
  "FIRECRAWL_API_KEY",
  "BROWSERBASE_API_KEY",
];

export function scrubSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    if (/sk-[a-zA-Z0-9]{8,}|tvly-|fc-|lf-/.test(value)) return "[REDACTED]";
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(scrubSecrets);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (SECRET_KEYS.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = scrubSecrets(val);
      }
    }
    return out;
  }
  return value;
}
