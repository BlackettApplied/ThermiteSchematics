import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("diff", "HEAD", "--name-only") !== "")
  throw new Error(
    "Commit tracked alpha changes before creating a source archive.",
  );
const commit = git("rev-parse", "HEAD");
const version = "0.3.0-alpha.2";
const filename = `thermite-${version}-source-${commit.slice(0, 8)}.zip`;
const archive = execFileSync(
  "git",
  ["archive", "--format=zip", `--prefix=thermite-${version}/`, commit],
  { cwd: root, maxBuffer: 128 * 1024 * 1024 },
);
const digest = createHash("sha256").update(archive).digest("hex");
const out = join(root, "alpha-out");
await mkdir(out, { recursive: true });
await writeFile(join(out, filename), archive, { flag: "wx" });
await writeFile(join(out, `${filename}.sha256`), `${digest}  ${filename}\n`, {
  flag: "wx",
});
await writeFile(
  join(out, `${filename}.json`),
  JSON.stringify(
    {
      format: "thermite-source-release/0.1",
      version,
      commit,
      archive: filename,
      sha256: digest,
      packagedOn: `${process.platform}-${process.arch} / ${globalThis.Bun ? `Bun ${Bun.version}` : `Node ${process.version}`}`,
      setup: [
        "bun install --frozen-lockfile",
        "bun run build",
        "bun thermite.mjs --help",
      ],
      license: "Apache-2.0",
      thirdPartyNotices: "THIRD_PARTY_NOTICES.md",
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
process.stdout.write(`Created ${join(out, filename)}\nSHA-256 ${digest}\n`);
