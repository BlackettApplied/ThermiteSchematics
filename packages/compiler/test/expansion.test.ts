import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  expandResolvedProject,
  loadProject,
  resolveLoadedProject,
  type ExpansionResult,
  type IrFunction,
  type LoadedProject,
} from "../src/index.js";

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/device-expansion",
);

const BREAKER_UID = "10000000-0000-4000-8000-000000000001";
const CONTACTOR_UID = "10000000-0000-4000-8000-000000000002";
const OVERLOAD_UID = "10000000-0000-4000-8000-000000000003";
const PNP_UID = "10000000-0000-4000-8000-000000000004";
const ALL_KINDS_UID = "10000000-0000-4000-8000-000000000005";
const WRONG_DEVICE_UID = "10000000-0000-4000-8000-000000000006";
const CABLE_UID = "10000000-0000-4000-8000-000000000007";
const WRONG_CABLE_UID = "10000000-0000-4000-8000-000000000008";
const CORE_FIXTURE_UIDS = new Set([
  BREAKER_UID,
  CONTACTOR_UID,
  OVERLOAD_UID,
  PNP_UID,
]);

let project: LoadedProject;
let expansion: ExpansionResult;

beforeAll(async () => {
  const loaded = await loadProject(fixtureRoot);

  if (!loaded.ok) {
    throw new Error(
      `Fixture failed structural load: ${JSON.stringify(loaded.diagnostics)}`,
    );
  }

  project = loaded.project;
  expansion = expandResolvedProject(resolveLoadedProject(project));
});

function functionFact(
  record: IrFunction,
): [string, string, string, string | null, string | null, string[]] {
  return [
    record.id.deviceUid,
    record.id.functionKey,
    record.kind,
    "normal_state" in record ? record.normal_state : null,
    "direction" in record ? record.direction : null,
    record.terminals.map(({ terminalKey }) => terminalKey),
  ];
}

describe("D7 device/type expansion", () => {
  it("materializes reviewed exact breaker, contactor, overload, and PNP terminal records", () => {
    const facts = expansion.terminals
      .filter(({ id }) => CORE_FIXTURE_UIDS.has(id.deviceUid))
      .map(({ id, role, rating, description }) => [
        id.deviceUid,
        id.terminalKey,
        role ?? null,
        rating ?? null,
        description ?? null,
      ]);

    expect(facts).toEqual([
      [BREAKER_UID, "1/L1", "power_input", null, null],
      [BREAKER_UID, "2/T1", "power_output", null, null],
      [BREAKER_UID, "3/L2", "power_input", null, null],
      [BREAKER_UID, "4/T2", "power_output", null, null],
      [BREAKER_UID, "5/L3", "power_input", null, null],
      [BREAKER_UID, "6/T3", "power_output", null, null],
      [CONTACTOR_UID, "1/L1", "power_input", null, null],
      [CONTACTOR_UID, "13", "aux", null, null],
      [CONTACTOR_UID, "14", "aux", null, null],
      [CONTACTOR_UID, "2/T1", "power_output", null, null],
      [CONTACTOR_UID, "3/L2", "power_input", null, null],
      [CONTACTOR_UID, "4/T2", "power_output", null, null],
      [CONTACTOR_UID, "5/L3", "power_input", null, null],
      [CONTACTOR_UID, "6/T3", "power_output", null, null],
      [
        CONTACTOR_UID,
        "A1",
        "coil",
        { nominal_voltage: 24, voltage_type: "DC" },
        null,
      ],
      [CONTACTOR_UID, "A2", "coil_return", null, null],
      [OVERLOAD_UID, "1/L1", "power_input", null, null],
      [OVERLOAD_UID, "2/T1", "power_output", null, null],
      [OVERLOAD_UID, "3/L2", "power_input", null, null],
      [OVERLOAD_UID, "4/T2", "power_output", null, null],
      [OVERLOAD_UID, "5/L3", "power_input", null, null],
      [OVERLOAD_UID, "6/T3", "power_output", null, null],
      [OVERLOAD_UID, "95", "aux", null, null],
      [OVERLOAD_UID, "96", "aux", null, null],
      [
        PNP_UID,
        "1",
        "supply_positive",
        { nominal_voltage: 24, voltage_type: "DC" },
        null,
      ],
      [PNP_UID, "3", "supply_return", null, null],
      [PNP_UID, "4", "signal_output", null, null],
    ]);
  });

  it("normalizes only the four explicit PLC digital I/O connection policies", () => {
    const plcType = expansion.deviceTypes.find(
      ({ id }) => id === "core:plc-compact",
    );

    expect(
      plcType?.terminals.map(({ key, connectionPolicy }) => [
        key,
        connectionPolicy ?? null,
      ]),
    ).toEqual([
      ["L+", null],
      ["M", null],
      ["X1.0", "exclusive"],
      ["X1.1", "exclusive"],
      ["X2.0", "exclusive"],
      ["X2.1", "exclusive"],
    ]);
  });

  it("materializes reviewed exact breaker, contactor, overload, and PNP function records", () => {
    expect(
      expansion.functions
        .filter(({ id }) => CORE_FIXTURE_UIDS.has(id.deviceUid))
        .map(functionFact),
    ).toEqual([
      [BREAKER_UID, "pole1", "contact", "closed", null, ["1/L1", "2/T1"]],
      [BREAKER_UID, "pole2", "contact", "closed", null, ["3/L2", "4/T2"]],
      [BREAKER_UID, "pole3", "contact", "closed", null, ["5/L3", "6/T3"]],
      [BREAKER_UID, "trip", "mechanism", null, null, []],
      [CONTACTOR_UID, "aux13", "contact", "open", null, ["13", "14"]],
      [CONTACTOR_UID, "coil", "coil", null, null, ["A1", "A2"]],
      [CONTACTOR_UID, "pole1", "contact", "open", null, ["1/L1", "2/T1"]],
      [CONTACTOR_UID, "pole2", "contact", "open", null, ["3/L2", "4/T2"]],
      [CONTACTOR_UID, "pole3", "contact", "open", null, ["5/L3", "6/T3"]],
      [OVERLOAD_UID, "aux95", "contact", "closed", null, ["95", "96"]],
      [OVERLOAD_UID, "pole1", "contact", "closed", null, ["1/L1", "2/T1"]],
      [OVERLOAD_UID, "pole2", "contact", "closed", null, ["3/L2", "4/T2"]],
      [OVERLOAD_UID, "pole3", "contact", "closed", null, ["5/L3", "6/T3"]],
      [OVERLOAD_UID, "trip", "mechanism", null, null, []],
      [PNP_UID, "output", "channel", null, "output", ["4"]],
      [PNP_UID, "supply", "load", null, null, ["1", "3"]],
    ]);
  });

  it("anchors materialized core records at their exact type-definition locations", () => {
    expect(
      expansion.terminals.find(
        ({ id }) => id.deviceUid === BREAKER_UID && id.terminalKey === "1/L1",
      )?.source,
    ).toEqual({
      file: "@thermite/core-library/types/breaker-3p.json",
      line: 9,
      column: 17,
      jsonPointer: "/types/0/terminals/1~1L1",
    });
    expect(
      expansion.functions.find(
        ({ id }) => id.deviceUid === CONTACTOR_UID && id.functionKey === "coil",
      )?.source,
    ).toEqual({
      file: "@thermite/core-library/types/contactor-3p-1no.json",
      line: 24,
      column: 17,
      jsonPointer: "/types/0/functions/coil",
    });
    expect(
      expansion.functions.find(
        ({ id }) => id.deviceUid === OVERLOAD_UID && id.functionKey === "trip",
      )?.source,
    ).toEqual({
      file: "@thermite/core-library/types/overload-3p-1nc.json",
      line: 39,
      column: 17,
      jsonPointer: "/types/0/functions/trip",
    });
    expect(
      expansion.terminals.find(
        ({ id }) => id.deviceUid === PNP_UID && id.terminalKey === "1",
      )?.source,
    ).toEqual({
      file: "@thermite/core-library/types/prox-pnp-3wire.json",
      line: 9,
      column: 14,
      jsonPointer: "/types/0/terminals/1",
    });
  });

  it("materializes reviewed exact directed and symmetric relations for the four core fixtures", () => {
    expect(
      expansion.internalRelations
        .filter(({ deviceUid }) => CORE_FIXTURE_UIDS.has(deviceUid))
        .map(({ deviceUid, verb, from, to }) => [
          deviceUid,
          verb,
          from.functionKey,
          to.functionKey,
        ]),
    ).toEqual([
      [BREAKER_UID, "ganged_with", "pole1", "pole2"],
      [BREAKER_UID, "ganged_with", "pole2", "pole3"],
      [BREAKER_UID, "trips", "trip", "pole1"],
      [BREAKER_UID, "trips", "trip", "pole2"],
      [BREAKER_UID, "trips", "trip", "pole3"],
      [CONTACTOR_UID, "actuates", "coil", "aux13"],
      [CONTACTOR_UID, "actuates", "coil", "pole1"],
      [CONTACTOR_UID, "actuates", "coil", "pole2"],
      [CONTACTOR_UID, "actuates", "coil", "pole3"],
      [CONTACTOR_UID, "ganged_with", "pole1", "pole2"],
      [CONTACTOR_UID, "ganged_with", "pole2", "pole3"],
      [OVERLOAD_UID, "trips", "trip", "aux95"],
      [PNP_UID, "feeds_internal", "supply", "output"],
    ]);

    const pnpRelation = expansion.internalRelations.find(
      ({ deviceUid }) => deviceUid === PNP_UID,
    );
    expect(pnpRelation?.sourceOrigins).toEqual([
      {
        file: "@thermite/core-library/types/prox-pnp-3wire.json",
        line: 25,
        column: 9,
        jsonPointer: "/types/0/internal_relations/0",
      },
    ]);
  });

  it("covers every D8 function kind and preserves branch-specific metadata and definition provenance", () => {
    const functions = expansion.functions.filter(
      ({ id }) => id.deviceUid === ALL_KINDS_UID,
    );

    expect(functions.map(functionFact)).toEqual([
      [ALL_KINDS_UID, "a-coil", "coil", null, null, ["coil-a", "coil-b"]],
      [
        ALL_KINDS_UID,
        "b-contact",
        "contact",
        "open",
        null,
        ["contact-a", "contact-b"],
      ],
      [
        ALL_KINDS_UID,
        "c-contact",
        "contact",
        "closed",
        null,
        ["contact-a", "contact-b"],
      ],
      [
        ALL_KINDS_UID,
        "d-contact",
        "contact",
        "open",
        null,
        ["contact-a", "contact-b"],
      ],
      [ALL_KINDS_UID, "e-channel", "channel", null, "input", ["channel"]],
      [ALL_KINDS_UID, "f-source", "source", null, null, ["source"]],
      [ALL_KINDS_UID, "g-load", "load", null, null, ["load"]],
      [ALL_KINDS_UID, "h-bus", "bus", null, null, ["bus"]],
      [ALL_KINDS_UID, "i-mechanism", "mechanism", null, null, []],
      [ALL_KINDS_UID, "j-other", "other", null, null, ["other"]],
    ]);

    expect(
      expansion.terminals.find(
        ({ id }) =>
          id.deviceUid === ALL_KINDS_UID && id.terminalKey === "coil-a",
      ),
    ).toEqual({
      id: { deviceUid: ALL_KINDS_UID, terminalKey: "coil-a" },
      role: "coil_positive",
      rating: { nominal_voltage: 24, voltage_type: "DC" },
      description: "Metadata preservation terminal",
      source: {
        file: "library/types/types.json",
        line: 10,
        column: 19,
        jsonPointer: "/types/0/terminals/coil-a",
      },
    });
    expect(functions.find(({ id }) => id.functionKey === "e-channel")).toEqual({
      id: { deviceUid: ALL_KINDS_UID, functionKey: "e-channel" },
      terminals: [{ deviceUid: ALL_KINDS_UID, terminalKey: "channel" }],
      source: {
        file: "library/types/types.json",
        line: 41,
        column: 22,
        jsonPointer: "/types/0/functions/e-channel",
      },
      kind: "channel",
      direction: "input",
    });
  });

  it("normalizes symmetric gang facts, retains origins, computes closure, and keeps directed verbs directed", () => {
    const relations = expansion.internalRelations.filter(
      ({ deviceUid }) => deviceUid === ALL_KINDS_UID,
    );
    expect(
      relations.map(({ verb, from, to }) => [
        verb,
        from.functionKey,
        to.functionKey,
      ]),
    ).toEqual([
      ["actuates", "a-coil", "b-contact"],
      ["feeds_internal", "f-source", "e-channel"],
      ["ganged_with", "b-contact", "c-contact"],
      ["ganged_with", "c-contact", "d-contact"],
      ["trips", "i-mechanism", "c-contact"],
    ]);

    expect(
      relations.find(
        ({ verb, from, to }) =>
          verb === "ganged_with" &&
          from.functionKey === "b-contact" &&
          to.functionKey === "c-contact",
      )?.sourceOrigins,
    ).toEqual([
      {
        file: "library/types/types.json",
        line: 55,
        column: 9,
        jsonPointer: "/types/0/internal_relations/2",
      },
      {
        file: "library/types/types.json",
        line: 57,
        column: 9,
        jsonPointer: "/types/0/internal_relations/4",
      },
      {
        file: "library/types/types.json",
        line: 58,
        column: 9,
        jsonPointer: "/types/0/internal_relations/5",
      },
    ]);
    expect(
      relations.some(
        ({ verb, from, to }) =>
          verb === "ganged_with" &&
          from.functionKey === "b-contact" &&
          to.functionKey === "d-contact",
      ),
    ).toBe(false);
    expect(
      relations.some(
        ({ verb, from, to }) =>
          verb === "feeds_internal" &&
          from.functionKey === "e-channel" &&
          to.functionKey === "f-source",
      ),
    ).toBe(false);

    expect(expansion.gangedGroups).toContainEqual({
      id: "gang:sha256:97b2c72852c5235a14ccd4d6f77fffa5a782d3a48070a9c900a99e9c52ddffd1",
      functionIds: [
        { deviceUid: ALL_KINDS_UID, functionKey: "b-contact" },
        { deviceUid: ALL_KINDS_UID, functionKey: "c-contact" },
        { deviceUid: ALL_KINDS_UID, functionKey: "d-contact" },
      ],
    });
    expect(expansion.gangedGroups).toEqual([
      {
        id: "gang:sha256:38d83d9ed79ec27bc0666c8af5187ee514c973d13c3f90d990f4298446d83d93",
        functionIds: [
          { deviceUid: CONTACTOR_UID, functionKey: "pole1" },
          { deviceUid: CONTACTOR_UID, functionKey: "pole2" },
          { deviceUid: CONTACTOR_UID, functionKey: "pole3" },
        ],
      },
      {
        id: "gang:sha256:97b2c72852c5235a14ccd4d6f77fffa5a782d3a48070a9c900a99e9c52ddffd1",
        functionIds: [
          { deviceUid: ALL_KINDS_UID, functionKey: "b-contact" },
          { deviceUid: ALL_KINDS_UID, functionKey: "c-contact" },
          { deviceUid: ALL_KINDS_UID, functionKey: "d-contact" },
        ],
      },
      {
        id: "gang:sha256:d2f29ce863e87176aa0c8623d38708973c2150026cbc30f117abc80b65c240b3",
        functionIds: [
          { deviceUid: BREAKER_UID, functionKey: "pole1" },
          { deviceUid: BREAKER_UID, functionKey: "pole2" },
          { deviceUid: BREAKER_UID, functionKey: "pole3" },
        ],
      },
    ]);
    expect(
      expansion.gangedGroups.every(({ functionIds }) => functionIds.length > 1),
    ).toBe(true);
  });

  it("retains the reviewed normalized cable type without expanding conductors or merging metadata", () => {
    expect(expansion.cableTypes).toEqual([
      {
        kind: "cable_type",
        id: "core:cable-2pair-shielded",
        libraryName: "core",
        libraryVersion: "0.1.0",
        description: "Shielded two-pair instrumentation cable",
        aliases: [],
        conductors: [
          {
            id: "1+",
            color: "black",
            size: "18AWG",
            source: {
              file: "@thermite/core-library/types/cable-2pair-shielded.json",
              line: 9,
              column: 9,
              jsonPointer: "/types/0/conductors/0",
            },
          },
          {
            id: "1-",
            color: "white",
            size: "18AWG",
            source: {
              file: "@thermite/core-library/types/cable-2pair-shielded.json",
              line: 10,
              column: 9,
              jsonPointer: "/types/0/conductors/1",
            },
          },
          {
            id: "2+",
            color: "red",
            size: "18AWG",
            source: {
              file: "@thermite/core-library/types/cable-2pair-shielded.json",
              line: 11,
              column: 9,
              jsonPointer: "/types/0/conductors/2",
            },
          },
          {
            id: "2-",
            color: "green",
            size: "18AWG",
            source: {
              file: "@thermite/core-library/types/cable-2pair-shielded.json",
              line: 12,
              column: 9,
              jsonPointer: "/types/0/conductors/3",
            },
          },
        ],
        shield: true,
        construction: {
          outer_diameter: "8 mm",
          jacket_material: "PVC",
          conductor_material: "stranded copper",
          shield_construction: "overall foil shield with drain wire",
        },
        source: {
          file: "@thermite/core-library/types/cable-2pair-shielded.json",
          line: 4,
          column: 5,
          jsonPointer: "/types/0",
        },
      },
    ]);
    expect(expansion.cables).toEqual([
      {
        uid: CABLE_UID,
        designation: "CBL1",
        typeId: "core:cable-2pair-shielded",
        description: "Instance cable metadata",
        aliases: ["FIELD-CABLE"],
        source: {
          file: "sources/instances.json",
          line: 43,
          column: 5,
          jsonPointer: "/objects/6",
        },
      },
    ]);

    const contactor = expansion.devices.find(
      ({ uid }) => uid === CONTACTOR_UID,
    );
    const contactorType = expansion.deviceTypes.find(
      ({ id }) => id === "core:contactor-3p-1no",
    );
    expect(contactor).toMatchObject({
      description: "Instance contactor metadata",
      aliases: ["MAIN-CONTACTOR"],
      location: "+PANEL-A",
    });
    expect(contactorType).toMatchObject({
      description: "3-pole contactor, 24 VDC coil, 1 NO auxiliary contact",
      aliases: [],
    });
  });

  it("keeps unused types cataloged and emits no records for wrong-kind resolutions", () => {
    expect(expansion.deviceTypes.map(({ id }) => id)).toEqual([
      "core:breaker-3p",
      "core:contactor-3p-1no",
      "core:junction-box-8",
      "core:limit-switch-2wire",
      "core:motor-3ph",
      "core:overload-3p-1nc",
      "core:plc-compact",
      "core:prox-pnp-3wire",
      "core:psu-24vdc",
      "core:pushbutton-nc",
      "core:supply-480v-3ph",
      "core:terminal-block-8",
      "expansion:all-kinds",
      "expansion:unused",
    ]);
    expect(
      expansion.deviceTypes.find(({ id }) => id === "expansion:unused"),
    ).toEqual({
      kind: "device_type",
      id: "expansion:unused",
      libraryName: "expansion",
      libraryVersion: "0.1.0",
      aliases: [],
      terminals: [],
      functions: [],
      internalRelations: [],
      source: {
        file: "library/types/types.json",
        line: 67,
        column: 5,
        jsonPointer: "/types/1",
      },
    });

    const expandedUids = new Set([
      ...expansion.devices.map(({ uid }) => uid),
      ...expansion.cables.map(({ uid }) => uid),
      ...expansion.terminals.map(({ id }) => id.deviceUid),
      ...expansion.functions.map(({ id }) => id.deviceUid),
      ...expansion.internalRelations.map(({ deviceUid }) => deviceUid),
    ]);
    expect(expandedUids.has(WRONG_DEVICE_UID)).toBe(false);
    expect(expandedUids.has(WRONG_CABLE_UID)).toBe(false);
    expect(
      expansion.devices.some(({ typeId }) => typeId === "core:plc-compact"),
    ).toBe(false);
  });

  it("uses structural composite identities and preserves them and gang hashes across designation renames", () => {
    expect(
      expansion.terminals
        .filter(
          ({ id }) =>
            id.terminalKey === "1/L1" && CORE_FIXTURE_UIDS.has(id.deviceUid),
        )
        .map(({ id }) => id),
    ).toEqual([
      { deviceUid: BREAKER_UID, terminalKey: "1/L1" },
      { deviceUid: CONTACTOR_UID, terminalKey: "1/L1" },
      { deviceUid: OVERLOAD_UID, terminalKey: "1/L1" },
    ]);
    expect(
      expansion.functions
        .filter(
          ({ id }) =>
            id.functionKey === "pole1" && CORE_FIXTURE_UIDS.has(id.deviceUid),
        )
        .map(({ id }) => id),
    ).toEqual([
      { deviceUid: BREAKER_UID, functionKey: "pole1" },
      { deviceUid: CONTACTOR_UID, functionKey: "pole1" },
      { deviceUid: OVERLOAD_UID, functionKey: "pole1" },
    ]);

    const renamedProject = structuredClone(project);
    const breaker = renamedProject.sources
      .flatMap(({ value }) => value.objects)
      .find(({ uid }) => uid === BREAKER_UID);

    if (breaker?.kind !== "device") {
      throw new Error("Fixture breaker not found.");
    }

    breaker.designation = "RENAMED-CB";
    const renamedExpansion = expandResolvedProject(
      resolveLoadedProject(renamedProject),
    );
    expect(
      renamedExpansion.terminals
        .filter(({ id }) => id.deviceUid === BREAKER_UID)
        .map(({ id }) => id),
    ).toEqual(
      expansion.terminals
        .filter(({ id }) => id.deviceUid === BREAKER_UID)
        .map(({ id }) => id),
    );
    expect(
      renamedExpansion.gangedGroups.find(({ functionIds }) =>
        functionIds.some(({ deviceUid }) => deviceUid === BREAKER_UID),
      ),
    ).toEqual(
      expansion.gangedGroups.find(({ functionIds }) =>
        functionIds.some(({ deviceUid }) => deviceUid === BREAKER_UID),
      ),
    );
  });
});
