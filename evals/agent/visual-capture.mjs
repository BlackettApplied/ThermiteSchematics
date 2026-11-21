import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { projectReader, windowsError } from "./capture-files.mjs";
import { sha256 } from "./snapshot.mjs";

const requestName = "visual-capture.request.json";
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
            output: "visual-captures/" + outputNames[index],
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

function linkedOutputs(link, outputs) {
  const current = lstatSync(link, { throwIfNoEntry: false });
  return (
    !!current?.isSymbolicLink() &&
    resolve(readlinkSync(link)) === resolve(outputs)
  );
}

// The broker publishes straight into evidence/visual-captures, which the
// runner keeps outside the sandbox's writable roots, and links it into the
// project before the agent starts.
export async function visualBroker(task, project, evidence, observe) {
  if (!task.visualCapture) return async () => {};
  const root = realpathSync(project);
  const link = join(root, "visual-captures");
  assert(
    !lstatSync(link, { throwIfNoEntry: false }),
    "visual-captures must not exist before the agent starts",
  );
  const outputs = join(realpathSync(evidence), "visual-captures");
  mkdirSync(outputs);
  let source, timer, pending, failure;
  const cleanup = () => {
    try {
      if (source) source.unlinkLink("visual-captures", outputs);
      else if (linkedOutputs(link, outputs)) unlinkSync(link);
    } finally {
      source?.close();
    }
  };
  try {
    symlinkSync(
      outputs,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    source = projectReader(root);
  } catch (error) {
    if (error.message !== windowsError) {
      cleanup();
      throw error;
    }
    publishError(outputs, error);
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
