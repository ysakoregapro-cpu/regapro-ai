import { z } from "zod";

export const ArtifactFormatSchema = z.enum([
  "markdown",
  "pdf",
  "docx",
  "xlsx",
  "pptx",
]);

export type ArtifactFormat = z.infer<typeof ArtifactFormatSchema>;

export const ArtifactSpecSchema = z.object({
  title: z.string().min(1),
  format: ArtifactFormatSchema,
  sections: z.array(
    z.object({
      heading: z.string().min(1),
      body: z.string(),
    }),
  ),
  metadata: z.record(z.string()).optional(),
  financials: z
    .object({
      lineItems: z.array(
        z.object({
          label: z.string(),
          amount: z.number(),
          currency: z.string().default("JPY"),
        }),
      ),
    })
    .optional(),
});

export type ArtifactSpec = z.infer<typeof ArtifactSpecSchema>;

export interface RenderResult {
  format: ArtifactFormat;
  content: Uint8Array;
  mimeType: string;
}

export interface ArtifactRenderer {
  readonly format: ArtifactFormat;
  render(spec: ArtifactSpec): Promise<RenderResult>;
}

export class NotConnectedError extends Error {
  constructor(format: string) {
    super(`${format} renderer is not connected`);
    this.name = "NotConnectedError";
  }
}

export function sumFinancialLineItems(
  items: { amount: number }[],
): number {
  return items.reduce((acc, item) => acc + item.amount, 0);
}

export class MarkdownRenderer implements ArtifactRenderer {
  readonly format = "markdown" as const;

  async render(spec: ArtifactSpec): Promise<RenderResult> {
    let md = `# ${spec.title}\n\n`;
    for (const section of spec.sections) {
      md += `## ${section.heading}\n\n${section.body}\n\n`;
    }
    if (spec.financials) {
      const total = sumFinancialLineItems(spec.financials.lineItems);
      md += `## Financial Summary\n\nTotal: ${total} JPY\n`;
    }
    const encoder = new TextEncoder();
    return {
      format: "markdown",
      content: encoder.encode(md),
      mimeType: "text/markdown",
    };
  }
}

function stubBinary(format: ArtifactFormat): RenderResult {
  return {
    format,
    content: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    mimeType: "application/octet-stream",
  };
}

export class PdfRenderer implements ArtifactRenderer {
  readonly format = "pdf" as const;
  async render(_spec: ArtifactSpec): Promise<RenderResult> {
    throw new NotConnectedError("pdf");
  }
}

export class DocxRenderer implements ArtifactRenderer {
  readonly format = "docx" as const;
  async render(spec: ArtifactSpec): Promise<RenderResult> {
    return stubBinary("docx");
  }
}

export class XlsxRenderer implements ArtifactRenderer {
  readonly format = "xlsx" as const;
  async render(spec: ArtifactSpec): Promise<RenderResult> {
    if (spec.financials) {
      sumFinancialLineItems(spec.financials.lineItems);
    }
    return stubBinary("xlsx");
  }
}

export class PptxRenderer implements ArtifactRenderer {
  readonly format = "pptx" as const;
  async render(_spec: ArtifactSpec): Promise<RenderResult> {
    throw new NotConnectedError("pptx");
  }
}

export function getRenderer(format: ArtifactFormat): ArtifactRenderer {
  switch (format) {
    case "markdown":
      return new MarkdownRenderer();
    case "pdf":
      return new PdfRenderer();
    case "docx":
      return new DocxRenderer();
    case "xlsx":
      return new XlsxRenderer();
    case "pptx":
      return new PptxRenderer();
  }
}
