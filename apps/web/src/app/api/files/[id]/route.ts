import { catchToJson, jsonError } from "@/lib/application/api-errors";
import { downloadFileAsync } from "@/lib/application/data-gateway";

type Params = { params: Promise<{ id: string }> };

/**
 * Authenticated download — uses JWT + RLS (no long-lived signed URLs).
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const result = await downloadFileAsync(id);
    if (!result) {
      return jsonError("NOT_FOUND");
    }
    return new Response(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": result.meta.mimeType,
        "Content-Length": String(result.bytes.byteLength),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.meta.name)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return catchToJson(err);
  }
}
