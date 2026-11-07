import type { KnipConfig } from "knip"

const issues = [
  "files",
  "dependencies",
  "devDependencies",
  "optionalPeerDependencies",
  "unlisted",
  "binaries",
  "unresolved",
  "exports",
  "nsExports",
  "types",
  "nsTypes",
  "enumMembers",
  "namespaceMembers",
  "duplicates",
  "catalog",
  "catalogReferences",
  "cycles",
] as const

const config: KnipConfig = ({ production }) => ({
  include: [...issues],
  includeEntryExports: production !== true,
  ignoreExportsUsedInFile: production === true,
  treatConfigHintsAsErrors: true,
  treatTagHintsAsErrors: true,
  workspaces: {
    ".": {
      project: ["*.config.ts"],
    },
    "packages/mcp": {
      entry: ["src/main.ts!"],
      project: ["src/**!", "test/**"],
    },
  },
})

export default config
