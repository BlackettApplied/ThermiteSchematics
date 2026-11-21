// Lossless source retention is independent of successful measurement.
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { canonical } from "./support.mjs";
async function optional(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}
export async function retainPacket(directory, packet) {
  for (const sheet of packet.sheets)
    await writeFile(
      join(directory, `sheet-${String(sheet.number).padStart(3, "0")}.svg`),
      sheet.svg,
    );
  // Strip duplicates only after every delivered sheet is safely retained.
  await writeFile(
    join(directory, "packet.json"),
    JSON.stringify(
      canonical({
        ...packet,
        html: undefined,
        sheets: packet.sheets.map(({ svg, ...sheet }) => sheet),
      }),
    ) + "\n",
  );
}
export async function compactCase(directory, artifacts) {
  for (const name of ["ir.json", "query-reports.json"]) {
    const path = join(directory, name),
      bytes = await optional(path);
    if (bytes)
      await writeFile(
        path,
        JSON.stringify(canonical(JSON.parse(bytes))) + "\n",
      );
  }
  if (!artifacts) {
    const path = join(directory, "packet.html"),
      bytes = await optional(path);
    if (bytes) {
      await writeFile(path + ".gz", gzipSync(bytes, { level: 9 }));
      await rm(path);
    }
  }
}
export async function retainingCase(
  directory,
  artifacts,
  work,
  { temporaryProject = false } = {},
) {
  try {
    return await work();
  } finally {
    await compactCase(directory, artifacts);
    if (temporaryProject && !artifacts)
      await rm(join(directory, "project"), { recursive: true, force: true });
  }
}
