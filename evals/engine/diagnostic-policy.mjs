import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { resolve, isAbsolute } from "node:path";
export function assertLocations(diagnostics) {
  for (const d of diagnostics) {
    assert.equal(typeof d.file, "string");
    assert(d.file.length > 0);
    assert(
      Number.isInteger(d.line) && d.line > 0,
      "Diagnostic line must be positive",
    );
    assert(
      Number.isInteger(d.column) && d.column > 0,
      "Diagnostic column must be positive",
    );
    assert(
      typeof d.jsonPointer === "string" &&
        /^(?:\/(?:[^~]|~[01])*)*$/.test(d.jsonPointer),
      "Invalid diagnostic JSON pointer",
    );
    assert(typeof d.message === "string" && d.message.trim().length > 0);
    assert(["error", "warning", "info"].includes(d.severity));
    for (const r of d.related ?? []) {
      assert(typeof r.file === "string" && r.file.length > 0);
      assert(Number.isInteger(r.line) && r.line > 0);
      assert(Number.isInteger(r.column) && r.column > 0);
      assert(typeof r.note === "string" && r.note.length > 0);
    }
  }
}
export function containsAlternatives(diagnostic, alternatives) {
  const supplied = Array.isArray(diagnostic.allowed)
    ? [diagnostic.allowed]
    : Array.isArray(diagnostic.allowed?.values)
      ? [diagnostic.allowed.values]
      : [];
  // Only structured alternatives or a complete quoted array in the MESSAGE
  // count. File paths, UIDs, line numbers and related notes cannot satisfy it.
  for (const match of diagnostic.message.matchAll(
    /\[(?:[^\]"\\]|"(?:[^"\\]|\\.)*"|\\.)*\]/g,
  )) {
    try {
      supplied.push(JSON.parse(match[0]));
    } catch {
      /* not a JSON list */
    }
  }
  return supplied.some(
    (values) =>
      Array.isArray(values) &&
      values.every((v) => typeof v === "string") &&
      JSON.stringify([...new Set(values)].sort()) ===
        JSON.stringify([...alternatives].sort()),
  );
}
export async function typeAlternatives(diagnostic, alternatives, context) {
  if (diagnostic.allowedCount !== alternatives.length) return false;
  const expected = new Set(alternatives);
  const allowed = diagnostic.allowed;
  if (
    allowed !== undefined &&
    (!Array.isArray(allowed) ||
      new Set(allowed).size !== allowed.length ||
      allowed.some((id) => !expected.has(id)))
  )
    return false;
  // Helm G2.3: the structured full set is sufficient even when the message
  // quotes only ten entries. A message, file path or partial list is not a set.
  if (alternatives.length <= 50)
    return Array.isArray(allowed) && allowed.length === expected.size;
  if (
    allowed?.length > 50 ||
    !context ||
    !["device_type", "cable_type"].includes(context.kind)
  )
    return false;
  const lookup = diagnostic.allowedLookup;
  const prefix = `the "id" of each "types" entry whose "kind" is ${JSON.stringify(context.kind)} in the "sources" files of `;
  if (typeof lookup !== "string" || !lookup.startsWith(prefix)) return false;
  const names = [
    ...lookup.slice(prefix.length).matchAll(/"(?:[^"\\]|\\.)*"/g),
  ].map((match) => JSON.parse(match[0]));
  if (names.length === 0 || names.some((name) => !name.endsWith(".json")))
    return false;
  const libraries = new Map(
    context.project.libraries.map((library) => [
      library.manifest.canonicalPath,
      library,
    ]),
  );
  const visited = new Set(),
    found = new Set();
  const currentJson = async (document) => {
    const bytes = await readFile(document.canonicalPath);
    // Check the actual file, not just a catalog entry, and refuse changed
    // snapshots. The loader has already admitted and expanded its sources.
    return bytes.equals(Buffer.from(document.rawBytes))
      ? JSON.parse(bytes.toString("utf8"))
      : undefined;
  };
  try {
    for (const name of names) {
      if (isAbsolute(name)) return false;
      const candidates = new Set();
      for (const base of [
        context.project.logicalRootPath,
        context.engineRoot,
      ]) {
        try {
          const path = await realpath(resolve(base, name));
          if (libraries.has(path)) candidates.add(path);
        } catch (error) {
          if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
        }
      }
      // Both shipped runtime/source aliases must exist. Each quoted name must
      // identify one admitted manifest, even if another alias was read already.
      if (candidates.size !== 1) return false;
      const path = [...candidates][0];
      if (visited.has(path)) continue;
      visited.add(path);
      const library = libraries.get(path);
      const manifest = await currentJson(library.manifest);
      if (!Array.isArray(manifest?.sources) || library.sources.length === 0)
        return false;
      for (const source of library.sources) {
        const value = await currentJson(source);
        if (!Array.isArray(value?.types)) return false;
        for (const type of value.types)
          if (type.kind === context.kind) found.add(type.id);
      }
    }
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) return false;
    throw error;
  }
  return (
    found.size === expected.size && [...found].every((id) => expected.has(id))
  );
}
