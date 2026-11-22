import { afterEach, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
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
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { chromium } from "playwright-core";
import { projectReader } from "./capture-files.mjs";
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
    afterMkdir(path) {
      if (!matches("mkdir", path)) return;
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
    mkdirSync(path, ...rest) {
      const result = fs.mkdirSync(path, ...rest);
      race.afterMkdir(String(path));
      return result;
    },
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

function fixture(html = "<p>Capture fixture</p>", base = tmpdir()) {
  const root = realpathSync(mkdtempSync(join(base, "thermite-visual-test-")));
  work.push(root);
  const workspace = join(root, "work");
  const paths = {
    workspace,
    project: join(workspace, "project"),
    evidence: join(root, "evidence"),
    outside: join(root, "outside"),
    // Where a direct caller puts outputs; the broker links its own.
    outputs: join(root, "harness-out"),
  };
  for (const dir of ["workspace", "evidence", "outside", "outputs"])
    mkdirSync(paths[dir]);
  if (html !== null) {
    mkdirSync(paths.project);
    writeFileSync(join(paths.project, "index.html"), html);
  }
  paths.sentinel = join(paths.outside, "sentinel");
  writeFileSync(paths.sentinel, "untouched");
  // A harness-readable page the agent must not be able to capture.
  writeFileSync(join(paths.outside, "index.html"), blue);
  writeFileSync(join(paths.outside, "page.html"), blue);
  paths.link = join(workspace, "visual-captures");
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
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      request(project, { html: ["index.html"] });
      expect(await readReceipt(join(link, "result.json"))).toEqual({
        error: windowsError,
      });
    } finally {
      await stop();
    }
    expect(lstatSync(link, { throwIfNoEntry: false })).toBeUndefined();
  });
  expect(lstatSync(link, { throwIfNoEntry: false })).toBeUndefined();
  expect(screenshot).not.toHaveBeenCalled();
  expect(readdirSync(outputs)).toEqual([]);
  expect(
    JSON.parse(
      readFileSync(join(evidence, "visual-captures/result.json"), "utf8"),
    ),
  ).toEqual({ error: windowsError });
});

const darwinTmpAlias =
  process.platform === "darwin" &&
  !!lstatSync("/tmp", { throwIfNoEntry: false })?.isSymbolicLink() &&
  realpathSync("/tmp") === "/private/tmp";

function caseToggledOutputs(canonicalPath) {
  const parent = dirname(canonicalPath);
  const dirName = basename(parent);
  const toggled =
    dirName === dirName.toUpperCase()
      ? dirName.toLowerCase()
      : dirName.toUpperCase();
  return join(dirname(parent), toggled, basename(canonicalPath));
}

function sameEntry(a, b) {
  return a != null && b != null && a.dev === b.dev && a.ino === b.ino;
}

it("only unlinks the exact link identity it created during Windows fallback and POSIX cleanup", async () => {
  const base = darwinTmpAlias ? "/private/tmp" : tmpdir();
  const {
    workspace,
    project,
    evidence,
    outside,
    link: linkPath,
  } = fixture(red, base);
  const outputs = join(evidence, "visual-captures");

  // 1. Simulated Windows: replacing the broker's link with a new link pointing
  //    to the exact same outputs directory must leave the replacement alone.
  //    (Fails on pre-E2LINK 5dab585c, which matches only target path.)
  await asWindows(async () => {
    const stop = await visualBroker({ visualCapture: true }, project, evidence);
    let replacementStat;
    try {
      const originalStat = lstatSync(linkPath, { bigint: true });
      unlinkSync(linkPath);
      link(outputs, linkPath);
      replacementStat = lstatSync(linkPath, { bigint: true });
      expect(sameEntry(replacementStat, originalStat)).toBe(false);
    } finally {
      await stop();
    }
    const after = lstatSync(linkPath, {
      bigint: true,
      throwIfNoEntry: false,
    });
    expect(after?.isSymbolicLink()).toBe(true);
    expect(sameEntry(after, replacementStat)).toBe(true);
    unlinkSync(linkPath);
  });

  // 2. Simulated Windows: case-toggled alternate spelling replacement must also
  //    be left untouched. Skip cleanly on case-sensitive volumes where the
  //    toggled spelling does not resolve to the same directory.
  const evidenceCase = join(dirname(evidence), "evidence-case");
  mkdirSync(evidenceCase);
  const caseOutputs = join(evidenceCase, "visual-captures");
  await asWindows(async () => {
    const stop = await visualBroker(
      { visualCapture: true },
      project,
      evidenceCase,
    );
    const altOutputs = caseToggledOutputs(caseOutputs);
    const outputsStat = statSync(caseOutputs, { bigint: true });
    const altStat = statSync(altOutputs, {
      bigint: true,
      throwIfNoEntry: false,
    });
    const caseInsensitiveVolume =
      altOutputs !== caseOutputs && sameEntry(altStat, outputsStat);
    let replacementStat = null;
    try {
      if (caseInsensitiveVolume) {
        unlinkSync(linkPath);
        link(altOutputs, linkPath);
        expect(resolve(readlinkSync(linkPath))).not.toBe(resolve(caseOutputs));
        replacementStat = lstatSync(linkPath, { bigint: true });
      }
    } finally {
      await stop();
    }
    if (caseInsensitiveVolume) {
      const after = lstatSync(linkPath, {
        bigint: true,
        throwIfNoEntry: false,
      });
      expect(after?.isSymbolicLink()).toBe(true);
      expect(sameEntry(after, replacementStat)).toBe(true);
      unlinkSync(linkPath);
    } else {
      expect(lstatSync(linkPath, { throwIfNoEntry: false })).toBeUndefined();
    }
  });

  // 3. Simulated Windows: replacing the link with a link to another directory
  //    or with a regular file must leave the replacement untouched.
  for (const kind of ["other-link", "regular-file"]) {
    const evidenceReplacement = join(dirname(evidence), `evidence-${kind}`);
    mkdirSync(evidenceReplacement);
    await asWindows(async () => {
      const stop = await visualBroker(
        { visualCapture: true },
        project,
        evidenceReplacement,
      );
      try {
        unlinkSync(linkPath);
        if (kind === "other-link") link(outside, linkPath);
        else writeFileSync(linkPath, "keep-regular-file");
      } finally {
        await stop();
      }
      const after = lstatSync(linkPath, { throwIfNoEntry: false });
      if (kind === "other-link") {
        expect(after?.isSymbolicLink()).toBe(true);
      } else {
        expect(after?.isFile()).toBe(true);
        expect(readFileSync(linkPath, "utf8")).toBe("keep-regular-file");
      }
      unlinkSync(linkPath);
    });
  }

  // 4. Simulated Windows: swapping the workspace parent before cleanup must
  //    leave the replacement workspace's entry untouched. (Fails on 5dab585c,
  //    which follows the replaced workspace path and unlinks outside.)
  const evidenceSwap = join(dirname(evidence), "evidence-swap");
  mkdirSync(evidenceSwap);
  await asWindows(async () => {
    const stop = await visualBroker(
      { visualCapture: true },
      project,
      evidenceSwap,
    );
    const original = workspace + "-original";
    const replacementLink = join(outside, "visual-captures");
    try {
      renameSync(workspace, original);
      link(outside, workspace);
      link(join(evidenceSwap, "visual-captures"), replacementLink);
    } finally {
      await stop();
      unlinkSync(workspace);
      renameSync(original, workspace);
    }
    expect(lstatSync(replacementLink).isSymbolicLink()).toBe(true);
    unlinkSync(replacementLink);
    // The original link remained inside the moved-aside workspace because
    // Windows has no open directory descriptor to unlink relative to.
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    unlinkSync(linkPath);
  });

  // 5. Simulated Windows: a mid-setup parent swap after evidence creation must
  //    be caught before junction creation so nothing is linked in `outside`.
  const evidenceMidSwap = join(dirname(evidence), "evidence-mid-swap");
  mkdirSync(evidenceMidSwap);
  const midSwapOutputs = join(evidenceMidSwap, "visual-captures");
  await asWindows(async () => {
    const original = workspace + "-original";
    race.arm("mkdir", midSwapOutputs, () => {
      mkdirSync(join(outside, "project"));
      renameSync(workspace, original);
      link(outside, workspace);
    });
    try {
      await expect(
        visualBroker({ visualCapture: true }, project, evidenceMidSwap),
      ).rejects.toThrow(/changed during setup/i);
      expect(race.state.fired).toBe(1);
      expect(
        lstatSync(join(outside, "visual-captures"), { throwIfNoEntry: false }),
      ).toBeUndefined();
      expect(
        lstatSync(join(original, "visual-captures"), { throwIfNoEntry: false }),
      ).toBeUndefined();
      expect(
        lstatSync(midSwapOutputs, { throwIfNoEntry: false }),
      ).toBeUndefined();
    } finally {
      unlinkSync(workspace);
      renameSync(original, workspace);
      rmSync(join(outside, "project"), { recursive: true, force: true });
    }
  });

  // 6. POSIX descriptor-relative cleanup also verifies the link's own dev/ino
  //    and isSymbolicLink(), leaving replaced symlinks (same path or /tmp alias)
  //    and regular files untouched.
  if (process.platform !== "win32") {
    const posixCases = [
      ["same-target", (out) => out],
      ...(darwinTmpAlias
        ? [["tmp-alias", (out) => out.replace(/^\/private\/tmp(?=\/)/, "/tmp")]]
        : []),
      ["regular-file", null],
    ];
    for (const [label, targetFor] of posixCases) {
      const evidencePosix = join(dirname(evidence), `evidence-posix-${label}`);
      mkdirSync(evidencePosix);
      const posixOutputs = join(evidencePosix, "visual-captures");
      const stop = await visualBroker(
        { visualCapture: true },
        project,
        evidencePosix,
      );
      let replacementStat;
      try {
        unlinkSync(linkPath);
        if (targetFor) {
          const target = targetFor(posixOutputs);
          if (label === "tmp-alias") expect(target).not.toBe(posixOutputs);
          link(target, linkPath);
        } else {
          writeFileSync(linkPath, "keep-posix-file");
        }
        replacementStat = lstatSync(linkPath, { bigint: true });
      } finally {
        await stop();
      }
      const after = lstatSync(linkPath, {
        bigint: true,
        throwIfNoEntry: false,
      });
      if (targetFor) {
        expect(after?.isSymbolicLink()).toBe(true);
        expect(sameEntry(after, replacementStat)).toBe(true);
      } else {
        expect(after?.isFile()).toBe(true);
        expect(readFileSync(linkPath, "utf8")).toBe("keep-posix-file");
      }
      unlinkSync(linkPath);
    }
  }
});

// The remaining cases exercise capture itself, which Windows refuses.
if (process.platform !== "win32") {
  it("keeps the broker link outside the guarded patch tree", async () => {
    const { workspace, project, evidence, outputs } = fixture(null);
    const launcher = fileURLToPath(
      new URL("../../thermite.mjs", import.meta.url),
    );
    const cli = (args, input, cwd = project) => {
      const result = spawnSync(process.execPath, [launcher, ...args], {
        cwd,
        encoding: "utf8",
        input: input === undefined ? undefined : JSON.stringify(input),
      });
      if (result.error) throw result.error;
      return result;
    };
    const success = (args, input, cwd) => {
      const result = cli(args, input, cwd);
      expect(result.status, result.stderr).toBe(0);
      return result.stdout;
    };
    success(["init", "project"], undefined, workspace);
    const sourceFile = "devices/equipment.json";
    const sourcePath = join(project, sourceFile);
    const original = readFileSync(sourcePath);
    const uid = JSON.parse(original).objects[0].uid;
    const description = "Synthetic broker regression";
    const agent = { format: "agent-tool-request/0.1", project: "." };
    const request = {
      ...agent,
      patchFormat: "json-patch/0.1",
      dryRun: true,
      files: [
        {
          path: sourceFile,
          expectedIntegrity:
            "sha256-" + createHash("sha256").update(original).digest("base64"),
          operations: [
            { op: "test", path: "/objects/0/uid", value: uid },
            {
              op: "replace",
              path: "/objects/0/description",
              value: description,
            },
          ],
        },
      ],
    };
    const patch = ["agent", "apply-source-patch", "--input", "-"];
    const before = "before.json";
    const review = ["review", "--before", before, "--json"];
    const delivery = "delivery.request.json";
    writeFileSync(
      join(project, delivery),
      JSON.stringify({
        format: "export-delivery-request/1",
        jobs: [{ kind: "review", before, outputs: { json: "review.json" } }],
      }),
    );

    const projectLink = join(project, "visual-captures");
    link(outputs, projectLink);
    const rejected = cli(patch, request);
    expect(rejected.status, rejected.stderr).toBe(1);
    expect(rejected.stdout).toBe("");
    expect(JSON.parse(rejected.stderr).error).toEqual({
      code: "A003",
      file: "visual-captures",
      message:
        'A003 Unsafe source patch target "visual-captures": reparse point.',
      reason: "reparse-point",
    });
    expect(readFileSync(sourcePath)).toEqual(original);
    expect(
      JSON.parse(success(["agent", "validate", "--input", "-"], agent)).value
        .valid,
    ).toBe(true);
    success(["snapshot", "--output", before]);
    expect(JSON.parse(success(review)).changes).toEqual([]);
    success(["export", "bundle", "--input", delivery, "--out-dir", "drawings"]);
    unlinkSync(projectLink);

    const stop = await visualBroker({ visualCapture: true }, project, evidence);
    try {
      expect(JSON.parse(success(patch, request)).value).toMatchObject({
        dryRun: true,
        applied: false,
      });
      expect(readFileSync(sourcePath)).toEqual(original);
      expect(
        JSON.parse(success(patch, { ...request, dryRun: false })).value,
      ).toMatchObject({ dryRun: false, applied: true });
      expect(JSON.parse(readFileSync(sourcePath)).objects[0].description).toBe(
        description,
      );
      expect(JSON.parse(success(review)).changes).toHaveLength(1);
    } finally {
      await stop();
    }
  });

  // B2: the broker writes only to its own evidence directory.
  it("keeps writing to its own directory after the workspace link moves outside", async () => {
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

  it("publishes into evidence through a sibling link removed after the run", async () => {
    const { project, evidence, link } = fixture();
    const screenshot = stubScreenshot();
    const outputs = join(evidence, "visual-captures");
    const stop = await visualBroker({ visualCapture: true }, project, evidence);
    try {
      expect(existsSync(join(project, "visual-captures"))).toBe(false);
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

  it("leaves the replacement workspace alone during broker cleanup", async () => {
    const { workspace, project, evidence, outside } = fixture();
    const stop = await visualBroker({ visualCapture: true }, project, evidence);
    const original = workspace + "-original";
    const replacementLink = join(outside, "visual-captures");
    try {
      renameSync(workspace, original);
      link(outside, workspace);
      link(join(evidence, "visual-captures"), replacementLink);
    } finally {
      await stop();
    }
    expect(lstatSync(replacementLink).isSymbolicLink()).toBe(true);
    expect(existsSync(join(original, "visual-captures"))).toBe(false);
  });

  it.each(["workspace", "project"])(
    "refuses broker setup when %s is swapped after runner pinning and leaves no outside link",
    async (swapped) => {
      const { workspace, project, evidence, outside } = fixture();
      const workSource = projectReader(workspace);
      const projectSource = projectReader(project);
      const original = workspace + "-original";
      const projectOriginal = join(workspace, "project-original");
      try {
        if (swapped === "workspace") {
          mkdirSync(join(outside, "project"));
          renameSync(workspace, original);
          link(outside, workspace);
        } else {
          renameSync(project, projectOriginal);
          link(outside, project);
        }
        await expect(
          visualBroker({ visualCapture: true }, project, evidence, undefined, {
            workspace: workSource,
            project: projectSource,
          }),
        ).rejects.toThrow(/was replaced/i);
        expect(
          lstatSync(join(outside, "visual-captures"), {
            throwIfNoEntry: false,
          }),
        ).toBeUndefined();
        expect(
          lstatSync(
            join(
              swapped === "workspace" ? original : workspace,
              "visual-captures",
            ),
            { throwIfNoEntry: false },
          ),
        ).toBeUndefined();
        expect(
          lstatSync(join(evidence, "visual-captures"), {
            throwIfNoEntry: false,
          }),
        ).toBeUndefined();
      } finally {
        projectSource.close();
        workSource.close();
      }
    },
  );

  it("refuses a mid-setup workspace swap after evidence creation and cleans up without linking outside", async () => {
    const { workspace, project, evidence, outside } = fixture();
    const workSource = projectReader(workspace);
    const projectSource = projectReader(project);
    const original = workspace + "-original";
    const outputs = join(evidence, "visual-captures");
    try {
      race.arm("mkdir", outputs, () => {
        mkdirSync(join(outside, "project"));
        renameSync(workspace, original);
        link(outside, workspace);
      });
      await expect(
        visualBroker({ visualCapture: true }, project, evidence, undefined, {
          workspace: workSource,
          project: projectSource,
        }),
      ).rejects.toThrow();
      expect(race.state.fired).toBe(1);
      expect(
        lstatSync(join(outside, "visual-captures"), { throwIfNoEntry: false }),
      ).toBeUndefined();
      expect(
        lstatSync(join(original, "visual-captures"), { throwIfNoEntry: false }),
      ).toBeUndefined();
      expect(lstatSync(outputs, { throwIfNoEntry: false })).toBeUndefined();
    } finally {
      projectSource.close();
      workSource.close();
    }
  });

  it("reuses runner-pinned workspace and project readers without closing them", async () => {
    const { workspace, project, evidence, link: linkPath } = fixture();
    stubScreenshot();
    const workSource = projectReader(workspace);
    const projectSource = projectReader(project);
    const symlinkSpy = vi.spyOn(workSource, "symlinkLink");
    const unlinkSpy = vi.spyOn(workSource, "unlinkLink");
    const workCloseSpy = vi.spyOn(workSource, "close");
    const projectReadSpy = vi.spyOn(projectSource, "read");
    const projectCloseSpy = vi.spyOn(projectSource, "close");
    try {
      const stop = await visualBroker(
        { visualCapture: true },
        project,
        evidence,
        undefined,
        { workspace: workSource, project: projectSource },
      );
      try {
        expect(symlinkSpy).toHaveBeenCalledTimes(1);
        expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
        request(project, { html: ["index.html"] });
        const receipt = await readReceipt(join(linkPath, "result.json"));
        expect(receipt.files[0].sha256).toBe(sha256("synthetic PNG bytes"));
        expect(projectReadSpy).toHaveBeenCalledWith("index.html");
      } finally {
        await stop();
      }
      expect(unlinkSpy).toHaveBeenCalledTimes(1);
      expect(lstatSync(linkPath, { throwIfNoEntry: false })).toBeUndefined();
      // Caller-owned pins remain open for post-agent staging and cleanup.
      expect(workCloseSpy).not.toHaveBeenCalled();
      expect(projectCloseSpy).not.toHaveBeenCalled();
      expect(workSource.intact()).toBe(true);
      expect(projectSource.intact()).toBe(true);
      expect(projectSource.has("index.html")).toBe(true);
    } finally {
      projectSource.close();
      workSource.close();
    }
  });

  it("rolls back the empty evidence output directory when link creation fails so a retry succeeds", async () => {
    const { workspace, project, evidence, link: linkPath } = fixture();
    const outputs = join(evidence, "visual-captures");

    // 1. Read-only workspace: link creation fails after outputs dir is created.
    if (process.getuid?.() !== 0) {
      chmodSync(workspace, 0o555);
      try {
        await expect(
          visualBroker({ visualCapture: true }, project, evidence),
        ).rejects.toThrow();
        expect(lstatSync(outputs, { throwIfNoEntry: false })).toBeUndefined();
        expect(lstatSync(linkPath, { throwIfNoEntry: false })).toBeUndefined();
      } finally {
        chmodSync(workspace, 0o755);
      }
    }

    // 2. Competing entry planted after the pre-check and before link creation:
    //    must roll back outputs AND leave the competing link untouched.
    race.arm("mkdir", outputs, () => {
      link(outputs, linkPath);
    });
    await expect(
      visualBroker({ visualCapture: true }, project, evidence),
    ).rejects.toThrow(/EEXIST/);
    expect(race.state.fired).toBe(1);
    expect(lstatSync(outputs, { throwIfNoEntry: false })).toBeUndefined();
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    unlinkSync(linkPath);

    // 3. Retry with the same evidence root succeeds without EEXIST.
    const stop = await visualBroker({ visualCapture: true }, project, evidence);
    try {
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
      expect(lstatSync(outputs).isDirectory()).toBe(true);
    } finally {
      await stop();
    }
    expect(lstatSync(linkPath, { throwIfNoEntry: false })).toBeUndefined();
  });

  it("preserves a replacement symlink during POSIX setup rollback", async () => {
    const { workspace, project, evidence, outside, link: linkPath } = fixture();
    const outputs = join(evidence, "visual-captures");
    const workSource = projectReader(workspace);
    const projectSource = projectReader(project);
    try {
      const realSymlinkLink = workSource.symlinkLink.bind(workSource);
      let replacementStat;
      vi.spyOn(workSource, "symlinkLink").mockImplementation((name, target) => {
        const snapshot = realSymlinkLink(name, target);
        const created = lstatSync(linkPath, { bigint: true });
        expect(sameEntry(snapshot, created)).toBe(true);
        unlinkSync(linkPath);
        link(outside, linkPath);
        replacementStat = lstatSync(linkPath, { bigint: true });
        expect(sameEntry(replacementStat, snapshot)).toBe(false);
        return snapshot;
      });
      await expect(
        visualBroker({ visualCapture: true }, project, evidence, undefined, {
          workspace: workSource,
          project: projectSource,
        }),
      ).rejects.toThrow(/target changed during setup/i);
      expect(lstatSync(outputs, { throwIfNoEntry: false })).toBeUndefined();
      const after = lstatSync(linkPath, {
        bigint: true,
        throwIfNoEntry: false,
      });
      expect(after?.isSymbolicLink()).toBe(true);
      expect(sameEntry(after, replacementStat)).toBe(true);
    } finally {
      projectSource.close();
      workSource.close();
    }
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
