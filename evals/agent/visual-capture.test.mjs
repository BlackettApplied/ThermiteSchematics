import { afterEach, expect, it, vi } from "vitest";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { chromium } from "playwright-core";
import { captureHtml, captureInput, visualBroker } from "./visual-capture.mjs";
import { sha256 } from "./snapshot.mjs";

// Race hooks run between the broker's checks and its reads or writes.
// - A write race runs `swap` once, just before the first write to a matching
//   path.
// - A read race replaces an input after the reader checks its pinned root
//   and before it opens the descendant.
const race = vi.hoisted(() => {
  const state = { pending: null, swapped: false, fired: 0, fds: new Map() };
  const matches = (op, path) =>
    state.pending?.op === op &&
    (typeof state.pending.path === "function"
      ? state.pending.path(path)
      : state.pending.path === path);
  return {
    state,
    arm(op, path, swap, restore) {
      Object.assign(state, {
        pending: { op, path, swap, restore },
        swapped: false,
        fired: 0,
      });
    },
    beforeCheck(path) {
      if (!matches("read", path) || !state.swapped) return;
      state.pending.restore();
      state.swapped = false;
    },
    afterCheck(path) {
      if (!matches("read", path)) return;
      state.pending.swap();
      state.swapped = true;
      state.fired++;
    },
    beforeWrite(path) {
      if (!matches("write", path)) return;
      const { swap } = state.pending;
      state.pending = null;
      state.fired++;
      swap();
    },
  };
});
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal();
  const realpathSync = Object.assign(
    (path, ...rest) => {
      race.beforeCheck(String(path));
      const result = fs.realpathSync(path, ...rest);
      race.afterCheck(String(path));
      return result;
    },
    { native: fs.realpathSync.native },
  );
  const hooked = {
    realpathSync,
    openSync(path, ...rest) {
      const fd = fs.openSync(path, ...rest);
      race.state.fds.set(fd, String(path));
      return fd;
    },
    closeSync(fd) {
      const tracked = race.state.fds.delete(fd);
      fs.closeSync(fd);
      // Descriptors from openat are untracked: fail the first such close.
      if (!tracked && race.state.closeError) {
        race.state.closeError = false;
        throw new Error("close failed");
      }
    },
    ftruncateSync(fd, ...rest) {
      race.beforeWrite(race.state.fds.get(fd));
      return fs.ftruncateSync(fd, ...rest);
    },
    writeFileSync(path, ...rest) {
      race.beforeWrite(
        typeof path === "number" ? race.state.fds.get(path) : String(path),
      );
      return fs.writeFileSync(path, ...rest);
    },
  };
  return { ...fs, ...hooked, default: { ...fs.default, ...hooked } };
});

const work = [];
afterEach(() => {
  race.state.pending = null;
  race.state.closeError = false;
  vi.restoreAllMocks();
  for (const root of work.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const red = "<!doctype html><body style='margin:0;background:#ff0000'>";
const blue = "<!doctype html><body style='margin:0;background:#0000ff'>";
const windowsError =
  "Visual capture is unavailable on Windows: project files cannot be opened there without following links";

function fixture(html = "<p>Capture fixture</p>") {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "thermite-visual-test-")),
  );
  work.push(root);
  const paths = {
    root,
    project: join(root, "project"),
    evidence: join(root, "evidence"),
    outside: join(root, "outside"),
    // Where a direct caller puts outputs; the broker links its own.
    outputs: join(root, "harness-out"),
  };
  for (const dir of ["project", "evidence", "outside", "outputs"])
    mkdirSync(paths[dir]);
  writeFileSync(join(paths.project, "index.html"), html);
  paths.sentinel = join(paths.outside, "sentinel");
  writeFileSync(paths.sentinel, "untouched");
  // A harness-readable page the agent must not be able to capture.
  writeFileSync(join(paths.outside, "index.html"), blue);
  writeFileSync(join(paths.outside, "page.html"), blue);
  paths.link = join(paths.project, "visual-captures");
  return paths;
}
const outsideFiles = ["index.html", "page.html", "sentinel"];

const link = (target, path) =>
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
const fileLink = (target, path) => symlinkSync(target, path, "file");
// Replace `path` with a link to `target`, keeping the project entry aside.
function toggle(path, target, linkTo = link) {
  const aside = path + ".aside";
  return [
    () => {
      renameSync(path, aside);
      linkTo(target, path);
    },
    () => {
      unlinkSync(path);
      renameSync(aside, path);
    },
  ];
}

// Real Chromium; only screenshot({ path }) is wrapped so a write that
// Playwright performs by pathname gets the same race hook.
function hookScreenshots() {
  const wrapContext = (context) => {
    const newPage = context.newPage.bind(context);
    context.newPage = async (...args) => {
      const page = await newPage(...args);
      const screenshot = page.screenshot.bind(page);
      page.screenshot = async (options = {}) => {
        if (options.path) race.beforeWrite(options.path);
        return screenshot(options);
      };
      return page;
    };
    return context;
  };
  const persistent = chromium.launchPersistentContext.bind(chromium);
  vi.spyOn(chromium, "launchPersistentContext").mockImplementation(
    async (...args) => wrapContext(await persistent(...args)),
  );
}

function stubScreenshot(duringScreenshot = () => {}) {
  const screenshot = vi.fn(async () => {
    duringScreenshot();
    return Buffer.from("synthetic PNG bytes");
  });
  const context = {
    route: async () => {},
    newPage: async () => ({
      goto: async () => {},
      screenshot,
      close: async () => {},
    }),
    close: async () => {},
  };
  vi.spyOn(chromium, "launchPersistentContext").mockResolvedValue(context);
  return screenshot;
}

const waitFor = (check) => vi.waitFor(check, { timeout: 15000 });
const readReceipt = (path) =>
  waitFor(() => JSON.parse(readFileSync(path, "utf8")));
const request = (project, body) =>
  writeFileSync(
    join(project, "visual-capture.request.json"),
    JSON.stringify(body),
  );

async function asWindows(run) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
}

// B1: Windows has no descriptor-relative open, so capture fails closed there.
it("refuses Windows capture before reading project files", async () => {
  const { project, evidence, outputs, link } = fixture(red);
  const screenshot = stubScreenshot();
  await asWindows(async () => {
    await expect(
      captureHtml(project, { html: ["index.html"] }, outputs),
    ).rejects.toThrow(windowsError);
    expect(() => captureInput(project, "index.html")).toThrow(windowsError);
    const stop = await visualBroker({ visualCapture: true }, project, evidence);
    try {
      request(project, { html: ["index.html"] });
      expect(await readReceipt(join(link, "result.json"))).toEqual({
        error: windowsError,
      });
    } finally {
      await stop();
    }
  });
  expect(screenshot).not.toHaveBeenCalled();
  expect(readdirSync(outputs)).toEqual([]);
  expect(
    JSON.parse(
      readFileSync(join(evidence, "visual-captures/result.json"), "utf8"),
    ),
  ).toEqual({ error: windowsError });
});

// The remaining cases exercise capture itself, which Windows refuses.
if (process.platform !== "win32") {
  // B2: the broker writes only to its own evidence directory.
  it("keeps writing to its own directory after the project link moves outside", async () => {
    const { project, evidence, outside, link, sentinel } = fixture();
    const moved = join(outside, "moved");
    stubScreenshot(() => {
      if (existsSync(link)) renameSync(link, moved);
    });
    const stop = await visualBroker({ visualCapture: true }, project, evidence);
    try {
      request(project, { html: ["index.html"] });
      const receipt = await readReceipt(join(moved, "result.json"));
      expect(receipt.files[0].sha256).toBe(sha256("synthetic PNG bytes"));
      // Nothing was written in the agent-writable sibling: the moved entry is
      // still the broker's link, not a directory of PNGs.
      expect(lstatSync(moved).isSymbolicLink()).toBe(true);
      expect(readdirSync(outside).sort()).toEqual(
        [...outsideFiles, "moved"].sort(),
      );
    } finally {
      await stop();
    }
    expect(readFileSync(sentinel, "utf8")).toBe("untouched");
    expect(readFileSync(join(evidence, "visual-captures/01.png"), "utf8")).toBe(
      "synthetic PNG bytes",
    );
  });

  it("publishes into evidence through a project link removed after the run", async () => {
    const { project, evidence, link } = fixture();
    const screenshot = stubScreenshot();
    const outputs = join(evidence, "visual-captures");
    const stop = await visualBroker({ visualCapture: true }, project, evidence);
    try {
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(realpathSync(readlinkSync(link))).toBe(outputs);
      // Nothing is published until a capture completes.
      expect(readdirSync(link)).toEqual([]);
      const slots = ["01.png", "02.png", "03.png", "04.png"];
      for (const [nonce, expected] of [
        ["first page", "first second page"],
        ["second"],
      ].entries()) {
        // M1: a refresh removes the old receipt before rendering.
        let receiptDuringCapture;
        screenshot.mockImplementationOnce(async () => {
          receiptDuringCapture = existsSync(join(link, "result.json"));
          return Buffer.from(expected[0]);
        });
        for (const bytes of expected.slice(1))
          screenshot.mockResolvedValueOnce(Buffer.from(bytes));
        request(project, { html: expected.map(() => "index.html"), nonce });
        await waitFor(() => {
          const result = JSON.parse(
            readFileSync(join(link, "result.json"), "utf8"),
          );
          expect(result.files.map((file) => file.sha256)).toEqual(
            expected.map(sha256),
          );
        });
        expect(receiptDuringCapture).toBe(false);
        expect(readdirSync(link).sort()).toEqual(
          [...slots.slice(0, expected.length), "result.json"].sort(),
        );
        for (const [index, bytes] of expected.entries())
          expect(readFileSync(join(link, slots[index]), "utf8")).toBe(bytes);
        expect(readdirSync(evidence)).toEqual(["visual-captures"]);
      }
    } finally {
      await stop();
    }
    expect(existsSync(link)).toBe(false);
    expect(
      JSON.parse(readFileSync(join(outputs, "result.json"), "utf8")).files[0]
        .sha256,
    ).toBe(sha256("second"));
    expect(readdirSync(outputs).sort()).toEqual(["01.png", "result.json"]);
  });

  it("refuses a visual-captures entry the agent could have planted", async () => {
    const { project, evidence, link } = fixture();
    mkdirSync(link);
    await expect(
      visualBroker({ visualCapture: true }, project, evidence),
    ).rejects.toThrow("visual-captures must not exist");
  });

  it("leaves the replacement project alone during broker cleanup", async () => {
    const { project, evidence, outside } = fixture();
    const stop = await visualBroker({ visualCapture: true }, project, evidence);
    const original = project + "-original";
    const replacementLink = join(outside, "visual-captures");
    try {
      renameSync(project, original);
      link(outside, project);
      link(join(evidence, "visual-captures"), replacementLink);
    } finally {
      await stop();
    }
    expect(lstatSync(replacementLink).isSymbolicLink()).toBe(true);
    expect(existsSync(join(original, "visual-captures"))).toBe(false);
  });

  // M1: the receipt is written only after every PNG matches it.
  it("publishes an error when an earlier PNG changes before the receipt", async () => {
    const { project, evidence, link } = fixture();
    const screenshot = stubScreenshot();
    for (const bytes of ["page one", "page two"])
      screenshot.mockResolvedValueOnce(Buffer.from(bytes));
    race.arm(
      "write",
      (path) => /02\.png(\.partial)?$/.test(path ?? ""),
      () => writeFileSync(join(link, "01.png"), "tampered"),
    );
    const stop = await visualBroker({ visualCapture: true }, project, evidence);
    try {
      request(project, { html: ["index.html", "index.html"] });
      expect(await readReceipt(join(link, "result.json"))).toEqual({
        error: "Capture output changed",
      });
      expect(race.state.fired).toBe(1);
    } finally {
      await stop();
    }
  });

  // M2: a rejected request leaves nothing behind that blocks a retry.
  it("validates a direct request before writing, so a retry succeeds", async () => {
    const { project, outputs } = fixture();
    stubScreenshot();
    for (const html of [[], ["https://example.com/"], ["../index.html"]]) {
      await expect(captureHtml(project, { html }, outputs)).rejects.toThrow();
      expect(readdirSync(outputs)).toEqual([]);
    }
    expect(existsSync(join(project, "visual-captures"))).toBe(false);
    const result = await captureHtml(
      project,
      { html: ["index.html"] },
      outputs,
    );
    expect(result.files[0].sha256).toBe(sha256("synthetic PNG bytes"));
    expect(readdirSync(outputs).sort()).toEqual(["01.png", "result.json"]);
  });

  // m4: a direct refresh hides the old receipt while it renders.
  it("removes the previous direct receipt before rendering again", async () => {
    const { project, outputs } = fixture();
    const screenshot = stubScreenshot();
    await captureHtml(project, { html: ["index.html"] }, outputs);
    let receiptDuringCapture;
    screenshot.mockImplementationOnce(async () => {
      receiptDuringCapture = existsSync(join(outputs, "result.json"));
      return Buffer.from("refreshed");
    });
    await captureHtml(project, { html: ["index.html"] }, outputs);
    expect(receiptDuringCapture).toBe(false);
    expect(readFileSync(join(outputs, "01.png"), "utf8")).toBe("refreshed");
  });

  // m1: a close that throws must not strand the opened input descriptor.
  it("closes the opened input when closing its directory throws", () => {
    const { project } = fixture();
    mkdirSync(join(project, "drawings"));
    writeFileSync(join(project, "drawings/page.html"), red);
    const open = () => readdirSync("/dev/fd").length;
    const before = open();
    race.state.closeError = true;
    expect(() => captureInput(project, "drawings/page.html")).toThrow(
      "close failed",
    );
    expect(race.state.closeError).toBe(false);
    expect(open()).toBe(before);
  });

  async function color(png, x) {
    const image = await loadImage(png);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    return Array.from(ctx.getImageData(x, 5, 1, 1).data);
  }

  // Colours at x of every non-empty PNG in `outputs`.
  async function capturedColors(outputs, x) {
    const colors = [];
    for (const name of readdirSync(outputs))
      if (name.endsWith(".png")) {
        const png = readFileSync(join(outputs, name));
        if (png.length) colors.push(await color(png, x));
      }
    return colors;
  }
  const outsideBlue = [0, 0, 255, 255];

  it.each([
    ["HTML input", "index.html", "index.html", fileLink],
    ["input ancestor directory", "drawings/page.html", "drawings", link],
  ])(
    "an %s swapped for a symlink between check and read is never read",
    async (_, input, entry, linkTo) => {
      const paths = fixture(red);
      mkdirSync(join(paths.project, "drawings"));
      writeFileSync(join(paths.project, "drawings/page.html"), red);
      hookScreenshots();
      const target =
        entry === "drawings" ? paths.outside : join(paths.outside, entry);
      race.arm(
        "read",
        paths.project,
        ...toggle(join(paths.project, entry), target, linkTo),
      );
      const result = await captureHtml(
        paths.project,
        { html: [input] },
        paths.outputs,
      ).catch((e) => e);
      expect(race.state.fired).toBeGreaterThan(0);
      expect(await capturedColors(paths.outputs, 5)).not.toContainEqual(
        outsideBlue,
      );
      expect(JSON.stringify(result.files ?? [])).not.toContain(sha256(blue));
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe(
        "Capture input must be an ordinary file inside project",
      );
    },
  );

  it("a local HTML subresource swapped for a symlink between check and read is never read", async () => {
    const html = `<!doctype html><style>
      body{margin:0;background:#ff0000}
      iframe{position:absolute;top:0;left:20px;width:12px;height:12px;border:0}
    </style><iframe src="frame.html"></iframe>`;
    const paths = fixture(html);
    const frame = join(paths.project, "frame.html");
    writeFileSync(frame, '<body style="margin:0;background:#00ff00">');
    hookScreenshots();
    race.arm(
      "read",
      paths.project,
      ...toggle(frame, join(paths.outside, "page.html"), fileLink),
    );
    const result = await captureHtml(
      paths.project,
      { html: ["index.html"] },
      paths.outputs,
    ).catch((e) => e);
    expect(race.state.fired).toBeGreaterThan(0);
    expect(await capturedColors(paths.outputs, 25)).not.toContainEqual(
      outsideBlue,
    );
    expect(result).not.toBeInstanceOf(Error);
    expect(await color(readFileSync(join(paths.outputs, "01.png")), 5)).toEqual(
      [255, 0, 0, 255],
    );
  });

  it("refuses hard-linked input files", () => {
    const { project, sentinel } = fixture();
    linkSync(sentinel, join(project, "alias.html"));
    expect(() => captureInput(project, "alias.html")).toThrow("ordinary file");
    expect(readFileSync(sentinel, "utf8")).toBe("untouched");
  });

  it("renders the hashed HTML snapshot, local HTML and data URLs with CSS files blocked", async () => {
    const data =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="#ffff00"/></svg>',
      );
    // Relative and root-relative project paths both resolve.
    const html = `<!doctype html><style>
      body{background:#ff0000}
      iframe,img{position:absolute;top:0;width:12px;height:12px;border:0}
      #relative{left:20px} img{left:40px} #rooted{left:60px}
    </style><link rel="stylesheet" href="outside.css">
    <iframe id="relative" src="frame.html"></iframe><img src="${data}">
    <iframe id="rooted" src="/drawings/frame.html"></iframe>`;
    const { project, outputs } = fixture(html);
    writeFileSync(
      join(project, "frame.html"),
      '<body style="background:#00ff00">',
    );
    mkdirSync(join(project, "drawings"));
    writeFileSync(
      join(project, "drawings/frame.html"),
      '<body style="background:#ff00ff">',
    );
    writeFileSync(
      join(project, "outside.css"),
      "body{background:blue !important}",
    );
    const launch = chromium.launchPersistentContext.bind(chromium);
    vi.spyOn(chromium, "launchPersistentContext").mockImplementationOnce(
      (...args) => {
        writeFileSync(join(project, "index.html"), "<p>New HTML</p>");
        return launch(...args);
      },
    );
    const {
      files: [capture],
    } = await captureHtml(project, { html: ["index.html"] }, outputs);
    expect(capture.inputSha256).toBe(sha256(html));
    const png = readFileSync(join(outputs, "01.png"));
    expect(capture.sha256).toBe(sha256(png));
    expect(await color(png, 5)).toEqual([255, 0, 0, 255]);
    expect(await color(png, 25)).toEqual([0, 255, 0, 255]);
    expect(await color(png, 45)).toEqual([255, 255, 0, 255]);
    expect(await color(png, 65)).toEqual([255, 0, 255, 255]);
  });
}
