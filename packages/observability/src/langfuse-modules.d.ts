declare module "@langfuse/tracing" {
  export function startActiveObservation(
    name: string,
    fn: (span: { update: (input: Record<string, unknown>) => void }) => unknown,
  ): Promise<unknown>;
  export function flush(): Promise<void>;
}

declare module "@langfuse/otel" {
  export class LangfuseSpanProcessor {
    constructor(opts?: {
      publicKey?: string;
      secretKey?: string;
      baseUrl?: string;
    });
  }
}

declare module "@opentelemetry/sdk-node" {
  export class NodeSDK {
    constructor(opts: { spanProcessors: unknown[] });
    start(): void;
  }
}
