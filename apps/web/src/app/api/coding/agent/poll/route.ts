import { NextResponse } from "next/server";
import { claimCommands, verifyAgentRequest } from "@/lib/application/coding-device-store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    deviceId?: string;
    timestampMs?: number;
    nonce?: string;
    signature?: string;
  };
  if (!body.deviceId || !body.timestampMs || !body.nonce || !body.signature) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  }
  const device = verifyAgentRequest({
    deviceId: body.deviceId,
    timestampMs: body.timestampMs,
    nonce: body.nonce,
    signature: body.signature,
  });
  if (!device) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED_DEVICE" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    commands: claimCommands(device.id),
  });
}
