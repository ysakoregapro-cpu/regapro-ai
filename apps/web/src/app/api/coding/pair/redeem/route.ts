import { NextResponse } from "next/server";
import { redeemPairing } from "@/lib/application/coding-device-store";

export const dynamic = "force-dynamic";

/** Local Agent redeem. No service_role on the device. Pairing code is the secret. */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    pairingCode?: string;
    publicKeyPem?: string;
    deviceLabel?: string;
    os?: "windows" | "macos" | "linux" | "unknown";
  };
  if (!body.pairingCode || !body.publicKeyPem) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  }
  const result = redeemPairing({
    pairingCode: body.pairingCode,
    publicKeyPem: body.publicKeyPem,
    deviceLabel: body.deviceLabel || "NOTEBOOK",
    os: body.os ?? "unknown",
  });
  if ("error" in result) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...result });
}
