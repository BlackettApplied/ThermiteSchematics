import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pdfDocumentFixture } from "./pdf-document-fixture.mjs";
import { loadPdfBytes, pdfText, renderPdf, PDFJS_VERSION } from "./pdf.mjs";
import { pdfPageMetadata } from "./pdf-source-policy.mjs";
import {
  capturePdfCrop,
  preparePdfCrop,
  pdfCaptureEnvironment,
} from "./pdf-source.mjs";
import { readCropSource, verifyCropSources } from "./crop-source.mjs";
import { sourcePixelStats } from "./crop-source-pixels.mjs";
import { decodePng } from "./png-ink.mjs";
import { hash, canonical } from "./support.mjs";
async function fixture(rotation = 0, fontSize = 12, text = "LABEL") {
  const bytes = await pdfDocumentFixture(text, rotation, true, fontSize),
    doc = await loadPdfBytes(bytes);
  try {
    const page = await doc.getPage(1),
      meta = pdfPageMetadata(page),
      texts = await pdfText(page, doc.fontFamilies, doc.fontCaps),
      box = canonical(texts[0].bbox);
    let row = {
      text,
      path: "crop.png",
      scope: { case: "example", medium: "pdf" },
      physicalSheet: 1,
      classification: "drawing",
      instanceBbox: box,
      sourceBbox: { ...box },
      sourceRender: {
        medium: "pdf",
        pdf: "example/packet.pdf",
        pdfSha256: hash(bytes),
        backend: "pdf.js",
        pdfjsVersion: PDFJS_VERSION,
        page: meta,
      },
    };
    row = await preparePdfCrop(bytes, row);
    const expected = (await renderPdf(page, 300, row.sourceBbox)).toBuffer(
      "image/png",
    );
    return { bytes, row, expected };
  } finally {
    await doc.loadingTask.destroy();
  }
}
it("fresh PDF loads use the existing 300 dpi transform and ceiling dimensions", async () => {
  const c = await fixture();
  const renders = [];
  for (let n = 0; n < 3; n++)
    renders.push(await capturePdfCrop(c.bytes, c.row));
  for (const png of renders)
    expect(sourcePixelStats(c.expected, png)).toMatchObject({
      changed: 0,
      maximum: 0,
      absoluteError: 0,
    });
  const p = decodePng(renders[0]);
  expect(p.width).toBe(Math.ceil((c.row.sourceBbox.w * 300) / 25.4));
  expect(p.height).toBe(Math.ceil((c.row.sourceBbox.h * 300) / 25.4));
  expect(pdfCaptureEnvironment()).toMatchObject({
    pdfjsVersion: PDFJS_VERSION,
    dpi: 300,
    useSystemFonts: false,
    isEvalSupported: false,
    externalResources: "deny",
  });
});
it.each([90, 180, 270])(
  "loads the actual rotated physical page %s",
  async (rotation) => {
    const c = await fixture(rotation);
    expect(c.row.sourceRender.page.rotation).toBe(rotation);
    expect(
      sourcePixelStats(c.expected, await capturePdfCrop(c.bytes, c.row))
        .maximum,
    ).toBe(0);
  },
);
it.each([
  [
    "hash",
    (c) => (c.row.sourceRender.pdfSha256 = hash("wrong")),
    /bytes differ/,
  ],
  ["medium", (c) => (c.row.scope.medium = "svg"), /medium/],
  ["backend", (c) => (c.row.sourceRender.backend = "PDFKit"), /backend/],
  [
    "version",
    (c) => (c.row.sourceRender.pdfjsVersion = "1.0.0"),
    /installed version/,
  ],
  [
    "missing physical page",
    (c) => {
      c.row.physicalSheet = 2;
      c.row.sourceRender.page.number = 2;
    },
    /page is missing/,
  ],
  [
    "actual rotation",
    (c) => {
      const p = c.row.sourceRender.page;
      p.rotation = 90;
      [p.widthMm, p.heightMm] = [p.heightMm, p.widthMm];
    },
    /Actual PDF page/,
  ],
  [
    "actual dimensions",
    (c) => {
      const p = c.row.sourceRender.page;
      p.view[2] += 72;
      p.widthMm += 25.4;
    },
    /Actual PDF page/,
  ],
  ["missing instance", (c) => delete c.row.instanceBbox, /outside/],
  ["NaN box", (c) => (c.row.sourceBbox.x = NaN), /outside/],
  ["padded region", (c) => (c.row.sourceBbox.w += 1), /exactly/],
])("refuses PDF capture %s", async (_, edit, error) => {
  const c = await fixture();
  edit(c);
  await expect(capturePdfCrop(c.bytes, c.row)).rejects.toThrow(error);
});
it("never reopens the PDF path after checking its bytes", async () => {
  const c = await fixture(),
    root = await mkdtemp(join(tmpdir(), "pdf-source-bytes-"));
  try {
    await mkdir(join(root, "example"));
    const path = join(root, "example/packet.pdf");
    await writeFile(path, c.bytes);
    const source = await readCropSource(root, c.row);
    await writeFile(path, await pdfDocumentFixture("OTHER"));
    expect(
      sourcePixelStats(c.expected, await capturePdfCrop(source.bytes, c.row))
        .maximum,
    ).toBe(0);
    await expect(readCropSource(root, c.row)).rejects.toThrow(/hash differs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("PDF path and symlink containment refuse substitutions", async () => {
  const c = await fixture(),
    root = await mkdtemp(join(tmpdir(), "pdf-source-path-")),
    other = await mkdtemp(join(tmpdir(), "pdf-source-other-"));
  try {
    await writeFile(join(other, "packet.pdf"), c.bytes);
    await symlink(other, join(root, "example"), "junction");
    await expect(readCropSource(root, c.row)).rejects.toThrow(/under/);
    c.row.sourceRender.pdf = "../packet.pdf";
    await expect(readCropSource(root, c.row)).rejects.toThrow(/traversal/);
    c.row.sourceRender.pdf = join(other, "packet.pdf");
    await expect(readCropSource(root, c.row)).rejects.toThrow(/relative/);
    c.row.sourceRender.pdf = "example/sheet.svg";
    await expect(readCropSource(root, c.row)).rejects.toThrow(/delivered/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});
it("rejects non-PDF bytes even under a matching PDF hash", async () => {
  const c = await fixture(),
    bytes = Buffer.from("<svg/>");
  c.row.sourceRender.pdfSha256 = hash(bytes);
  await expect(capturePdfCrop(bytes, c.row)).rejects.toThrow(/not a PDF/);
});
it("verification attests PDF without launching Chromium and does not retry structural failures", async () => {
  const c = await fixture(),
    root = await mkdtemp(join(tmpdir(), "pdf-source-verify-"));
  try {
    await mkdir(join(root, "example"));
    await writeFile(join(root, "example/packet.pdf"), c.bytes);
    const proofs = await verifyCropSources(
      root,
      { crops: [c.row] },
      new Map([[c.row.path, c.expected]]),
    );
    expect(proofs.get(c.row.path)).toMatchObject({
      medium: "pdf",
      selectedAttempt: 1,
      pdf: { backend: "pdf.js", page: c.row.sourceRender.page },
      capture: pdfCaptureEnvironment(),
    });
    const p = c.row.sourceRender.page;
    p.rotation = 180;
    let error;
    try {
      await verifyCropSources(
        root,
        { crops: [c.row] },
        new Map([[c.row.path, c.expected]]),
      );
    } catch (e) {
      error = e;
    }
    expect(error.message).toMatch(/Actual PDF page/);
    expect(error.audit[0].attempts).toHaveLength(1);
    expect(error.audit[0].attempts[0].verdict).toBe("error");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("external font resources refuse even when pdf.js would use a fallback", async () => {
  const c = await fixture(),
    bytes = await pdfDocumentFixture("LABEL", 0, false);
  c.row.sourceRender.pdfSha256 = hash(bytes);
  await expect(capturePdfCrop(bytes, c.row)).rejects.toThrow(
    /External PDF resources/,
  );
});
it("PDF cache cannot reuse a raster for different pinned page metadata", async () => {
  const c = await fixture(),
    root = await mkdtemp(join(tmpdir(), "pdf-cache-"));
  try {
    await mkdir(join(root, "example"));
    await writeFile(join(root, "example/packet.pdf"), c.bytes);
    const other = structuredClone(c.row);
    other.path = "other.png";
    other.sourceRender.page.rotation = 180;
    await expect(
      verifyCropSources(
        root,
        { crops: [c.row, other] },
        new Map([
          [c.row.path, c.expected],
          [other.path, c.expected],
        ]),
      ),
    ).rejects.toThrow(/Actual PDF page/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("canonicalizes the verified shape before the existing raster transform", async () => {
  const first = await fixture();
  const c = await fixture(0, (12 * 14.223) / first.row.instanceBbox.w);
  c.row.sourceBbox = { ...c.row.sourceBbox, w: c.row.sourceBbox.w + 0.00049 };
  const png = decodePng(await capturePdfCrop(c.bytes, c.row));
  expect(png.width).toBe(
    Math.ceil((canonical(c.row.sourceBbox).w * 300) / 25.4),
  );
});

it.each([
  "omitted shape",
  "forged outline association",
  "forged font program",
  "wrong text",
])("capture refuses %s before rendering", async (mode) => {
  const c = await fixture();
  if (mode === "omitted shape") delete c.row.cropShape;
  if (mode === "forged outline association") c.row.cropShape.operators[0] += 1;
  if (mode === "forged font program")
    c.row.cropShape.fontPrograms = [hash("forged")];
  if (mode === "wrong text") c.row.text = "OTHER";
  await expect(capturePdfCrop(c.bytes, c.row)).rejects.toThrow(
    mode === "omitted shape"
      ? /requires em\+ink/
      : /association|independently derived/,
  );
});

it("PDF cache cannot bypass a changed glyph association on an otherwise identical crop", async () => {
  const c = await fixture(),
    root = await mkdtemp(join(tmpdir(), "pdf-ink-cache-"));
  try {
    await mkdir(join(root, "example"));
    await writeFile(join(root, "example/packet.pdf"), c.bytes);
    const other = structuredClone(c.row);
    other.path = "forged.png";
    other.cropShape.operators[0] += 1;
    await expect(
      verifyCropSources(
        root,
        { crops: [c.row, other] },
        new Map([
          [c.row.path, c.expected],
          [other.path, c.expected],
        ]),
      ),
    ).rejects.toThrow(/independently derived/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each(["Q", "g", "j", "f"])(
  "includes actual embedded %s ink outside the exported em box",
  async (text) => {
    const c = await fixture(0, 12, text),
      e = c.row.instanceBbox,
      i = c.row.cropShape.inkBbox;
    if (text === "j") expect(i.x).toBeLessThan(e.x);
    if (text === "f") expect(i.x + i.w).toBeGreaterThan(e.x + e.w);
    if (text === "Q" || text === "g")
      expect(i.y + i.h).toBeGreaterThan(e.y + e.h);
    expect(
      sourcePixelStats(c.expected, await capturePdfCrop(c.bytes, c.row))
        .maximum,
    ).toBe(0);
  },
);
