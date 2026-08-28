#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { addWorkspace, loadConfig, saveConfig } from "./config.js";
import { createLocalBridgeServer } from "./localhost-bridge.js";
import { pollCloudOnce } from "./outbound.js";

function usage(): string {
  return `RegaloProfessional Local Agent

  npm run start --workspace=@regapro/local-agent -- serve
  npm run start --workspace=@regapro/local-agent -- pair <CODE>
  npm run start --workspace=@regapro/local-agent -- allow <absolute-path>
  npm run start --workspace=@regapro/local-agent -- status

Local Agent は service_role を持ちません。許可した Workspace 以外は読みません。
`;
}

async function main(argv: string[]): Promise<void> {
  const cmd = argv[0] ?? "serve";
  if (cmd === "help" || cmd === "--help") {
    process.stdout.write(usage());
    return;
  }

  let cfg = loadConfig();
  saveConfig(cfg);

  if (cmd === "allow") {
    const root = argv[1];
    if (!root) throw new Error("allow には絶対パスが必要です");
    cfg = addWorkspace(cfg, root);
    saveConfig(cfg);
    process.stdout.write(`allowed: ${root}\n`);
    return;
  }

  if (cmd === "pair") {
    const code = (argv[1] ?? "").trim().toUpperCase();
    if (!code) {
      process.stdout.write(
        "使い方: pair <Webで表示された8文字コード>\nコードは Web の POST /api/coding/devices {action:pair_start} で発行します。\n",
      );
      return;
    }
    process.stdout.write("公開鍵をクラウドへ送ります。秘密鍵は表示しません。\n");
    if (cfg.cloudBaseUrl) {
      try {
        const res = await fetch(`${cfg.cloudBaseUrl.replace(/\/$/, "")}/api/coding/pair/redeem`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pairingCode: code,
            publicKeyPem: cfg.publicKeyPem,
            deviceLabel: cfg.deviceLabel,
            os: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
          }),
        });
        const json = (await res.json()) as { ok?: boolean; deviceId?: string; error?: string };
        if (json.deviceId) {
          cfg = { ...cfg, deviceId: json.deviceId };
          saveConfig(cfg);
          process.stdout.write(`deviceId saved. Web で pair_confirm してください。\n`);
        } else {
          process.stdout.write(`redeem failed: ${json.error ?? res.status}\n`);
        }
      } catch {
        process.stdout.write("クラウドへ redeem できませんでした。後で再試行できます。\n");
      }
    }
    return;
  }

  if (cmd === "status") {
    process.stdout.write(
      JSON.stringify(
        {
          deviceId: cfg.deviceId,
          deviceLabel: cfg.deviceLabel,
          workspaces: cfg.allowedWorkspaces,
          listen: `${cfg.listenHost}:${cfg.listenPort}`,
          cloudBaseUrl: cfg.cloudBaseUrl,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const token = randomBytes(24).toString("hex");
  const server = createLocalBridgeServer({ config: cfg, token });
  server.listen(cfg.listenPort, cfg.listenHost, () => {
    process.stdout.write(
      `Local Agent listening on http://${cfg.listenHost}:${cfg.listenPort} (loopback only)\n`,
    );
    process.stdout.write("token is stored only on this machine; it is not printed.\n");
  });

  const poll = async () => {
    try {
      await pollCloudOnce(cfg);
    } catch {
      /* cloud may be unreachable; localhost bridge still works */
    }
  };
  const handle = setInterval(() => void poll(), 4000);
  await poll();

  const stop = () => {
    clearInterval(handle);
    server.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
  process.exitCode = 1;
});
