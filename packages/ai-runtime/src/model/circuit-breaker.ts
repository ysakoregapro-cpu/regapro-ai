export type CircuitState = "closed" | "open" | "half-open";

export class ProviderHealth {
  private failures = 0;
  private successes = 0;
  private openUntil = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(opts?: { failureThreshold?: number; cooldownMs?: number }) {
    this.failureThreshold = opts?.failureThreshold ?? 3;
    this.cooldownMs = opts?.cooldownMs ?? 30_000;
  }

  state(now = Date.now()): CircuitState {
    if (this.openUntil > now) return "open";
    if (this.openUntil > 0 && this.openUntil <= now) return "half-open";
    return "closed";
  }

  isAvailable(now = Date.now()): boolean {
    return this.state(now) !== "open";
  }

  recordSuccess(): void {
    this.successes += 1;
    this.failures = 0;
    this.openUntil = 0;
  }

  recordFailure(now = Date.now()): void {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.openUntil = now + this.cooldownMs;
    }
  }

  snapshot() {
    return {
      failures: this.failures,
      successes: this.successes,
      state: this.state(),
    };
  }
}

const healthByProvider = new Map<string, ProviderHealth>();

export function healthFor(providerId: string): ProviderHealth {
  let h = healthByProvider.get(providerId);
  if (!h) {
    h = new ProviderHealth();
    healthByProvider.set(providerId, h);
  }
  return h;
}
