import type { WebSearchProvider } from "../ports.js";
import type { WebSource } from "../types.js";

/**
 * Exa slot — credentials optional. Never returns fake results.
 */
export class ExaSearchProvider implements WebSearchProvider {
  readonly id = "exa" as const;
  readonly connected: boolean;

  constructor(apiKey: string | null) {
    this.connected = Boolean(apiKey);
  }

  async search(): Promise<WebSource[]> {
    // Interface only until credentials and contract are wired.
    return [];
  }
}
