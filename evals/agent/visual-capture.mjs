import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { projectReader, windowsError } from "./capture-files.mjs";
import { sha256 } from "./snapshot.mjs";

const requestName = "visual-capture.request.json";
const outputDirectory = "visual-captures";
const outputNames = ["01.png", "02.png", "03.png", "04.png"];
const origin = "https://thermite-capture.invalid";
const receiptBytes = (result) =>
  Buffer.from(JSON.stringify(result, null, 2) + "\n");
// Chromium's profile lives in the harness home, outside the agent's writable
// roots (the project, the run directory used as its TMPDIR, and /tmp).
const harnessTemp = (prefix) =>
  mkdtempSync(join(realpathSync(homedir()), prefix));

function htmlPath(source, name) {
  assert(
    typeof name === "string" && name.endsWith(".html"),
    "Expected project HTML",
  );
  return source.path(name);
}

export function captureInput(project, name) {
  const source = projectReader(project);
  try {
    return source.read(htmlPath(source, name));
  } finally {
    source.close();
  }
}

function requestedInputs(source, request) {
  assert(
    Array.isArray(request?.html) &&
      request.html.length >= 1 &&
      request.html.length <= outputNames.length,
    "Request 1–4 HTML outputs",
  );
  return request.html.map((name) => htmlPath(source, name));
}

async function renderHtml(source, request) {
  const inputs = requestedInputs(source, request);
  const snapshots = new Map();
  const snapshot = (path) => {
    if (!snapshots.has(path)) snapshots.set(path, source.read(path));
    return snapshots.get(path);
  };
  for (const input of inputs) snapshot(input);

  const scratch = harnessTemp(".thermite-visual-");
  let context;
  try {
    context = await chromium.launchPersistentContext(join(scratch, "profile"), {
      executablePath:
        process.env.THERMITE_TEST_BROWSER || chromium.executablePath(),
      headless: true,
      artifactsDir: scratch,
      env: {
        PATH: process.env.PATH,
        HOME: scratch,
        TMPDIR: scratch,
      },
      acceptDownloads: false,
      offline: true,
      javaScriptEnabled: false,
      serviceWorkers: "block",
      viewport: { width: 1600, height: 1200 },
      deviceScaleFactor: 1,
    });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === "data:") return route.continue();
      let body;
      if (url.origin === origin) {
        try {
          const name = decodeURIComponent(url.pathname.slice(1));
          body = snapshot(htmlPath(source, name));
        } catch {}
      }
      if (body) return route.fulfill({ body, contentType: "text/html" });
      return route.abort();
    });
    const captures = [];
    for (const [index, input] of inputs.entries()) {
      const page = await context.newPage();
      const url =
        origin + "/" + input.split(sep).map(encodeURIComponent).join("/");
      try {
        await page.goto(url, { waitUntil: "load", timeout: 15000 });
        const png = await page.screenshot({ fullPage: true, timeout: 15000 });
        captures.push({
          png,
          file: {
            input: request.html[index],
            inputSha256: sha256(snapshot(input)),
            output: `${outputDirectory}/${outputNames[index]}`,
            sha256: sha256(png),
            bytes: png.length,
          },
        });
      } finally {
        await page.close();
      }
    }
    return captures;
  } finally {
    try {
      await context?.close();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

function replaceFile(path, bytes) {
  const partial = path + ".partial";
  rmSync(partial, { force: true });
  writeFileSync(partial, bytes, { flag: "wx" });
  renameSync(partial, path);
}

// The output directory holds exactly what the receipt describes. The receipt
// is absent while a capture runs, and every PNG is verified before it lands.
function clearOutputs(outputs) {
  for (const name of ["result.json", ...outputNames])
    rmSync(join(outputs, name), { force: true });
}
function publish(outputs, result, captures = []) {
  clearOutputs(outputs);
  for (const [index, { png }] of captures.entries())
    replaceFile(join(outputs, outputNames[index]), png);
  for (const [index, { file }] of captures.entries())
    assert(
      sha256(readFileSync(join(outputs, outputNames[index]))) === file.sha256,
      "Capture output changed",
    );
  replaceFile(join(outputs, "result.json"), receiptBytes(result));
  return result;
}
async function captureInto(source, outputs, request) {
  rmSync(join(outputs, "result.json"), { force: true });
  const captures = await renderHtml(source, request);
  return publish(
    outputs,
    {
      format: "thermite-agent-visual-capture/1",
      files: captures.map(({ file }) => file),
    },
    captures,
  );
}
const publishError = (outputs, error) =>
  publish(outputs, { error: error.message });

// Direct entry point: `outputs` must be a directory the agent cannot write.
// The request is validated before anything is written.
export async function captureHtml(project, request, outputs) {
  const source = projectReader(project);
  try {
    requestedInputs(source, request);
    return await captureInto(source, realpathSync(outputs), request);
  } finally {
    source.close();
  }
}

const hasIdentity = (entry) =>
  entry != null && (entry.dev !== 0n || entry.ino !== 0n);
const sameIdentity = (a, b) =>
  hasIdentity(a) && hasIdentity(b) && a.dev === b.dev && a.ino === b.ino;
const hasTimestamp = (value) => typeof value === "bigint" && value !== 0n;
const sameTimestamp = (a, b) => !hasTimestamp(a) || !hasTimestamp(b) || a === b;
const entryType = (entry) => Number(entry.mode & 0o170000n);

function snapshotWindowsLink(link) {
  const entry = lstatSync(link, { bigint: true, throwIfNoEntry: false });
  if (!entry?.isSymbolicLink()) return null;
  let targetBytes;
  try {
    targetBytes = readlinkSync(link, { encoding: "buffer" });
  } catch {
    return null;
  }
  if (!Buffer.isBuffer(targetBytes)) return null;
  return {
    dev: entry.dev,
    ino: entry.ino,
    type: entryType(entry),
    ctimeNs: typeof entry.ctimeNs === "bigint" ? entry.ctimeNs : 0n,
    birthtimeNs: typeof entry.birthtimeNs === "bigint" ? entry.birthtimeNs : 0n,
    targetBytes,
  };
}

function sameWindowsTarget(current, expected) {
  if (expected?.targetBytes !== undefined)
    return (
      Buffer.isBuffer(current?.targetBytes) &&
      Buffer.isBuffer(expected.targetBytes) &&
      current.targetBytes.equals(expected.targetBytes)
    );
  if (expected?.target !== undefined) {
    const expectedBytes = Buffer.isBuffer(expected.target)
      ? expected.target
      : typeof expected.target === "string"
        ? Buffer.from(expected.target, "utf8")
        : null;
    return (
      Buffer.isBuffer(current?.targetBytes) &&
      expectedBytes !== null &&
      current.targetBytes.equals(expectedBytes)
    );
  }
  return true;
}

function sameResolvedPath(a, b) {
  let left = resolve(a),
    right = resolve(b);
  try {
    left = realpathSync(left);
  } catch {}
  try {
    right = realpathSync(right);
  } catch {}
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function linkedOutputsTarget(link, outputs, outputsIdentity) {
  const targetStat = statSync(link, { bigint: true, throwIfNoEntry: false });
  const expectedStat =
    outputsIdentity ??
    statSync(outputs, { bigint: true, throwIfNoEntry: false });
  if (targetStat && hasIdentity(targetStat) && hasIdentity(expectedStat))
    return sameIdentity(targetStat, expectedStat);
  if (targetStat)
    return sameResolvedPath(
      resolve(dirname(link), readlinkSync(link)),
      outputs,
    );
  if (statSync(outputs, { bigint: true, throwIfNoEntry: false })) return false;
  return sameResolvedPath(resolve(dirname(link), readlinkSync(link)), outputs);
}

function ownsWindowsLink(
  link,
  outputs,
  outputsIdentity,
  workspaceIdentity,
  linkIdentity,
) {
  if (workspaceIdentity) {
    const parent = lstatSync(dirname(link), {
      bigint: true,
      throwIfNoEntry: false,
    });
    if (!parent?.isDirectory() || !sameIdentity(parent, workspaceIdentity))
      return false;
  }
  const current = snapshotWindowsLink(link);
  if (!current) return false;
  if (!sameWindowsTarget(current, linkIdentity)) return false;
  if (linkIdentity?.type !== undefined && current.type !== linkIdentity.type)
    return false;
  if (
    linkIdentity != null &&
    (!sameTimestamp(current.ctimeNs, linkIdentity.ctimeNs) ||
      !sameTimestamp(current.birthtimeNs, linkIdentity.birthtimeNs))
  )
    return false;
  if (hasIdentity(linkIdentity) || hasIdentity(current))
    return sameIdentity(current, linkIdentity);
  // Residual Windows limit: if a filesystem cannot supply dev/ino for a
  // junction, user space cannot distinguish a replacement junction with the
  // same target bytes and timestamps from the broker's own junction.
  return linkedOutputsTarget(link, outputs, outputsIdentity);
}

function verifyPinnedHierarchy(workspaceReader, projectReaderObj, projectPath) {
  assert(workspaceReader.intact(), "Workspace root was replaced");
  assert(projectReaderObj.intact(), "Project root was replaced");
  const pinnedProjectPath = projectReaderObj.identity.path;
  const pinnedWorkspacePath = workspaceReader.identity.path;
  assert(
    dirname(pinnedProjectPath) === pinnedWorkspacePath,
    "Project root is outside pinned workspace",
  );
  const childName = basename(pinnedProjectPath);
  const pinnedProjectStat = projectReaderObj.inspect();
  assert(
    sameIdentity(workspaceReader.inspect(childName), pinnedProjectStat),
    "Project root was replaced",
  );
  if (projectPath) {
    const currentProject = lstatSync(projectPath, {
      bigint: true,
      throwIfNoEntry: false,
    });
    assert(
      currentProject?.isDirectory() &&
        sameIdentity(currentProject, pinnedProjectStat),
      "Project root was replaced",
    );
  }
  return childName;
}

// The broker publishes straight into evidence/visual-captures, which the
// runner keeps outside the sandbox's writable roots. Its read link is a sibling
// of the project because guarded source patches require an ordinary project tree.
export async function visualBroker(
  task,
  project,
  evidence,
  observe,
  pins = {},
) {
  if (!task.visualCapture) return async () => {};
  let source = pins.project ?? null,
    workspaceSource = pins.workspace ?? null,
    ownsSource = false,
    ownsWorkspace = false,
    outputs,
    outputsIdentity,
    outputsCreated = false,
    link,
    linkIdentity = null,
    workspaceIdentity,
    linkCreated = false,
    timer,
    pending,
    failure;
  const cleanup = ({ rollbackOutputs = false } = {}) => {
    try {
      if (linkCreated) {
        linkCreated = false;
        if (workspaceSource)
          workspaceSource.unlinkLink(outputDirectory, linkIdentity);
        else if (
          ownsWindowsLink(
            link,
            outputs,
            outputsIdentity,
            workspaceIdentity,
            linkIdentity,
          )
        )
          // Residual Windows limit: Node exposes no descriptor-relative
          // unlinkat on Windows, so unlinkSync still takes a pathname after
          // verifying parent identity, isSymbolicLink(), target bytes,
          // timestamps, and link dev/ino.
          unlinkSync(link);
      }
    } finally {
      try {
        if (rollbackOutputs && outputsCreated) {
          outputsCreated = false;
          rmdirSync(outputs);
        }
      } finally {
        try {
          if (ownsSource) source?.close();
        } finally {
          if (ownsWorkspace) workspaceSource?.close();
        }
      }
    }
  };
  let windowsFallbackError = null;
  try {
    try {
      if (!source) {
        source = projectReader(project);
        ownsSource = true;
      }
      if (!workspaceSource) {
        workspaceSource = projectReader(dirname(source.identity.path));
        ownsWorkspace = true;
      }
    } catch (error) {
      if (error.message !== windowsError) throw error;
      if (ownsSource) {
        source?.close();
        source = null;
        ownsSource = false;
      }
      if (ownsWorkspace) {
        workspaceSource?.close();
        workspaceSource = null;
        ownsWorkspace = false;
      }
      windowsFallbackError = error;
    }

    if (windowsFallbackError) {
      const projectStat = lstatSync(project, {
        bigint: true,
        throwIfNoEntry: false,
      });
      assert(projectStat?.isDirectory(), "Capture directory must be ordinary");
      const root = realpathSync(project);
      const workspace = dirname(root);
      workspaceIdentity = lstatSync(workspace, {
        bigint: true,
        throwIfNoEntry: false,
      });
      const projectIdentity = lstatSync(root, {
        bigint: true,
        throwIfNoEntry: false,
      });
      assert(
        workspaceIdentity?.isDirectory() &&
          projectIdentity?.isDirectory() &&
          sameIdentity(projectStat, projectIdentity),
        "Capture directory must be ordinary",
      );
      const verifyWindowsParent = () => {
        const currentParent = lstatSync(workspace, {
          bigint: true,
          throwIfNoEntry: false,
        });
        const currentProject = lstatSync(root, {
          bigint: true,
          throwIfNoEntry: false,
        });
        const currentInput = lstatSync(project, {
          bigint: true,
          throwIfNoEntry: false,
        });
        return (
          currentParent?.isDirectory() &&
          sameIdentity(currentParent, workspaceIdentity) &&
          currentProject?.isDirectory() &&
          sameIdentity(currentProject, projectIdentity) &&
          currentInput?.isDirectory() &&
          sameIdentity(currentInput, projectIdentity)
        );
      };
      link = join(workspace, outputDirectory);
      assert(
        !lstatSync(link, { throwIfNoEntry: false }),
        "visual-captures must not exist before the agent starts",
      );
      outputs = join(realpathSync(evidence), outputDirectory);
      mkdirSync(outputs);
      outputsCreated = true;
      outputsIdentity = statSync(outputs, { bigint: true });
      assert(
        verifyWindowsParent() && !lstatSync(link, { throwIfNoEntry: false }),
        "Visual capture link changed during setup",
      );
      // Residual Windows limit: Node has no descriptor-relative symlinkat on
      // Windows, so symlinkSync still takes a pathname. Re-verifying the pinned
      // parent immediately before and after creation blocks swaps before
      // creation (such as during mkdirSync), but a concurrent parent swap
      // between those two syscalls cannot be prevented in user space. The E2
      // evaluator refuses Windows runs before setup, so only direct standalone
      // visualBroker calls reach this fallback.
      symlinkSync(outputs, link, "junction");
      linkCreated = true;
      linkIdentity = snapshotWindowsLink(link);
      assert(
        verifyWindowsParent() &&
          linkIdentity != null &&
          ownsWindowsLink(
            link,
            outputs,
            outputsIdentity,
            workspaceIdentity,
            linkIdentity,
          ) &&
          linkedOutputsTarget(link, outputs, outputsIdentity),
        "Visual capture link changed during setup",
      );
    } else {
      verifyPinnedHierarchy(workspaceSource, source, project);
      assert(
        !workspaceSource.has(outputDirectory),
        "visual-captures must not exist before the agent starts",
      );
      outputs = join(realpathSync(evidence), outputDirectory);
      mkdirSync(outputs);
      outputsCreated = true;
      outputsIdentity = statSync(outputs, { bigint: true });
      linkIdentity = workspaceSource.symlinkLink(outputDirectory, outputs);
      linkCreated = true;
      verifyPinnedHierarchy(workspaceSource, source, project);
      const linkParent = lstatSync(workspaceSource.identity.path, {
        bigint: true,
        throwIfNoEntry: false,
      });
      assert(
        linkParent?.isDirectory() &&
          sameIdentity(linkParent, workspaceSource.inspect()),
        "Workspace root was replaced",
      );
      assert(
        workspaceSource.linkedDirectory(
          outputDirectory,
          outputsIdentity,
          linkIdentity,
        ),
        "Visual capture link target changed during setup",
      );
    }
  } catch (error) {
    cleanup({ rollbackOutputs: true });
    throw error;
  }
  if (windowsFallbackError)
    try {
      publishError(outputs, windowsFallbackError);
    } catch (error) {
      cleanup();
      throw error;
    }

  let previous, receipt;
  let attempts = 0;
  const tick = async () => {
    let bytes;
    try {
      if (!source.has(requestName)) {
        if (receipt) observe?.(receipt);
        return;
      }
      bytes = source.read(requestName).toString("utf8");
    } catch (error) {
      if (previous !== error.message) publishError(outputs, error);
      previous = error.message;
      receipt = null;
      return;
    }
    if (bytes !== previous) {
      previous = bytes;
      attempts++;
      receipt = null;
      try {
        receipt = await captureInto(source, outputs, JSON.parse(bytes));
      } catch (error) {
        publishError(outputs, error);
      }
    }
    if (receipt) observe?.(receipt);
  };
  if (source)
    timer = setInterval(() => {
      if (!pending && !failure)
        pending = tick()
          .catch((error) => {
            failure = error;
          })
          .finally(() => {
            pending = undefined;
          });
    }, 250);
  return async () => {
    clearInterval(timer);
    try {
      await pending;
      if (failure) throw failure;
    } finally {
      cleanup();
    }
    return { retries: Math.max(0, attempts - 1) };
  };
}
