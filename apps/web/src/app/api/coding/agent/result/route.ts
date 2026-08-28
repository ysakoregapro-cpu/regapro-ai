import { NextResponse } from "next/server";
import {
  storeResult,
  verifyAgentRequest,
} from "@/lib/application/coding-device-store";
import type { ToolObservation } from "@regapro/coding-runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    deviceId?: string;
    commandId?: string;
    timestampMs?: number;
    nonce?: string;
    signature?: string;
    observation?: ToolObservation;
  };
  if (!body.deviceId || !body.commandId || !body.timestampMs || !body.nonce || !body.signature) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  }
  const device = verifyAgentRequest({
    deviceId: body.deviceId,
    timestampMs: body.timestampMs,
    nonce: body.nonce,
    signature: body.signature,
    body: body.commandId,
  });
  if (!device) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED_DEVICE" }, { status: 401 });
  }
  if (body.observation) storeResult(body.commandId, body.observation);
  return NextResponse.json({ ok: true });
}
