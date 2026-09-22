import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const helper = resolve("scripts/library-batch/research-tools.py");
const python = process.env.THERMITE_RESEARCH_PYTHON ?? "python3";
const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0))
    rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const path = mkdtempSync(join(tmpdir(), "thermite-pdf-clip-"));
  temporary.push(path);
  mkdirSync(join(path, "references"));
  mkdirSync(join(path, "runtime"));
  writeFileSync(
    join(path, "job.json"),
    JSON.stringify({ pdfModulePath: join(path, "runtime") }),
  );
  const source = join(path, "references/manual.pdf");
  writeFileSync(source, "synthetic document; never a manufacturer source");
  // Observe allocation and renderer arguments without requiring PyMuPDF in CI.
  writeFileSync(
    join(path, "runtime/pymupdf.py"),
    `import json, pathlib
Matrix = lambda *values: values
Rect = tuple
class Pixmap:
    width, height = 31, 47
    def __init__(self, arguments): self.arguments = arguments
    def save(self, output): output.write_text(json.dumps(self.arguments))
class Page:
    def __init__(self, rect): self.rect = rect
    def get_pixmap(self, **arguments):
        pathlib.Path("allocated").touch()
        return Pixmap(arguments)
class Document:
    pages = [Page((0,0,612,792)), Page((0,0,144,144)), Page((0,0,4000,4000))]
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def __len__(self): return len(self.pages)
    def __getitem__(self, index): return self.pages[index]
def open(path): return Document()
`,
  );
  const run = (...args: string[]) => {
    const result = spawnSync(
      python,
      [helper, "render", "references/manual.pdf", "--pages", "1", ...args],
      { cwd: path, encoding: "utf8", timeout: 10_000 },
    );
    expect(result.error).toBeUndefined();
    return result;
  };
  return { path, source, run };
}

it("keeps full-page output, records crop provenance and leaves the PDF intact", () => {
  const f = fixture(),
    original = readFileSync(f.source);
  const full = f.run("--dpi", "180");
  expect(full.status, full.stderr).toBe(0);
  const fullRecord = JSON.parse(full.stdout);
  expect(fullRecord).toMatchObject({
    image: "references/manual-page-1.png",
    dpi: 180,
    rect: [0, 0, 612, 792],
    clipped: false,
  });
  const fullBytes = readFileSync(join(f.path, fullRecord.image));
  const crop = f.run("--clip", "0.1,0.1,72.1,72.1", "--dpi", "600");
  expect(crop.status, crop.stderr).toBe(0);
  const record = JSON.parse(crop.stdout);
  expect(record).toMatchObject({
    source: "references/manual.pdf",
    page: 1,
    image: "references/manual-page-1-clip-0.1_0.1_72.1_72.1-600dpi.png",
    rect: [0.1, 0.1, 72.1, 72.1],
    dpi: 600,
    clipped: true,
    width: 31,
    height: 47,
    pixelUpperBound: 601 * 601,
  });
  const renderedArguments = JSON.parse(
    readFileSync(join(f.path, record.image), "utf8"),
  );
  expect(renderedArguments).toEqual({
    clip: record.rect,
    matrix: [600 / 72, 600 / 72],
  });
  expect(
    JSON.parse(
      readFileSync(join(f.path, record.image + ".metadata.json"), "utf8"),
    ),
  ).toEqual(record);
  expect(readFileSync(join(f.path, fullRecord.image))).toEqual(fullBytes);
  expect(readFileSync(f.source)).toEqual(original);
});

it.each([
  ["NaN,0,10,10", "finite"],
  ["0,0,Infinity,10", "finite"],
  ["0,0,no,10", "finite"],
  ["0,0,10", "four"],
  ["10,0,10,20", "increase"],
  ["0,20,10,10", "increase"],
  ["-1,0,10,10", "within"],
  ["0,0,613,10", "within"],
])("rejects invalid crop %s before allocating", (clip, message) => {
  const f = fixture(),
    result = f.run(`--clip=${clip}`);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(message);
  expect(existsSync(join(f.path, "allocated"))).toBe(false);
});

it.each([
  ["--dpi", "600"],
  ["--clip", "0,0,72,72", "--dpi", "601"],
  ["--clip", "0,0,72,72", "--dpi", "71"],
  ["--pages", Array(13).fill("1").join(",")],
])("preserves page-count and resolution limits: %j", (...args) => {
  const f = fixture(),
    result = f.run(...args);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("at most 12 selected pages");
  expect(existsSync(join(f.path, "allocated"))).toBe(false);
});

it.each([
  ["--clip", "0,0,500,700", "--dpi", "600"],
  ["--pages", "3", "--dpi", "72"],
  ["--pages", "1,2", "--clip", "72,72,216,216"],
  ["--pages", "1,4"],
])(
  "rejects oversized or invalid later pages before any allocation: %j",
  (...args) => {
    const f = fixture(),
      result = f.run(...args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/pixel limit|within|Page outside/);
    expect(existsSync(join(f.path, "allocated"))).toBe(false);
    expect(readdirSync(join(f.path, "references"))).toEqual(["manual.pdf"]);
  },
);
