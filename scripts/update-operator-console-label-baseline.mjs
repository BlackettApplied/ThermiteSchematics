// Regenerate only from this frozen renderer and its own project/request/lock.
// The current renderer must never supply the baseline drawing.
// Manual provenance check, outside `bun run check`: from a checkout with the
// frozen commit available in git history, installed Bun dependencies and Chromium,
// run `bun scripts/update-operator-console-label-baseline.mjs --check` before
// submitting changes to this fixture, its geometry helper or its bundled fonts.
// It installs/builds the frozen source in a temporary worktree. Use --write only
// for an intentional re-derivation, inspect the diff, then run --check separately.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { launchBrowser } from "../packages/cli/test/helpers/pdf-raster.ts";
import { wiringOutlineDistances } from "../packages/cli/test/helpers/svg-outline-geometry.ts";

const base = "d7f10b3439540b88a4546b1f754c44b763029b44";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = new URL(
  "../packages/cli/test/operator-console-label-baseline.json",
  import.meta.url,
);
const args = process.argv.slice(2);
if (args.length !== 1 || !["--check", "--write"].includes(args[0]))
  throw Error(
    "Use bun scripts/update-operator-console-label-baseline.mjs --check|--write",
  );
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });

async function frozenDrawings() {
  const temporary = await mkdtemp(
    join(await realpath(tmpdir()), "thermite-frozen-outline-"),
  );
  const checkout = join(temporary, "frozen source");
  let attached = false;
  try {
    git("worktree", "add", "--detach", checkout, base);
    attached = true;
    for (const args of [
      ["install", "--frozen-lockfile"],
      ["run", "build"],
    ])
      execFileSync(process.execPath, args, { cwd: checkout, stdio: "inherit" });
    const program = `
      import {compileProject} from "./packages/compiler/dist/index.js";
      import {renderSchematicPacket} from "./packages/render/dist/index.js";
      import {readFile} from "node:fs/promises";
      const project="examples/operator-console";
      const c=await compileProject(project); if(!c.ok)throw Error(JSON.stringify(c));
      const request=JSON.parse(await readFile(project+"/packet.request.json","utf8"));
      const r=await renderSchematicPacket(c.ir,request,c.presentation);
      if(!r.ok)throw Error(JSON.stringify(r));
      process.stdout.write(JSON.stringify(r.value.sheets.map(s=>({
        file:"sheet-"+String(s.number).padStart(3,"0")+".svg",svg:s.svg}))));`;
    return JSON.parse(
      execFileSync(process.execPath, ["--eval", program], {
        cwd: checkout,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      }),
    );
  } finally {
    if (attached) git("worktree", "remove", "--force", checkout);
    await rm(temporary, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function measure(drawings) {
  const browser = await launchBrowser(),
    page = await browser.newPage(),
    rows = [];
  try {
    for (const drawing of drawings) {
      // The old SVG requests Arial. This is explicitly a font-normalized layout
      // comparison, not a reconstruction of historical host Arial raster ink.
      const labels = await wiringOutlineDistances(page, drawing.svg, true);
      rows.push(
        ...labels.map((t) => ({
          file: drawing.file,
          text: t.text,
          dev: Number(t.distance.toFixed(4)),
        })),
      );
    }
  } finally {
    await page.close();
    await browser.close();
  }
  if (drawings.length !== 11 || rows.length !== 66)
    throw Error("Frozen drawing inventory changed");
  return ["left-to-right", "top-to-bottom"].flatMap((flow) =>
    rows.map((r) => ({
      ...r,
      file: `operator-console-${flow}/${r.file}`,
    })),
  );
}

const drawings = await frozenDrawings();
const fontSha256 = {};
for (const name of [
  "NotoSans-Regular",
  "NotoSans-Bold",
  "NotoSansMath-Regular",
])
  fontSha256[name] = sha256(
    await readFile(
      new URL(`../packages/render/assets/fonts/${name}.ttf`, import.meta.url),
    ),
  );
const data = {
  format: "operator-console-label-baseline/2.0",
  base,
  source:
    "Frozen commit's own locked renderer, operator-console source and packet.request.json; no current drawing input.",
  measurement:
    "Pinned printableTextMetrics outlines and SVG anchors/affine transforms/M-L vertices; mm after stroke subtraction, rounded to 0.0001 mm. Normalize legacy Arial requests to pinned Noto for a layout comparison, not historical Arial ink. Wiring has no flow: preserve the two legacy flow keys over 66 unique label instances.",
  generator: "bun scripts/update-operator-console-label-baseline.mjs --write",
  fontSha256,
  drawings: drawings.map((d) => ({ file: d.file, sha256: sha256(d.svg) })),
  rows: await measure(drawings),
};
const bytes = await format(JSON.stringify(data), { parser: "json" });
if (args[0] === "--write") await writeFile(output, bytes);
else if ((await readFile(output, "utf8")) !== bytes)
  throw Error("Frozen operator-console outline baseline is stale");
process.stdout.write(
  `Frozen outline baseline ${args[0]}: ${drawings.length} drawings, 66 labels, ${data.rows.length} comparisons.\n`,
);
