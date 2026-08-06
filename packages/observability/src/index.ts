import { z } from "zod";

export const AuditLogEntrySchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  actorId: z.string().uuid().nullable().optional(),
  action: z.string().min(1),
  resourceType: z.string().min(1),
  resourceId: z.string().uuid().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime({ offset: true }),
});

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

const SECRET_KEYS = [
  "password",
  "token",
  "apiKey",
  "api_key",
  "secret",
  "authorization",
  "cookie",
];

export function scrubSecrets(value: unknown): unknown {
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

export const ProviderStatusSchema = z.object({
  name: z.string(),
  available: z.boolean(),
  message: z.string().optional(),
});

export const DiagnosticStatusSchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  providers: z.array(ProviderStatusSchema),
  jobs: z.object({
    pending: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    retry: z.number().int().nonnegative(),
  }),
  notifications: z.object({
    pendingDeliveries: z.number().int().nonnegative(),
    failedDeliveries: z.number().int().nonnegative(),
  }),
  search: z.object({
    provider: z.string(),
    available: z.boolean(),
  }),
  llm: z.object({
    localAvailable: z.boolean(),
    remoteConnected: z.boolean(),
  }),
  storage: z.object({
    available: z.boolean(),
    lastError: z.string().nullable().optional(),
  }),
  lastErrors: z.array(
    z.object({
      at: z.string().datetime({ offset: true }),
      message: z.string(),
      source: z.string(),
    }),
  ),
  retries: z.number().int().nonnegative(),
});

export type DiagnosticStatus = z.infer<typeof DiagnosticStatusSchema>;

export function createEmptyDiagnosticStatus(): DiagnosticStatus {
  return DiagnosticStatusSchema.parse({
    generatedAt: new Date().toISOString(),
    providers: [],
    jobs: { pending: 0, failed: 0, retry: 0 },
    notifications: { pendingDeliveries: 0, failedDeliveries: 0 },
    search: { provider: "searxng", available: true },
    llm: { localAvailable: false, remoteConnected: false },
    storage: { available: true },
    lastErrors: [],
    retries: 0,
  });
}
