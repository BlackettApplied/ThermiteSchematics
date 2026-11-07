// Completeness cases shared by completeness.test.ts and the generated project
// guide's test (project-guide.test.ts), which executes the rows its sentences
// claim.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject, lockProject } from "@thermite/compiler";

const temporary: string[] = [];
/** Removes every fixture made since the last call. */
export async function removeFixtures() {
  for (const path of temporary.splice(0))
    await rm(path, { recursive: true, force: true });
}
export async function fixture() {
  const p = await mkdtemp(join(tmpdir(), "thermite-completeness-"));
  temporary.push(p);
  await cp("packages/cli/fixtures/completeness", p, { recursive: true });
  const source = JSON.parse(await readFile(join(p, "source.json"), "utf8"));
  const library = JSON.parse(
    await readFile(join(p, "library/types.json"), "utf8"),
  );
  async function compile() {
    await writeFile(
      join(p, "source.json"),
      JSON.stringify(source, null, 2) + "\n",
    );
    await writeFile(
      join(p, "library/types.json"),
      JSON.stringify(library, null, 2) + "\n",
    );
    const locked = await lockProject(p);
    if (!locked.ok) return locked;
    return compileProject(p);
  }
  async function valid() {
    const c = await compile();
    if (!c.ok) throw new Error(JSON.stringify(c));
    return c;
  }
  return { p, source, library, compile, valid };
}

/** Library and review metadata the compiler refuses. */
export const METADATA_REJECTIONS = [
  "unknown-terminal",
  "unknown-port",
  "required-string",
  "missing-reason",
  "blank-reason",
  "unknown-status",
  "coverage-notes",
  "coverage-status",
] as const;
export type MetadataRejection = (typeof METADATA_REJECTIONS)[number];
/** Applies one fault to a fresh fixture and compiles it. */
export async function compileMetadataRejection(problem: MetadataRejection) {
  const f = await fixture(),
    d = f.source.objects[1],
    t = f.library.types[0];
  if (problem === "unknown-terminal")
    d.connectionReview.terminals.TYPO = { status: "required", reason: "Typo." };
  if (problem === "unknown-port")
    d.connectionReview.ports = {
      TYPO: { status: "required", reason: "Typo." },
    };
  if (problem === "required-string") t.terminals.P.required = "yes";
  if (problem === "missing-reason")
    delete d.connectionReview.terminals.P.reason;
  if (problem === "blank-reason") d.connectionReview.terminals.P.reason = "  ";
  if (problem === "unknown-status")
    d.connectionReview.terminals.P.status = "ignored";
  if (problem === "coverage-notes") delete t.connectionCoverage.notes;
  if (problem === "coverage-status") t.connectionCoverage.status = "probably";
  return f.compile();
}
