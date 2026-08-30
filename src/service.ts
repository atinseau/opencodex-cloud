import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ClientPaths } from "./paths";
import { SERVICE_NAME, SYNC_INTERVAL_SECONDS } from "./constants";
import { ensurePrivateDirectory, writePrivateFile } from "./files";

export type ServiceKind = "launchd" | "systemd";

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function systemdArgument(value: string): string {
  return `"${value.replaceAll("%", "%%").replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function renderLaunchAgent(paths: ClientPaths, executablePath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.opencodex-cloud.catalog-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(executablePath)}</string>
    <string>sync</string>
    <string>--quiet</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${SYNC_INTERVAL_SECONDS}</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(`${paths.logDir}/sync.log`)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(`${paths.logDir}/sync-error.log`)}</string>
</dict>
</plist>
`;
}

export function renderSystemdService(paths: ClientPaths, executablePath: string): string {
  return `[Unit]
Description=Synchronise le catalogue OpenCodex Cloud
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${systemdArgument(executablePath)} sync --quiet
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${systemdArgument(paths.codexHome)} ${systemdArgument(paths.configDir)} ${systemdArgument(paths.logDir)}

[Install]
WantedBy=default.target
`;
}

export function renderSystemdTimer(): string {
  return `[Unit]
Description=Actualise automatiquement le catalogue OpenCodex Cloud

[Timer]
OnBootSec=10s
OnUnitActiveSec=${SYNC_INTERVAL_SECONDS}s
AccuracySec=5s
Persistent=true
Unit=${SERVICE_NAME}.service

[Install]
WantedBy=timers.target
`;
}

async function run(command: string[], allowFailure = false): Promise<void> {
  const child = Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(child.stderr).text();
  const exitCode = await child.exited;
  if (exitCode !== 0 && !allowFailure) {
    throw new Error(stderr.trim() || `${command[0]} a échoué avec le code ${exitCode}`);
  }
}

export async function installBackgroundSync(
  paths: ClientPaths,
  executablePath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<ServiceKind> {
  await ensurePrivateDirectory(paths.logDir);

  if (platform === "darwin") {
    await mkdir(dirname(paths.launchAgentFile), { recursive: true, mode: 0o700 });
    await writePrivateFile(paths.launchAgentFile, renderLaunchAgent(paths, executablePath));
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error("Impossible de déterminer l’utilisateur launchd.");
    await run(["/bin/launchctl", "bootout", `gui/${uid}`, paths.launchAgentFile], true);
    await run(["/bin/launchctl", "bootstrap", `gui/${uid}`, paths.launchAgentFile]);
    return "launchd";
  }

  if (platform === "linux") {
    const systemctl = Bun.which("systemctl");
    if (!systemctl) throw new Error("systemd utilisateur est requis pour la synchronisation automatique.");
    await mkdir(paths.systemdUserDir, { recursive: true, mode: 0o700 });
    await writePrivateFile(paths.systemdServiceFile, renderSystemdService(paths, executablePath));
    await writePrivateFile(paths.systemdTimerFile, renderSystemdTimer());
    await run([systemctl, "--user", "daemon-reload"]);
    await run([systemctl, "--user", "enable", "--now", `${SERVICE_NAME}.timer`]);
    return "systemd";
  }

  throw new Error(`Système non pris en charge pour l’instant : ${platform}`);
}
