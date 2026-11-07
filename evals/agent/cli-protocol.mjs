import { readFileSync } from "node:fs";
const pinned = JSON.parse(
  readFileSync(
    new URL("./fixtures/cli/templates.json", import.meta.url),
    "utf8",
  ),
);
export function pinnedCliVersion(agent, cliVersion) {
  if (agent === "reference") return true;
  if (agent === "claude") return cliVersion === "2.1.280 (Claude Code)";
  return Object.hasOwn(
    pinned,
    cliVersion === "0.164.0" ? "codex-cli 0.164.0" : cliVersion,
  );
}
// CLI-authored terminal events only. Agent messages and nonterminal notices never enter this path.
export function terminalProtocol(row, { agent, cliVersion } = {}) {
  if (
    (agent && agent !== "codex") ||
    row.type !== "turn.failed" ||
    typeof row.error?.message !== "string"
  )
    return null;
  const version = cliVersion === "0.164.0" ? "codex-cli 0.164.0" : cliVersion;
  for (const template of pinned[version] ?? []) {
    const match = new RegExp(template.pattern, "u").exec(row.error.message);
    if (match?.[0] === row.error.message) return { ...template, version };
  }
  return null;
}
