import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadProject } from "@thermite/compiler";

/** Poll declared inputs: no recursive OS watchers or unrelated project-directory files. */
export async function watchAlphaProject(
  project: string,
  input: string,
  _output: string,
  rebuild: () => Promise<void>,
): Promise<void> {
  if (input === "-")
    throw new Error("Watch requires a request file, not stdin.");
  const initial = await loadProject(project);
  if (!initial.ok)
    throw new Error("Validate the project before starting watch.");
  async function fingerprint(loaded = initial): Promise<string> {
    // The loader discovers newly matched sources and library references, checks
    // locks, and rejects links. Failed loads are tracked too, allowing recovery.
    let request: string;
    try {
      request = await readFile(input, "utf8");
    } catch (error) {
      request = JSON.stringify({ error: String(error) });
    }
    return createHash("sha256")
      .update(JSON.stringify(loaded))
      .update(request)
      .digest("hex");
  }
  let previous = await fingerprint();
  let timer: NodeJS.Timeout | undefined;
  let active: Promise<void> | undefined;
  let stopped = false;
  async function generate(): Promise<void> {
    try {
      await rebuild();
    } catch (error) {
      process.stderr.write(
        JSON.stringify({
          error: {
            code: "T001",
            message:
              error instanceof Error ? error.message : "Regeneration failed.",
          },
        }) + "\n",
      );
    }
  }
  await new Promise<void>((done, reject) => {
    function stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      void Promise.resolve(active).then(done, reject);
    }
    async function poll(): Promise<void> {
      try {
        const next = await fingerprint(await loadProject(project));
        if (next !== previous) {
          previous = next;
          await generate();
        }
      } catch (error) {
        process.stderr.write(
          JSON.stringify({ error: { code: "T001", message: String(error) } }) +
            "\n",
        );
      } finally {
        if (!stopped)
          timer = setTimeout(() => {
            active = poll();
          }, 1000);
      }
    }
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    process.stderr.write(
      "Checking declared source, libraries and the request every second. Refresh the HTML after a successful rebuild. Failed builds preserve the last successful output; diagnostics remain on stderr. Ctrl+C stops.\n",
    );
    active = generate().then(() => {
      if (!stopped)
        timer = setTimeout(() => {
          active = poll();
        }, 1000);
    });
  });
}
