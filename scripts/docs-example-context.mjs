import assert from "node:assert/strict";
import { ProcessOwner } from "./docs-example-process.mjs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const json = async (file) => JSON.parse(await readFile(file, "utf8"));
export async function put(file, content) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    typeof content === "string" ? content : JSON.stringify(content),
  );
}
export async function processRun(args, cwd, env = process.env, options = {}) {
  const owner = new ProcessOwner(options);
  try {
    return await owner.run(args, cwd, env, options);
  } finally {
    await owner.close();
  }
}
export async function context(root, options = {}) {
  const processes = new ProcessOwner(options);
  let cleanup;
  const temporary = await mkdtemp(
    join(await realpath(tmpdir()), "thermite-doc-examples-"),
  );
  const work = join(temporary, "checkout");
  await mkdir(work);
  const entry = join(root, "thermite.mjs");
  const run = (args, cwd = work, env = process.env, settings = {}) =>
    processes.run(
      args,
      cwd,
      { ...env, TMPDIR: temporary, TMP: temporary, TEMP: temporary },
      settings,
    );
  const cli = async (args, cwd = work) => {
    const result = await run([entry, ...args], cwd);
    assert.equal(
      result.code,
      0,
      `${args.join(" ")}\n${result.stderr}\n${result.stdout.slice(0, 1000)}`,
    );
    return result;
  };
  const copy = async (source, destination) => {
    await cp(join(root, source), destination, { recursive: true });
    return destination;
  };
  return {
    root,
    temporary,
    work,
    entry,
    cli,
    copy,
    run,
    cleanup: () =>
      (cleanup ??= processes
        .close()
        .then(() => rm(temporary, { recursive: true, force: true }))),
  };
}
export async function shell(c, body, cwd = c.work) {
  // Only launchers and explicitly documented project/runtime placeholders change.
  // Bun's shell provides the same quoting/redirection semantics on supported OSes.
  const code = body
    .replace(
      /bun (?:thermite\.mjs|\/path\/to\/thermite\/thermite\.mjs)/g,
      'bun "$thermite_entry"',
    )
    .replace(/^thermite /gm, 'bun "$thermite_entry" ')
    .replace(/--project <project>/g, "--project .");
  let stdout = "",
    stderr = "";
  for (const command of code.split(/(?<!\\)\n/).filter((line) => line.trim())) {
    const result = await shellCommand(c, command, cwd);
    stdout += result.stdout;
    stderr += result.stderr;
  }
  return { code: 0, stdout, stderr };
}
async function shellCommand(c, code, cwd) {
  const script = join(c.temporary, "fence.txt");
  await put(script, code);
  const result = await c.run(
    [
      "--eval",
      'import { $ } from "bun"; await $`${{raw: await Bun.file(process.argv[1]).text()}}`;',
      script,
    ],
    cwd,
    { ...process.env, thermite_entry: c.entry },
  );
  assert.equal(
    result.code,
    0,
    `${code}\n${result.stderr}\n${result.stdout.slice(0, 1000)}`,
  );
  return result;
}
