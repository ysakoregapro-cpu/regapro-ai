import { inflateRawSync } from "node:zlib";

export type SourceTextResult = {
  text: string | null;
  limitation: string | null;
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

function extractXlsx(bytes: Uint8Array): string {
  const files = unzip(bytes);
  const shared = decodeUtf8(files.get("xl/sharedStrings.xml") ?? new Uint8Array());
  const strings = xmlTexts(shared, "t");
  const sheet = decodeUtf8(files.get("xl/worksheets/sheet1.xml") ?? new Uint8Array());
  const rows = [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
    const cells = [...(r[1] ?? "").matchAll(/<c[^>]*>([\s\S]*?)<\/c>/g)];
    return cells
      .map((c) => {
        const v = /<v>([^<]*)<\/v>/.exec(c[1] ?? "")?.[1];
        const t = /t="s"/.test(c[0] ?? "");
        if (t && v != null) return strings[Number(v)] ?? "";
        return v ?? "";
      })
      .join("\t");
  });
  return rows.filter(Boolean).join("\n");
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
      return { text: decodeUtf8(input.bytes), limitation: null };
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
      const text = extractXlsx(input.bytes);
      return text
        ? { text, limitation: null }
        : { text: null, limitation: "xlsx_empty" };
    }
    if (mime === "application/pdf" || name.endsWith(".pdf")) {
      const text = extractPdf(input.bytes);
      return text
        ? { text, limitation: null }
        : { text: null, limitation: "pdf_no_extractable_text" };
    }
    return { text: null, limitation: "unsupported_type" };
  } catch {
    return { text: null, limitation: "extract_failed" };
  }
}
