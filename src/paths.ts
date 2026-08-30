import { homedir } from "node:os";
import { join } from "node:path";

export interface ClientPaths {
  configDir: string;
  connectionFile: string;
  credentialFile: string;
  stateFile: string;
  routingStateFile: string;
  logDir: string;
  codexHome: string;
  codexConfigFile: string;
  codexConfigBackupFile: string;
  catalogFile: string;
  launchAgentFile: string;
  systemdUserDir: string;
  systemdServiceFile: string;
  systemdTimerFile: string;
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): ClientPaths {
  const home = env.HOME || homedir();
  const configRoot = env.XDG_CONFIG_HOME || join(home, ".config");
  const stateRoot = env.XDG_STATE_HOME || join(home, ".local", "state");
  const configDir = env.OPENCODEX_CLOUD_HOME || join(configRoot, "opencodex-cloud");
  const codexHome = env.CODEX_HOME || join(home, ".codex");
  const systemdUserDir = join(configRoot, "systemd", "user");

  return {
    configDir,
    connectionFile: join(configDir, "connection.json"),
    credentialFile: join(configDir, "api-key"),
    stateFile: join(configDir, "sync-state.json"),
    routingStateFile: join(configDir, "routing-state.json"),
    logDir: join(stateRoot, "opencodex-cloud"),
    codexHome,
    codexConfigFile: join(codexHome, "config.toml"),
    codexConfigBackupFile: join(codexHome, "config.toml.opencodex-cloud.bak"),
    catalogFile: join(codexHome, "opencodex-cloud-catalog.json"),
    launchAgentFile: join(home, "Library", "LaunchAgents", "com.opencodex-cloud.catalog-sync.plist"),
    systemdUserDir,
    systemdServiceFile: join(systemdUserDir, "opencodex-cloud-catalog-sync.service"),
    systemdTimerFile: join(systemdUserDir, "opencodex-cloud-catalog-sync.timer"),
  };
}
