import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
export function createVerificationCompiler({
  objects,
  sourcePath,
  json,
  fixture,
  compileProject,
  diagnostic,
}) {
  const compile = async (stage, nextObjects = objects) => {
    await writeFile(sourcePath, json({ objects: nextObjects }));
    const value = await compileProject(fixture);
    diagnostic(stage, value);
    assert.equal(value.ok, true, json(value.diagnostics));
    return value;
  };
  return compile;
}
async function checkRequiredTerminal(
  { links, compile, objects, assertNetPartition, keys },
  key,
) {
  const remaining = links.filter(
    (link) => link.from !== key && link.to !== key,
  );
  const value = await compile(
    `required-terminal-${key}`,
    objects.filter(
      (object) =>
        !object.endpoints?.some(
          (end) => end.device === "D1" && end.terminal === key,
        ),
    ),
  );
  assertNetPartition(value.ir, keys, remaining, [key]);
  assert(
    value.diagnostics.some(
      (entry) =>
        entry.code === "W903" &&
        entry.message.startsWith("D1:") &&
        entry.message.includes(key),
    ),
    `Disconnected required terminal ${key} did not produce W903`,
  );
}
export async function verifyNegativeChecks(context) {
  const {
    check,
    fixture,
    links,
    required,
    compile,
    objects,
    assertNetPartition,
    keys,
    typePath,
    snapshots,
    compileProject,
    diagnostic,
    json,
    sourcePath,
  } = context;
  try {
    for (let index = 0; index < links.length; index++) {
      await check(`remove-fixed-link-${index + 1}`, async () => {
        const remaining = links.filter((_, position) => position !== index);
        const variant = await compile(
          `remove-fixed-link-${index + 1}`,
          objects.filter(
            (object) => object.designation !== `FIXED${index + 1}`,
          ),
        );
        assertNetPartition(variant.ir, keys, remaining);
      });
    }
    await check("remove-all-fixed-links", async () => {
      const value = await compile(
        "remove-all-fixed-links",
        objects.filter((object) => object.kind !== "jumper"),
      );
      assertNetPartition(value.ir, keys, []);
    });
    for (const key of required) {
      await check(`required-terminal-${key}`, async () => {
        return checkRequiredTerminal(context, key);
      });
    }
    await check("stale-library-bytes", async () => {
      await writeFile(
        typePath,
        Buffer.concat([snapshots.get("type.json"), Buffer.from("\n")]),
      );
      const stale = await compileProject(fixture);
      diagnostic("stale-library", stale);
      assert.equal(stale.ok, false, "A stale byte lock was accepted");
      assert(
        stale.diagnostics.some((entry) => entry.code === "E108"),
        "Stale library bytes did not produce E108",
      );
    });
  } finally {
    await writeFile(typePath, snapshots.get("type.json"));
    await writeFile(sourcePath, json({ objects }));
  }
}
