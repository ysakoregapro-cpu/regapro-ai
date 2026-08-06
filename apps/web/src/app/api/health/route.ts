import { getDataMode } from "@/lib/supabase/env";

export async function GET() {
  return Response.json({ ok: true, mode: getDataMode() });
}
