import { NextResponse } from "next/server";
import { resolveAppSession } from "@/lib/application/session-access";
import {
  addWorkspace,
  codingStatus,
  confirmDevice,
  revokeDevice,
  startPairing,
} from "@/lib/application/coding-device-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await resolveAppSession({});
    return NextResponse.json({
      ok: true,
      ...codingStatus(session.access.userId, session.access.organizationId),
    });
  } catch {
    return NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await resolveAppSession({});
    const body = (await req.json()) as {
      action?: string;
      deviceId?: string;
      rootPath?: string;
      permission?: "read" | "write";
      label?: string;
    };
    if (body.action === "pair_start") {
      const started = startPairing({
        orgId: session.access.organizationId,
        userId: session.access.userId,
      });
      return NextResponse.json({ ok: true, ...started });
    }
    if (body.action === "pair_confirm" && body.deviceId) {
      const ok = confirmDevice({
        userId: session.access.userId,
        orgId: session.access.organizationId,
        deviceId: body.deviceId,
      });
      return NextResponse.json({ ok });
    }
    if (body.action === "revoke" && body.deviceId) {
      const ok = revokeDevice({
        userId: session.access.userId,
        orgId: session.access.organizationId,
        deviceId: body.deviceId,
      });
      return NextResponse.json({ ok });
    }
    if (body.action === "allow_workspace" && body.deviceId && body.rootPath) {
      const ws = addWorkspace({
        userId: session.access.userId,
        orgId: session.access.organizationId,
        deviceId: body.deviceId,
        rootPath: body.rootPath,
        permission: body.permission === "write" ? "write" : "read",
        label: body.label || body.rootPath,
      });
      return NextResponse.json({ ok: Boolean(ws), workspace: ws });
    }
    return NextResponse.json({ ok: false, message: "未知の操作です" }, { status: 400 });
  } catch {
    return NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 });
  }
}
