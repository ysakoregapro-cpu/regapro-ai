import { inflateRawSync } from "node:zlib";

export type SourceTextResult = {
  text: string | null;
  limitation: string | null;
  requiresOcr?: boolean;
  sheets?: Array<{ name: string; rowCount: number }>;
};

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const buf = Buffer.from(bytes);
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const uncompSize = buf.readUInt32LE(offset + 22);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    let raw: Buffer;
    if (method === 0) raw = Buffer.from(data);
    else if (method === 8) raw = inflateRawSync(data);
    else {
      offset = dataStart + compSize;
      continue;
    }
    if (uncompSize && raw.length > uncompSize) raw = raw.subarray(0, uncompSize);
    out.set(name, new Uint8Array(raw));
    offset = dataStart + compSize;
  }
  return out;
}

function xmlTexts(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "g");
  const hits: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) hits.push(m[1] ?? "");
  return hits;
}

function extractDocx(bytes: Uint8Array): string {
  const files = unzip(bytes);
  const xml = decodeUtf8(files.get("word/document.xml") ?? new Uint8Array());
  return xmlTexts(xml, "w:t").join("").replace(/\s+/g, " ").trim();
}

function extractXlsx(bytes: Uint8Array): { text: string; sheets: Array<{ name: string; rowCount: number }> } {
  const files = unzip(bytes);
  const shared = decodeUtf8(files.get("xl/sharedStrings.xml") ?? new Uint8Array());
  const strings = xmlTexts(shared, "t");
  const workbook = decodeUtf8(files.get("xl/workbook.xml") ?? new Uint8Array());
  const sheetNames = [...workbook.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((m) => m[1] ?? "sheet");
  const sheets: Array<{ name: string; rowCount: number }> = [];
  const blocks: string[] = [];
  const sheetFiles = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k));
  sheetFiles.sort();
  sheetFiles.forEach((path, idx) => {
    const name = sheetNames[idx] ?? `sheet${idx + 1}`;
    const sheet = decodeUtf8(files.get(path) ?? new Uint8Array());
    const rows = [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r, rowIdx) => {
      const cells = [...(r[1] ?? "").matchAll(/<c[^>]*>([\s\S]*?)<\/c>/g)];
      const values = cells
        .map((c) => {
          const v = /<v>([^<]*)<\/v>/.exec(c[1] ?? "")?.[1];
          const t = /t="s"/.test(c[0] ?? "");
          if (t && v != null) return strings[Number(v)] ?? "";
          return v ?? "";
        })
        .join("\t");
      if (!values.trim()) return "";
      return `[sheet:${name} row:${rowIdx + 1}] ${values}`;
    });
    const kept = rows.filter(Boolean);
    sheets.push({ name, rowCount: kept.length });
    if (kept.length) blocks.push(kept.join("\n"));
  });
  return { text: blocks.join("\n").trim(), sheets };
}

function extractPdf(bytes: Uint8Array): string {
  const latin = Buffer.from(bytes).toString("latin1");
  const parts: string[] = [];
  const re = /\(((?:\\.|[^\\)])*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    const raw = (m[1] ?? "")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, "\t")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\");
    if (/[\p{L}\p{N}]/u.test(raw)) parts.push(raw);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function extractSourceText(input: {
  mimeType: string;
  filename: string;
  bytes: Uint8Array;
}): SourceTextResult {
  const name = input.filename.toLowerCase();
  const mime = input.mimeType.toLowerCase();
  try {
    if (
      mime.startsWith("text/") ||
      name.endsWith(".txt") ||
      name.endsWith(".md") ||
      name.endsWith(".csv")
    ) {
      const decoded = decodeUtf8(input.bytes);
      if (name.endsWith(".csv") || mime.includes("csv")) {
        const withRows = decoded
          .split(/\r?\n/)
          .map((line, i) => (line.trim() ? `[row:${i + 1}] ${line}` : ""))
          .filter(Boolean)
          .join("\n");
        return { text: withRows || decoded, limitation: null };
      }
      return { text: decoded, limitation: null };
    }
    if (
      mime.includes("wordprocessingml") ||
      name.endsWith(".docx")
    ) {
      const text = extractDocx(input.bytes);
      return text
        ? { text, limitation: null }
        : { text: null, limitation: "docx_empty" };
    }
    if (mime.includes("spreadsheetml") || name.endsWith(".xlsx")) {
      const extracted = extractXlsx(input.bytes);
      return extracted.text
        ? { text: extracted.text, limitation: null, sheets: extracted.sheets }
        : { text: null, limitation: "xlsx_empty", sheets: extracted.sheets };
    }
    if (mime === "application/pdf" || name.endsWith(".pdf")) {
      const text = extractPdf(input.bytes);
      return text
        ? { text, limitation: null }
        : { text: null, limitation: "requires_ocr", requiresOcr: true };
    }
    return { text: null, limitation: "unsupported_type" };
  } catch {
    return { text: null, limitation: "extract_failed" };
  }
}
