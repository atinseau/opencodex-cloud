import { describe, expect, test } from "bun:test";
import { resolvePaths } from "../src/paths";
import { renderLaunchAgent, renderSystemdService, renderSystemdTimer } from "../src/service";

const paths = resolvePaths({
  HOME: "/home/test user",
  XDG_CONFIG_HOME: "/home/test user/.config",
  XDG_STATE_HOME: "/home/test user/.local/state",
  CODEX_HOME: "/home/test user/.codex",
});

describe("background service definitions", () => {
  test("launchd exécute le binaire sans secret dans le plist", () => {
    const plist = renderLaunchAgent(paths, "/home/test user/.local/bin/opencodex-cloud");
    expect(plist).toContain("<string>sync</string>");
    expect(plist).toContain("<string>--quiet</string>");
    expect(plist).toContain("<integer>30</integer>");
    expect(plist).not.toContain("api-key");
  });

  test("systemd restreint l’écriture aux répertoires du client", () => {
    const service = renderSystemdService(paths, "/home/test user/.local/bin/opencodex-cloud");
    expect(service).toContain('ExecStart="/home/test user/.local/bin/opencodex-cloud" sync --quiet');
    expect(service).toContain("NoNewPrivileges=true");
    expect(service).toContain('ReadWritePaths="/home/test user/.codex"');
    expect(renderSystemdTimer()).toContain("OnUnitActiveSec=30s");
    expect(service).not.toContain("secret");
  });
});
