import { it, expect, vi } from "vitest";
import { mkdtemp, writeFile, rm, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hash } from "./support.mjs";
import { sourceGeometryFixture } from "./crop-source-fixture.mjs";
import { pngFixture } from "./png-fixture.mjs";
const fake = vi.hoisted(() => ({
  page: { setContent: vi.fn(), evaluate: vi.fn(), emulateMedia: vi.fn() },
  close: vi.fn(),
  launch: vi.fn(),
  openSheet: vi.fn(),
  screenshotCrop: vi.fn(),
  route: vi.fn(),
  contextClose: vi.fn(),
  newContext: vi.fn(),
}));
vi.mock("./browser.mjs", () => ({
  launch: fake.launch,
  drawingLaunchArgs: [],
  drawingContextOptions: {
    offline: true,
    serviceWorkers: "block",
    javaScriptEnabled: false,
    deviceScaleFactor: 300 / 96,
  },
  openSheet: fake.openSheet,
  screenshotCrop: fake.screenshotCrop,
}));
import {
  readCropSource,
  renderSourceCrop,
  verifyCropSources,
} from "./crop-source.mjs";
function row() {
  return {
    path: "crop.png",
    scope: { medium: "svg" },
    physicalSheet: 1,
    ...sourceGeometryFixture(),
    sourceRender: {
      medium: "svg",
      svg: "sheet.svg",
      svgSha256: hash("<svg/>"),
    },
  };
}
async function files(fn) {
  const root = await mkdtemp(join(tmpdir(), "thermite-source-"));
  try {
    await writeFile(join(root, "sheet.svg"), "<svg/>");
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
it("reads hash-bound SVG source", () =>
  files(async (root) =>
    expect((await readCropSource(root, row())).text).toBe("<svg/>"),
  ));
it.each([
  ["medium", (r) => (r.sourceRender.medium = "html"), /medium/],
  ["scope", (r) => (r.scope.medium = "html"), /medium/],
  ["absolute", (r) => (r.sourceRender.svg = "/sheet.svg"), /relative/],
  ["traversal", (r) => (r.sourceRender.svg = "../sheet.svg"), /traversal/],
  ["hash", (r) => (r.sourceRender.svgSha256 = hash("changed")), /hash/],
])("refuses source %s", (_, mutate, error) =>
  files(async (root) => {
    const r = row();
    mutate(r);
    await expect(readCropSource(root, r)).rejects.toThrow(error);
  }),
);
it("refuses a source symlink outside its checkpoint", () =>
  files(async (root) => {
    const other = await mkdtemp(join(tmpdir(), "thermite-other-source-"));
    try {
      await writeFile(join(other, "sheet.svg"), "<svg/>");
      await symlink(other, join(root, "escape"), "junction");
      const r = row();
      r.sourceRender.svg = "escape/sheet.svg";
      await expect(readCropSource(root, r)).rejects.toThrow(/under/);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  }));
function browser() {
  fake.newContext.mockReset().mockImplementation(async () => ({
    route: fake.route,
    newPage: async () => fake.page,
    close: fake.contextClose,
  }));
  fake.contextClose.mockReset();
  fake.launch.mockReset().mockResolvedValue({
    version: () => "synthetic",
    newContext: fake.newContext,
    close: fake.close,
  });
  fake.page.evaluate.mockReset().mockResolvedValue({ w: 100, h: 100 });
  fake.screenshotCrop.mockReset().mockResolvedValue(pngFixture());
  fake.page.setContent.mockClear();
  fake.openSheet.mockClear();
  fake.close.mockClear();
}
it("requires source-root instead of silently skipping cropped inputs", async () => {
  await expect(
    verifyCropSources(undefined, { crops: [row()] }, new Map()),
  ).rejects.toThrow(/no source checks are skipped/);
});
it("does not need Chromium for a crop-free draft", async () =>
  expect(await verifyCropSources(undefined, { crops: [] }, new Map())).toEqual(
    new Map(),
  ));
it.each(["left", "top", "right", "bottom"])(
  "refuses source crop beyond %s sheet edge",
  async (edge) => {
    browser();
    const r = row();
    r.sourceBbox = { x: 0, y: 0, w: 3, h: 3 };
    if (edge === "left") r.sourceBbox.x = -1;
    if (edge === "top") r.sourceBbox.y = -1;
    if (edge === "right") r.sourceBbox.x = 99;
    if (edge === "bottom") r.sourceBbox.y = 99;
    await expect(renderSourceCrop(fake.page, "<svg/>", r)).rejects.toThrow(
      /physical sheet/,
    );
  },
);
it("uses the actual HTML sheet instead of a standalone SVG", async () => {
  browser();
  const r = row();
  r.scope.medium = "html";
  r.physicalSheet = 2;
  await renderSourceCrop(fake.page, "<html/>", r);
  expect(fake.page.setContent).toHaveBeenCalledWith("<html/>");
  expect(fake.openSheet).not.toHaveBeenCalled();
  expect(fake.screenshotCrop).toHaveBeenCalledWith(
    fake.page,
    r.sourceBbox,
    undefined,
    "#sheet-2>svg",
  );
});
it("verifies pixels and closes Chromium after success or refusal", () =>
  files(async (root) => {
    browser();
    const r = row();
    const proofs = await verifyCropSources(
      root,
      { crops: [r] },
      new Map([[r.path, pngFixture()]]),
    );
    expect(proofs.get(r.path)).toMatchObject({
      sourceSha256: r.sourceRender.svgSha256,
      dpi: 300,
      medium: "svg",
      sheet: 1,
    });
    expect(fake.close).toHaveBeenCalledTimes(1);
    fake.screenshotCrop.mockResolvedValue(pngFixture({ seed: 10 }));
    await expect(
      verifyCropSources(
        root,
        { crops: [r] },
        new Map([[r.path, pngFixture()]]),
      ),
    ).rejects.toThrow(/pixel/);
    expect(fake.close).toHaveBeenCalledTimes(2);
  }));
it("fails containment before rendering the wrong representative", () =>
  files(async (root) => {
    browser();
    const r = row();
    r.instanceBbox.x = 40;
    await expect(
      verifyCropSources(
        root,
        { crops: [r] },
        new Map([[r.path, pngFixture()]]),
      ),
    ).rejects.toThrow(/outside/);
    expect(fake.openSheet).not.toHaveBeenCalled();
  }));
it("requires a positive integer physical page", () =>
  files(async (root) => {
    browser();
    const r = row();
    r.physicalSheet = 0;
    await expect(
      verifyCropSources(root, { crops: [r] }, new Map()),
    ).rejects.toThrow(/physicalSheet/);
  }));
it("does not turn missing Chromium into a skip", () =>
  files(async (root) => {
    browser();
    fake.launch.mockRejectedValue(
      Error("Chromium missing. No checks were skipped."),
    );
    await expect(
      verifyCropSources(
        root,
        { crops: [row()] },
        new Map([["crop.png", pngFixture()]]),
      ),
    ).rejects.toThrow(/No checks were skipped/);
  }));
it("refuses absolute or traversing spellings even when they resolve inside the source root", () =>
  files(async (root) => {
    for (const path of [join(root, "sheet.svg"), "nested/../sheet.svg"]) {
      const r = row();
      r.sourceRender.svg = path;
      await expect(readCropSource(root, r)).rejects.toThrow(
        /relative without traversal/,
      );
    }
  }));
it("refuses an otherwise readable PDF claim as an SVG source", () =>
  files(async (root) => {
    const r = row();
    r.scope.medium = r.sourceRender.medium = "pdf";
    r.sourceRender.pdf = "sheet.svg";
    r.sourceRender.pdfSha256 = r.sourceRender.svgSha256;
    await expect(readCropSource(root, r)).rejects.toThrow(
      /PDF source must name/,
    );
  }));

it("renders the canonical recorded box rather than checking full precision then rounding it", async () => {
  browser();
  const r = row();
  r.sourceBbox = { x: 1.00049, y: 2.00051, w: 3.00049, h: 4.00051 };
  await renderSourceCrop(fake.page, "<svg/>", r);
  expect(fake.screenshotCrop).toHaveBeenCalledWith(
    fake.page,
    { x: 1, y: 2.001, w: 3, h: 4.001 },
    undefined,
    "body>svg",
  );
});
it("reports every refused crop rather than stopping at the first", () =>
  files(async (root) => {
    browser();
    const a = row(),
      b = { ...row(), path: "other.png" };
    a.sourceRender.svgSha256 = hash("bad A");
    b.sourceRender.svgSha256 = hash("bad B");
    await expect(
      verifyCropSources(root, { crops: [a, b] }, new Map()),
    ).rejects.toThrow(/2 crop\(s\):\ncrop.png:[\s\S]*other.png:/);
  }));
it.each([1, 2, 3])("captures attempt %s in its own isolated context", (n) =>
  files(async (root) => {
    browser();
    let captured = 0;
    fake.screenshotCrop.mockImplementation(async () =>
      ++captured === n ? pngFixture() : pngFixture({ seed: 10 }),
    );
    const r = row(),
      proofs = await verifyCropSources(
        root,
        { crops: [r] },
        new Map([[r.path, pngFixture()]]),
      );
    expect(proofs.get(r.path).selectedAttempt).toBe(n);
    expect(fake.newContext).toHaveBeenCalledTimes(n);
    expect(fake.contextClose).toHaveBeenCalledTimes(n);
    for (const [options] of fake.newContext.mock.calls)
      expect(options).toMatchObject({
        offline: true,
        serviceWorkers: "block",
        javaScriptEnabled: false,
        deviceScaleFactor: 300 / 96,
      });
  }),
);
it.each(["dimensions", "alpha", "infrastructure"])(
  "does not retry a %s error",
  (kind) =>
    files(async (root) => {
      browser();
      const r = row();
      if (kind === "infrastructure")
        fake.screenshotCrop.mockRejectedValue(Error("capture crashed"));
      else
        fake.screenshotCrop.mockResolvedValue(
          kind === "dimensions"
            ? pngFixture({ width: 5 })
            : pngFixture({ pixel: () => [0, 0, 0, 0] }),
        );
      await expect(
        verifyCropSources(
          root,
          { crops: [r] },
          new Map([[r.path, pngFixture()]]),
        ),
      ).rejects.toThrow();
      expect(fake.newContext).toHaveBeenCalledTimes(1);
      expect(fake.contextClose).toHaveBeenCalledTimes(1);
    }),
);
it.each(["source", "medium", "page", "box", "crop"])(
  "isolates the raster cache by %s",
  (kind) =>
    files(async (root) => {
      browser();
      const a = row(),
        b = {
          ...row(),
          path: "other.png",
          scope: { ...row().scope },
          sourceRender: { ...row().sourceRender },
        };
      if (kind === "source") {
        await writeFile(join(root, "other.svg"), "<svg id='other'/>");
        b.sourceRender.svg = "other.svg";
        b.sourceRender.svgSha256 = hash("<svg id='other'/>");
      }
      if (kind === "medium") {
        b.scope.medium = b.sourceRender.medium = "html";
        b.sourceRender.html = "sheet.svg";
        b.sourceRender.htmlSha256 = a.sourceRender.svgSha256;
      }
      if (kind === "page") b.physicalSheet = 2;
      if (kind === "box") b.sourceBbox = { ...b.sourceBbox, w: 4 };
      const crops = new Map([
        [a.path, pngFixture()],
        [b.path, kind === "crop" ? pngFixture({ seed: 10 }) : pngFixture()],
      ]);
      if (kind === "crop")
        await expect(
          verifyCropSources(root, { crops: [a, b] }, crops),
        ).rejects.toThrow(/3 attempts/);
      else await verifyCropSources(root, { crops: [a, b] }, crops);
      expect(fake.newContext).toHaveBeenCalledTimes(kind === "crop" ? 4 : 2);
    }),
);
it("shares only identical capture inputs, comparing every citation", () =>
  files(async (root) => {
    browser();
    const a = row(),
      b = { ...row(), path: "copy.png" };
    const p = await verifyCropSources(
      root,
      { crops: [a, b] },
      new Map([
        [a.path, pngFixture()],
        [b.path, pngFixture()],
      ]),
    );
    expect(fake.newContext).toHaveBeenCalledTimes(1);
    expect(p.size).toBe(2);
    expect(p.get(a.path)).not.toBe(p.get(b.path));
  }));
