import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const runner = join(dirname(fileURLToPath(import.meta.url)), "run.mjs");
const fakeSource = `
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
const config = JSON.parse(process.argv[2]);
const candidate = {format:'thermite-component-candidate/0.1', sourcePartId:config.mode === 'wrong-id' ? 'different' : config.id, decision:config.mode.startsWith('blocked') ? 'needs-evidence' : 'candidate', summary:'Synthetic local test', sources:[], unresolved:[], conformance:null, ...config.resultOverrides};
const prompt = readFileSync(0, 'utf8');
if (prompt !== 'Research ' + config.id + '\\n') throw new Error('Prompt stdin mismatch');
const trace = (event) => appendFileSync(config.trace, JSON.stringify({event, id:config.id, backend:config.backend, pid:process.pid}) + '\\n');
trace('start');
console.log(JSON.stringify({type:'progress', message:config.id}));
console.error('diagnostic for ' + config.id);
if (config.mode === 'descendant') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
  writeFileSync('descendant.pid', String(child.pid));
}
await new Promise(resolve => setTimeout(resolve, config.delay ?? 60));
const releaseDeadline = performance.now() + 120_000;
while (config.waitForRelease && !existsSync('release-worker')) {
  if (performance.now() >= releaseDeadline) process.exit(1);
  await new Promise(resolve => setTimeout(resolve, 20));
}
if (config.mode === 'rate') {
  console.log(JSON.stringify({type:'turn.failed', error:{message:'HTTP 429 rate limit exceeded'}}));
  trace('end');
  process.exit(1);
}
if (config.mode === 'once' && !existsSync('first-attempt')) {
  writeFileSync('first-attempt', 'yes');
  writeFileSync('result.json', JSON.stringify({format:'thermite-component-candidate/0.1', sourcePartId:config.id, decision:'candidate'}));
  console.error('first attempt failed');
  trace('end');
  process.exit(1);
}
if (config.mode !== 'missing') {
  writeFileSync('result.json', config.mode === 'duplicate-result' ? JSON.stringify(candidate).replace('{', '{"summary":"duplicate",') : config.mode === 'bare-result' ? JSON.stringify({format:candidate.format, sourcePartId:candidate.sourcePartId, decision:candidate.decision}) : JSON.stringify(candidate));
  if (!config.mode.startsWith('blocked') && config.mode !== 'no-artifacts') {
    writeFileSync('type.json', config.mode === 'duplicate-type' ? '{"id":"first","id":"second"}' : JSON.stringify({format:'synthetic-test-only', id:config.id}));
  }
  if (config.mode !== 'no-artifacts' && config.mode !== 'blocked-no-research') {
    writeFileSync('research.md', config.mode === 'blocked-empty-research' ? '  \\n' : 'Synthetic evidence for ' + config.id + '\\n');
  }
}
for (const event of config.events ?? []) console.log(JSON.stringify(event));
trace('end');
`;

export function fixture(t, definitions) {
  const batch = mkdtempSync(join(tmpdir(), "thermite-batch-test-"));
  const fake = join(batch, "fake.mjs");
  const trace = join(batch, "trace.jsonl");
  writeFileSync(fake, fakeSource);
  const jobs = definitions.map((definition, index) => {
    const config = {
      id: `part-${index}`,
      backend: "claude",
      mode: "candidate",
      ...definition,
      trace,
    };
    const directory = join(batch, config.id);
    mkdirSync(directory);
    const promptFile = join(directory, "prompt.txt");
    writeFileSync(promptFile, `Research ${config.id}\n`);
    return {
      id: config.id,
      backend: config.backend,
      directory,
      promptFile,
      command: [process.execPath, fake, JSON.stringify(config)],
    };
  });
  writeFileSync(
    join(batch, "queue.json"),
    JSON.stringify({ format: "thermite-component-queue/0.1", jobs }),
  );
  let stop;
  t.after(async () => {
    try {
      await stop?.();
    } finally {
      rmSync(batch, { recursive: true, force: true });
    }
  });
  return {
    batch,
    jobs,
    trace,
    status: () => JSON.parse(readFileSync(join(batch, "status.json"), "utf8")),
    stopBeforeCleanup: (callback) => {
      stop = callback;
    },
  };
}

export function launch(batch, args = []) {
  const child = spawn(process.execPath, [runner, "--batch", batch, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const running = { child, outcome: undefined };
  running.done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      running.outcome = { code, signal, stdout, stderr };
      resolve(running.outcome);
    });
  });
  return running;
}

// Child startup, status publication and process reaping can all be delayed on
// loaded CI hosts. Keep polling the actual condition with a monotonic bound.
export async function until(predicate, description = "the local test process") {
  const timeout = 30_000;
  const deadline = performance.now() + timeout;
  for (;;) {
    if (predicate()) return;
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    await delay(Math.min(20, remaining));
  }
  assert.fail(`Timed out after ${timeout} ms waiting for ${description}`);
}
