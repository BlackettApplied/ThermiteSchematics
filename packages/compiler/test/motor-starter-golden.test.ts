import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { updateShippedCoreGoldens } from "../../../scripts/update-shipped-core-goldens.mjs";
import {
  compileProject,
  serializeIr,
  type ElectricalIr,
  type IrNet,
  type TerminalId,
} from "../src/index.js";

const testRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testRoot, "../../..");
const motorStarterRoot = join(repositoryRoot, "examples", "motor-starter");
const goldenPath = join(testRoot, "goldens", "motor-starter.ir.json");

type TerminalMembership = [designation: string, terminalKey: string];

const EXPECTED_M2_NET_IDS = [
  "net:sha256:0ed8b5d5440f8c42b8e4f61d4332189c4e630922a2a804cdc1d2a2d79d6c64d5",
  "net:sha256:15c3458e516e2e6ed194933a7c8c6a37e40fe4232116d2eb4fea070353453efa",
  "net:sha256:1784e6e95ccec31dcc7c5d1788c3a4c12f0487bcf2248b5a571e677dd5382e64",
  "net:sha256:1c0de383321c47b753bea2bfc107f16fdc40754b37a25b03b6163ccea057c011",
  "net:sha256:3b67598e0ecf3028d423522ca4946610148f52db8c81de5534a64857e63b1e21",
  "net:sha256:3d137761e58b445ed267e091f04cad782acdcec2f6a9f762594531476d54202a",
  "net:sha256:41a6325a0b80c8d8c20c419014ac9841b5a29f15125f9a77b1d50af8877c52f6",
  "net:sha256:50fed8ce9a698f44530313ab1acec2f9d6d5c57de79e1eb999204414f1f3f4d0",
  "net:sha256:52ba7a062565b174f4600a3a6abed4b7579246a66e0a5e76b194ad71484cae44",
  "net:sha256:5901afd9631d2b87fc7b5fdaca3a23aec1a1f3bd10736cd833f9167244fb6ada",
  "net:sha256:68258f3a152368afd62a501da7b3fb0dcf1083c89e35e8367f0a5eafd21119cc",
  "net:sha256:68398c3c78a682670c09daf9834ae085a810188ef255f5ac0f8f9c4ebf2481b6",
  "net:sha256:6f72278ea9e513fd32dd4786775ecbbd9b1a07d662dae8feed051ea2a73158bc",
  "net:sha256:72a015f08216f38a067efa9dcc5f76ad2ed9246cb564f07dcd2abaed457c366d",
  "net:sha256:73c27452e1fd0c665c33bf8a4e4003cd217ec8b4e3582aa702153d07cdbd5177",
  "net:sha256:7c4cdde995c0b4c4109f3b3b56b41fec38c6d4bedc5b1c28a83047b9c0ae0795",
  "net:sha256:81c26503ab166cd920ccf3536cb4a19802cbdcd37b2627117c36a048f4868500",
  "net:sha256:8d49f43674cfa3024bc2fffb6f58c15075c10943067b114959872ab5324a499d",
  "net:sha256:9310f1b496219989574a6e6ec7ad3ac3b009a988ec05c7b54945167dcda27842",
  "net:sha256:a0e324c6f5200455a78f81a5d00713dac39f22ebca90a465e35dfe3b10fcba44",
  "net:sha256:a956f28d654c65096eacbdec1189dd972cd8f06c30a87f2a8376164fd4c25db7",
  "net:sha256:af8c9ba2461a98df6aae2bc32934bfb43e00d202ef9d6a0b4f8c8be8409877b9",
  "net:sha256:b0ce95efc0b1716903ecd3c382552ecb2d8d118f2280b19aef67f300a11f0453",
  "net:sha256:cb95e96df5a95d7aa47d44182a416a3d2f546784e325eb156f6cacfade3aa8ff",
  "net:sha256:cf554decaabe2bb3b6baeda86b2e38fb6dcf809ea7dc87419077832095cd3b12",
  "net:sha256:d84193c45ef2dd9f0fd849a6d59cdce28071e8d0ba8652bc3470f8786de9cbb8",
  "net:sha256:dd7c3227e6124826bed08e1861e49edce66b7aae83bef5d189698fe69b978e23",
  "net:sha256:de8cd0d0a2b62f2b540a39b338e9701f6e5b5e9479a2b7dc96ab8e90fc998ce5",
  "net:sha256:deacda4a377fc666cbe97e4da26406f019aef0d69b91a5ea81130cded2dad5a0",
  "net:sha256:e73d0f34ead75e9c1f0ffcdf82560b6a65cf8db6d68a70f1b38a81fd87892066",
  "net:sha256:ed29b56b7960cb4273f6090ee961a0ebdb7af49832610a2a01c811666115dc65",
] as const;

let motorIr: ElectricalIr;
let motorBytes: string;

beforeAll(async () => {
  const compiled = await compileProject(motorStarterRoot);

  if (!compiled.ok) {
    throw new Error(
      `Motor-starter compilation failed: ${JSON.stringify(compiled.diagnostics)}`,
    );
  }

  motorIr = compiled.ir;
  motorBytes = serializeIr(compiled.ir);
});

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareMembership(
  left: TerminalMembership,
  right: TerminalMembership,
): number {
  return compareText(left[0], right[0]) || compareText(left[1], right[1]);
}

function terminalMembership(id: TerminalId): TerminalMembership {
  const device = motorIr.devices.find(({ uid }) => uid === id.deviceUid);

  if (device === undefined) {
    throw new Error(`No device found for terminal ${JSON.stringify(id)}.`);
  }

  return [device.designation, id.terminalKey];
}

function memberships(net: IrNet): TerminalMembership[] {
  return net.terminalIds.map(terminalMembership).sort(compareMembership);
}

function findNetForPotential(name: string): IrNet {
  const potential = motorIr.potentials.find(
    (candidate) => candidate.name === name,
  );
  const net = motorIr.nets.find(({ id }) => id === potential?.netId);

  if (potential === undefined || net === undefined) {
    throw new Error(`No compiled net found for potential ${name}.`);
  }

  return net;
}

function findNetForTerminal(designation: string, terminalKey: string): IrNet {
  const device = motorIr.devices.find(
    (candidate) => candidate.designation === designation,
  );

  if (device === undefined) {
    throw new Error(`No compiled device found for ${designation}.`);
  }

  const netId = motorIr.indexes.netIdByTerminal.find(
    ({ key }) =>
      key.deviceUid === device.uid && key.terminalKey === terminalKey,
  )?.value;
  const net = motorIr.nets.find(({ id }) => id === netId);

  if (net === undefined) {
    throw new Error(`No compiled net found for ${designation}.${terminalKey}.`);
  }

  return net;
}

function expectMemberships(net: IrNet, expected: TerminalMembership[]): void {
  expect(memberships(net)).toEqual([...expected].sort(compareMembership));
}

describe("motor-starter IR golden", () => {
  it(
    "regenerates only the three Task-2 shipped-core authorities in check mode",
    { timeout: 120_000 },
    async () => {
      await updateShippedCoreGoldens("--check");
    },
  );

  it("byte-compares the recompiled project with the checked-in full IR", async () => {
    expect(motorBytes).toBe(await readFile(goldenPath, "utf8"));
  });

  it("stays diagnostic-free and byte-stable across repeated full compiles", async () => {
    const first = await compileProject(motorStarterRoot);
    const second = await compileProject(motorStarterRoot);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.diagnostics).toEqual([]);
    expect(second.diagnostics).toEqual([]);
    if (!first.ok || !second.ok) return;
    expect(serializeIr(first.ir)).toBe(motorBytes);
    expect(serializeIr(second.ir)).toBe(motorBytes);
  });

  it("asserts every reviewed table, edge, net, and singleton count", () => {
    expect(motorIr.deviceTypes).toHaveLength(12);
    expect(motorIr.cableTypes).toHaveLength(1);
    expect(motorIr.deviceTypes.length + motorIr.cableTypes.length).toBe(13);
    expect(motorIr.devices).toHaveLength(11);
    expect(motorIr.terminals).toHaveLength(62);
    expect(motorIr.functions).toHaveLength(43);
    expect(motorIr.internalRelations).toHaveLength(17);
    expect(motorIr.gangedGroups).toHaveLength(2);
    expect(motorIr.wires).toHaveLength(26);
    expect(motorIr.jumpers).toHaveLength(1);
    expect(motorIr.cableConductors).toHaveLength(4);
    expect(motorIr.relations).toHaveLength(2);
    expect(motorIr.potentials).toHaveLength(4);

    const conductiveEdgeCount =
      motorIr.wires.length +
      motorIr.jumpers.length +
      motorIr.cableConductors.length;
    expect(conductiveEdgeCount).toBe(31);
    expect(motorIr.indexes.terminalIdsByConductiveElement).toHaveLength(31);
    expect(motorIr.nets).toHaveLength(31);
    expect(
      motorIr.nets.filter(
        ({ terminalIds, conductiveElementIds }) =>
          terminalIds.length === 1 && conductiveElementIds.length === 0,
      ),
    ).toHaveLength(11);
  });

  it("preserves every M2 net ID and therefore its hashed terminal membership", () => {
    expect(motorIr.nets.map(({ id }) => id)).toEqual(EXPECTED_M2_NET_IDS);
  });

  it("carries policies on exactly the four PLC digital I/O terminal definitions and instances", () => {
    expect(
      motorIr.deviceTypes.flatMap((type) =>
        type.terminals
          .filter(({ connectionPolicy }) => connectionPolicy !== undefined)
          .map(({ key, connectionPolicy }) => [type.id, key, connectionPolicy]),
      ),
    ).toEqual([
      ["core:plc-compact", "X1.0", "exclusive"],
      ["core:plc-compact", "X1.1", "exclusive"],
      ["core:plc-compact", "X2.0", "exclusive"],
      ["core:plc-compact", "X2.1", "exclusive"],
    ]);

    const plcUid = motorIr.devices.find(
      ({ designation }) => designation === "PLC1",
    )?.uid;
    expect(
      motorIr.terminals
        .filter(({ connectionPolicy }) => connectionPolicy !== undefined)
        .map(({ id, connectionPolicy }) => [
          id.deviceUid,
          id.terminalKey,
          connectionPolicy,
        ]),
    ).toEqual([
      [plcUid, "X1.0", "exclusive"],
      [plcUid, "X1.1", "exclusive"],
      [plcUid, "X2.0", "exclusive"],
      [plcUid, "X2.1", "exclusive"],
    ]);
  });

  it("asserts the exact complete memberships of every reviewed named net", () => {
    expectMemberships(findNetForPotential("+24VDC"), [
      ["PS1", "+"],
      ["PLC1", "L+"],
      ["TB1", "1"],
      ["TB1", "2"],
      ["JB1", "X1.1"],
      ["LS1", "13"],
    ]);
    expectMemberships(findNetForTerminal("LS1", "14"), [
      ["LS1", "14"],
      ["JB1", "X1.2"],
      ["TB1", "3"],
      ["PLC1", "X1.0"],
    ]);
    expectMemberships(findNetForPotential("0VDC"), [
      ["PS1", "-"],
      ["PLC1", "M"],
      ["K1", "A2"],
      ["TB1", "4"],
      ["JB1", "X1.3"],
    ]);
    expectMemberships(findNetForPotential("PE"), [
      ["SRC1", "PE"],
      ["M1", "PE"],
    ]);
    expectMemberships(findNetForPotential("L1"), [
      ["SRC1", "L1"],
      ["CB1", "1/L1"],
    ]);
  });

  it("asserts the exact CBL1 type-conductor metadata", () => {
    const cable = motorIr.cables.find(
      ({ designation }) => designation === "CBL1",
    );

    if (cable === undefined) {
      throw new Error("Compiled CBL1 cable not found.");
    }

    const metadata = Object.fromEntries(
      motorIr.cableConductors
        .filter(({ id }) => id.cableUid === cable.uid)
        .map(({ id, typeConductor }) => [
          id.conductorId,
          typeConductor === null
            ? null
            : { color: typeConductor.color, size: typeConductor.size },
        ]),
    );

    expect(metadata).toEqual({
      "1+": { color: "black", size: "18AWG" },
      "1-": { color: "white", size: "18AWG" },
      "2+": { color: "red", size: "18AWG" },
      "2-": { color: "green", size: "18AWG" },
    });
  });
});
