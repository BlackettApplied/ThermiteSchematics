// Non-model preflight: sandbox writes the request and reads the broker's PNGs,
// but neither it nor a process it leaves behind can write evidence.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { freshEnvironment } from "./launch.mjs";
import { visualBroker } from "./visual-capture.mjs";
export async function probe(output) {
  // The same layout as run.mjs: the run directory under /tmp is the agent's
  // TMPDIR, and live evidence is in the harness home.
  const work = realpathSync(mkdtempSync("/tmp/thermite-agent-eval-")),
    project = join(work, "project"),
    evidence = realpathSync(
      mkdtempSync(join(homedir(), ".thermite-agent-evidence-")),
    );
  mkdirSync(project);
  const env = freshEnvironment(join(work, "isolated"));
  delete env.CODEX_API_KEY;
  delete env.OPENAI_API_KEY;
  const child = (code) =>
    spawnSync(
      "codex",
      ["sandbox", "-P", ":workspace", "--", process.execPath, "-e", code],
      { cwd: project, env, encoding: "utf8", timeout: 15000 },
    );
  let stop;
  try {
    for (const name of ["packet", "power"])
      writeFileSync(
        join(project, name + ".html"),
        `<html><body><svg width="800" height="600"><text x="40" y="100" font-size="24">Synthetic ${name}: inspect labels and conductors</text><path d="M40 150 H650" stroke="black"/></svg></body></html>`,
      );
    stop = await visualBroker({ visualCapture: true }, project, evidence);
    const request = child(
      `require('fs').writeFileSync('visual-capture.request.json',JSON.stringify({html:['packet.html','power.html']}))`,
    );
    assert.equal(request.status, 0, request.stderr);
    const receipt = join(project, "visual-captures/result.json"),
      end = Date.now() + 30000;
    let result;
    while (!result && Date.now() < end) {
      try {
        result = JSON.parse(readFileSync(receipt));
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    assert(result, "Capture timed out");
    assert(!result.error, result.error);
    assert.equal(result.files.length, 2);
    const viewed = child(
      `const fs=require('fs');console.log(JSON.stringify(['01','02'].map(n=>fs.readFileSync('visual-captures/'+n+'.png').length)))`,
    );
    assert.equal(viewed.status, 0, viewed.stderr);
    // The broker's output directory is outside the sandbox's writable roots.
    const written = child(
      `require('fs').writeFileSync('visual-captures/01.png','agent bytes')`,
    );
    assert.match(written.stderr, /EPERM|EACCES/, "Sandbox wrote broker output");
    // The run directory is writable, which is why evidence lives elsewhere.
    const runDir = child(`require('fs').writeFileSync('../run-dir-probe','x')`);
    assert.equal(runDir.status, 0, runDir.stderr);
    const evidenceWrite = child(
      `require('fs').writeFileSync(${JSON.stringify(join(evidence, "probe"))},'x')`,
    );
    assert.match(
      evidenceWrite.stderr,
      /EPERM|EACCES/,
      "Sandbox wrote evidence",
    );
    // A detached descendant outlives the sandboxed command and stays confined.
    // It records its own write outcome in the writable run directory.
    const late = join(evidence, "late-probe"),
      outcome = join(work, "survivor-outcome.json");
    const survivor = child(
      `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(
        `setTimeout(()=>{const fs=require('fs');let code='written';try{fs.writeFileSync(${JSON.stringify(late)},'x')}catch(e){code=e.code}fs.writeFileSync('../survivor-outcome.json',JSON.stringify({code}))},1000)`,
      )}],{detached:true,stdio:'ignore'}).unref()`,
    );
    assert.equal(survivor.status, 0, survivor.stderr);
    let survivorOutcome;
    for (const end = Date.now() + 15000; !survivorOutcome;) {
      assert(Date.now() < end, "Descendant did not report its write");
      await new Promise((r) => setTimeout(r, 100));
      if (existsSync(outcome))
        survivorOutcome = JSON.parse(readFileSync(outcome, "utf8"));
    }
    assert.match(
      survivorOutcome.code,
      /^(EPERM|EACCES)$/,
      "A surviving descendant wrote evidence",
    );
    assert(!existsSync(late), "A surviving descendant wrote evidence");
    mkdirSync(join(resolve(output), "visual-captures"), { recursive: true });
    for (const path of [
      "visual-captures/result.json",
      ...result.files.map(({ output }) => output),
    ])
      cpSync(join(evidence, path), join(resolve(output), path));
    writeFileSync(
      join(resolve(output), "probe.json"),
      JSON.stringify(
        {
          format: "thermite-visual-sandbox-probe/1",
          requestExit: request.status,
          pngReadExit: viewed.status,
          outputWriteExit: written.status,
          runDirWriteExit: runDir.status,
          evidenceWriteExit: evidenceWrite.status,
          survivorWriteError: survivorOutcome.code,
          readBytes: JSON.parse(viewed.stdout),
          capture: result,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "Sandbox request and both PNG reads passed; neither the sandbox nor a surviving descendant wrote evidence.",
    );
  } finally {
    if (stop) await stop();
    rmSync(work, { recursive: true, force: true });
    rmSync(evidence, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await probe(process.argv[2] ?? "evals/out/visual-probe");
