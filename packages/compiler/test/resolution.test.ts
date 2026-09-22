import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Diagnostic } from "@thermite/schema";
import { beforeAll, describe, expect, it } from "vitest";

import {
  loadProject,
  resolveLoadedProject,
  type LoadedProject,
  type ResolveLoadedProjectResult,
} from "../src/index.js";

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/referential-diagnostics",
);

interface ExpectedDiagnostic {
  code: string;
  file: string;
  line: number;
  column: number;
  jsonPointer: string;
  uid: string;
  related?: Diagnostic["related"];
}

let project: LoadedProject;
let resolution: ResolveLoadedProjectResult;

beforeAll(async () => {
  const loaded = await loadProject(fixtureRoot);

  if (!loaded.ok) {
    throw new Error(
      `Fixture failed structural load: ${JSON.stringify(loaded.diagnostics)}`,
    );
  }

  project = loaded.project;
  resolution = resolveLoadedProject(project);
});

function diagnosticShape(diagnostic: Diagnostic): ExpectedDiagnostic {
  return {
    code: diagnostic.code,
    file: diagnostic.file,
    line: diagnostic.line,
    column: diagnostic.column,
    jsonPointer: diagnostic.jsonPointer,
    uid: diagnostic.uid!,
    ...(diagnostic.related === undefined
      ? {}
      : { related: diagnostic.related }),
  };
}

function referenceKey(file: string, pointer: string): string {
  return `${file}#${pointer}`;
}

function authoredReferenceKeys(loadedProject: LoadedProject): string[] {
  const keys: string[] = [];

  for (const document of loadedProject.sources) {
    document.value.objects.forEach((object, objectIndex) => {
      const objectPointer = `/objects/${objectIndex}`;

      if (object.kind === "wire" || object.kind === "jumper") {
        object.endpoints.forEach((_reference, endpointIndex) => {
          keys.push(
            referenceKey(
              document.file,
              `${objectPointer}/endpoints/${endpointIndex}`,
            ),
          );
        });
      } else if (object.kind === "cable") {
        object.conductors.forEach((conductor, conductorIndex) => {
          conductor.endpoints.forEach((_reference, endpointIndex) => {
            keys.push(
              referenceKey(
                document.file,
                `${objectPointer}/conductors/${conductorIndex}/endpoints/${endpointIndex}`,
              ),
            );
          });
        });
      } else if (object.kind === "relation") {
        keys.push(referenceKey(document.file, `${objectPointer}/from`));
        keys.push(referenceKey(document.file, `${objectPointer}/to`));
      } else if (object.kind === "potential") {
        keys.push(referenceKey(document.file, `${objectPointer}/at`));
      }
    });
  }

  return keys;
}

describe("D7/D8 catalogs and referential diagnostics", () => {
  it("matches the exact E100-E104 fixture anchors, related locations, and enclosing UIDs", async () => {
    const expected = JSON.parse(
      await readFile(join(fixtureRoot, "expected.json"), "utf8"),
    ) as ExpectedDiagnostic[];

    expect(resolution.ok).toBe(false);
    expect(resolution.diagnostics.map(diagnosticShape)).toEqual(expected);
    expect(new Set(resolution.diagnostics.map(({ code }) => code))).toEqual(
      new Set(["E100", "E101", "E102", "E103", "E104"]),
    );
  });

  it("indexes all E020-clean project objects, canonical designations, and every loaded type exactly", () => {
    expect(resolution.catalogs.projectObjectsByUid).toHaveLength(32);
    expect(
      resolution.catalogs.projectObjectsByUid.get(
        "00000000-0000-4000-8000-000000000001",
      )?.object,
    ).toMatchObject({ kind: "device", designation: "=F1+P1-K1" });

    expect(
      resolution.catalogs.projectObjectsByDesignation
        .get("DUP-DEVICE")
        ?.map(({ object }) => object.kind),
    ).toEqual(["device", "device", "device"]);
    expect(
      resolution.catalogs.projectObjectsByDesignation
        .get("DUP-NONDEVICE")
        ?.map(({ object }) => object.kind),
    ).toEqual(["jumper", "wire"]);
    expect(
      resolution.catalogs.projectObjectsByDesignation
        .get("DUP-MIXED")
        ?.map(({ object }) => object.kind),
    ).toEqual(["device", "wire"]);
    expect(
      resolution.catalogs.projectObjectsByDesignation.has("ALIAS-K1"),
    ).toBe(false);
    expect(
      resolution.catalogs.projectObjectsByDesignation.has(
        "POTENTIAL-NAME-ONLY",
      ),
    ).toBe(false);

    expect([...resolution.catalogs.libraryTypesById.keys()]).toEqual([
      "catalog:opaque",
      "catalog:cable",
      "catalog:Unused",
    ]);
    expect(
      resolution.catalogs.libraryTypesById.get("catalog:Unused")?.type.kind,
    ).toBe("device_type");
    expect(resolution.catalogs.libraryTypesById.has("catalog:unused")).toBe(
      false,
    );
  });

  it("resolves exact opaque device designations and terminal keys to structural identities", () => {
    const opaqueDeviceUid = "00000000-0000-4000-8000-000000000001";
    const opaqueTerminals = resolution.terminalReferences
      .filter(({ terminal }) => terminal.deviceUid === opaqueDeviceUid)
      .map(({ terminal }) => terminal.terminalKey);

    expect(opaqueTerminals).toContain("13/NO");
    expect(opaqueTerminals).toContain("1/L1");
    expect(opaqueTerminals).toContain("X2.14");
    expect(
      resolution.terminalReferences.find(
        ({ ownerUid }) => ownerUid === "00000000-0000-4000-8000-00000000001f",
      ),
    ).toMatchObject({
      terminal: { deviceUid: opaqueDeviceUid, terminalKey: "X2.14" },
      source: {
        file: "sources/03-reference-sites.json",
        jsonPointer: "/objects/11/at",
      },
    });
  });

  it("applies every E100-E104 cascade suppression rule without summary diagnostics", () => {
    const duplicateFileDiagnostics = resolution.diagnostics.filter(
      ({ file }) => file === "sources/02-duplicates.json",
    );
    expect(duplicateFileDiagnostics.map(({ code }) => code)).toEqual([
      "E100",
      "E100",
      "E100",
      "E100",
    ]);

    const referenceDiagnostics = resolution.diagnostics.filter(
      ({ code }) => code === "E101" || code === "E102",
    );
    const e101ReferenceBases = new Set(
      referenceDiagnostics
        .filter(({ code }) => code === "E101")
        .map(({ file, jsonPointer }) =>
          referenceKey(file, jsonPointer.replace(/\/device$/u, "")),
        ),
    );
    const e102ReferenceBases = new Set(
      referenceDiagnostics
        .filter(({ code }) => code === "E102")
        .map(({ file, jsonPointer }) =>
          referenceKey(file, jsonPointer.replace(/\/terminal$/u, "")),
        ),
    );

    expect(
      [...e101ReferenceBases].filter((key) => e102ReferenceBases.has(key)),
    ).toEqual([]);
    expect(
      resolution.diagnostics.filter(
        ({ code, file, jsonPointer }) =>
          code === "E102" &&
          file === "sources/03-reference-sites.json" &&
          (jsonPointer.startsWith("/objects/9/") ||
            jsonPointer.startsWith("/objects/10/")),
      ),
    ).toEqual([]);

    expect(
      resolution.deviceReferences.map(({ ownerUid, deviceUid }) => ({
        ownerUid,
        deviceUid,
      })),
    ).toEqual([
      {
        ownerUid: "00000000-0000-4000-8000-000000000018",
        deviceUid: "00000000-0000-4000-8000-000000000002",
      },
      {
        ownerUid: "00000000-0000-4000-8000-000000000018",
        deviceUid: "00000000-0000-4000-8000-000000000003",
      },
    ]);
  });

  it("accounts for every endpoint, relation side, and potential at occurrence", () => {
    const resolved = new Set([
      ...resolution.deviceReferences.map(({ source }) =>
        referenceKey(source.file, source.jsonPointer),
      ),
      ...resolution.terminalReferences.map(({ source }) =>
        referenceKey(source.file, source.jsonPointer),
      ),
    ]);
    const diagnosed = new Set(
      resolution.diagnostics
        .filter(({ code }) => code === "E101" || code === "E102")
        .map(({ file, jsonPointer }) =>
          referenceKey(
            file,
            jsonPointer.replace(/\/(?:device|terminal)$/u, ""),
          ),
        ),
    );
    const cascadeSuppressed = new Set([
      referenceKey("sources/02-duplicates.json", "/objects/3/endpoints/0"),
      referenceKey("sources/02-duplicates.json", "/objects/3/endpoints/1"),
      referenceKey("sources/02-duplicates.json", "/objects/4/endpoints/0"),
      referenceKey("sources/02-duplicates.json", "/objects/4/endpoints/1"),
      referenceKey("sources/02-duplicates.json", "/objects/5/at"),
      referenceKey("sources/02-duplicates.json", "/objects/6/from"),
      referenceKey("sources/02-duplicates.json", "/objects/6/to"),
      referenceKey("sources/03-reference-sites.json", "/objects/9/endpoints/0"),
      referenceKey("sources/03-reference-sites.json", "/objects/9/endpoints/1"),
      referenceKey("sources/03-reference-sites.json", "/objects/10/at"),
    ]);
    const accountedFor = new Set([
      ...resolved,
      ...diagnosed,
      ...cascadeSuppressed,
    ]);

    expect(authoredReferenceKeys(project).sort()).toEqual(
      [...accountedFor].sort(),
    );
    expect(resolved.size + diagnosed.size + cascadeSuppressed.size).toBe(
      accountedFor.size,
    );
  });
});
