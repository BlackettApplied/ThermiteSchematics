import { cp, lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Tier2FixtureName = "right-deep" | "bridge";

export interface Tier2EndpointDefinition {
  readonly device: string;
  readonly terminal: string;
}

export interface Tier2WireDefinition {
  readonly uid: string;
  readonly designation: string;
  readonly endpoints: readonly [
    Tier2EndpointDefinition,
    Tier2EndpointDefinition,
  ];
}

export interface Tier2FixtureDefinition {
  readonly signalRemote: Tier2EndpointDefinition;
  readonly wires: readonly Tier2WireDefinition[];
}

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../..", import.meta.url)),
);
const canonicalProjectRoot = join(repositoryRoot, "examples", "motor-starter");

export const TIER2_SHARED_SOURCE = {
  ls1: {
    uid: "596f728b-1445-4c4b-8974-a3b4ea703636",
    type: "core:prox-pnp-3wire",
    description: "Three-wire PNP field proximity sensor permissive",
  },
  fieldWires: {
    "W-FLD-002": {
      uid: "4f3f64e8-af7c-4b5d-9cbc-250368ad3e75",
      ls1Terminal: "1",
    },
    "W-FLD-003": {
      uid: "c2dccef7-ec9d-48dc-b58b-6e0dd990dd51",
      ls1Terminal: "4",
      label: "LS1-PNP-OUT-PLC1-DI0",
    },
    "W-FLD-004": {
      uid: "4afbc8b2-5bd7-4b92-8f9d-dcf124b85d01",
      endpoints: [
        { device: "JB1", terminal: "X1.3" },
        { device: "LS1", terminal: "3" },
      ],
      properties: {
        label: "0V-JB1-LS1",
        size: "18AWG",
        color: "blue/white",
      },
    },
  },
} as const;

function endpoint(device: string, terminal: string): Tier2EndpointDefinition {
  return { device, terminal };
}

function wire(
  uid: string,
  designation: string,
  first: Tier2EndpointDefinition,
  second: Tier2EndpointDefinition,
): Tier2WireDefinition {
  return { uid, designation, endpoints: [first, second] };
}

export const TIER2_FIXTURES = {
  "right-deep": {
    signalRemote: endpoint("TB1", "8"),
    wires: [
      wire(
        "f0000000-0000-4000-8000-000000000410",
        "EQ-1",
        endpoint("LS1", "4"),
        endpoint("JB1", "X1.5"),
      ),
      wire(
        "00000000-0000-4000-8000-000000000411",
        "R2",
        endpoint("LS1", "4"),
        endpoint("JB1", "X1.6"),
      ),
      wire(
        "00000000-0000-4000-8000-000000000412",
        "R3",
        endpoint("LS1", "4"),
        endpoint("JB1", "X1.6"),
      ),
      wire(
        "00000000-0000-4000-8000-000000000413",
        "A",
        endpoint("JB1", "X1.6"),
        endpoint("JB1", "X1.7"),
      ),
      wire(
        "00000000-0000-4000-8000-000000000414",
        "B",
        endpoint("JB1", "X1.7"),
        endpoint("TB1", "3"),
      ),
      wire(
        "00000000-0000-4000-8000-000000000415",
        "L0-B",
        endpoint("JB1", "X1.5"),
        endpoint("TB1", "6"),
      ),
      wire(
        "00000000-0000-4000-8000-000000000416",
        "L0-C",
        endpoint("TB1", "6"),
        endpoint("TB1", "3"),
      ),
      wire(
        "00000000-0000-4000-8000-000000000417",
        "L1-B",
        endpoint("TB1", "8"),
        endpoint("JB1", "X1.7"),
      ),
    ],
  },
  bridge: {
    signalRemote: endpoint("TB1", "7"),
    wires: [
      wire(
        "f0000000-0000-4000-8000-000000000300",
        "EQ-1",
        endpoint("LS1", "4"),
        endpoint("TB1", "7"),
      ),
      wire(
        "00000000-0000-4000-8000-000000000301",
        "M1-S",
        endpoint("TB1", "7"),
        endpoint("JB1", "X1.6"),
      ),
      wire(
        "00000000-0000-4000-8000-000000000302",
        "S-A",
        endpoint("JB1", "X1.6"),
        endpoint("JB1", "X1.7"),
      ),
      wire(
        "00000000-0000-4000-8000-000000000303",
        "S-B",
        endpoint("JB1", "X1.6"),
        endpoint("TB1", "8"),
      ),
      wire(
        "00000000-0000-4000-8000-000000000304",
        "L2-A",
        endpoint("LS1", "4"),
        endpoint("JB1", "X1.5"),
      ),
      wire(
        "00000000-0000-4000-8000-000000000305",
        "L2-B",
        endpoint("JB1", "X1.5"),
        endpoint("TB1", "6"),
      ),
      wire(
        "00000000-0000-4000-8000-000000000306",
        "L2-C",
        endpoint("TB1", "6"),
        endpoint("JB1", "X1.7"),
      ),
      wire(
        "00000000-0000-4000-8000-000000000307",
        "BLOCK-A",
        endpoint("JB1", "X1.7"),
        endpoint("TB1", "3"),
      ),
      wire(
        "00000000-0000-4000-8000-000000000308",
        "BLOCK-B",
        endpoint("TB1", "8"),
        endpoint("TB1", "3"),
      ),
    ],
  },
} as const satisfies Readonly<Record<Tier2FixtureName, Tier2FixtureDefinition>>;

type JsonObject = Record<string, unknown>;

function required<Value>(value: Value | undefined, context: string): Value {
  if (value === undefined) throw new Error("Missing Tier 2 " + context + ".");
  return value;
}

async function readJsonObject(path: string): Promise<JsonObject> {
  return JSON.parse(await readFile(path, "utf8")) as JsonObject;
}

async function writeJsonObject(path: string, value: JsonObject): Promise<void> {
  await writeFile(path, JSON.stringify(value, undefined, 2) + "\n", "utf8");
}

function sourceObjects(source: JsonObject, context: string): JsonObject[] {
  if (!Array.isArray(source.objects)) {
    throw new Error("Tier 2 " + context + " has no objects array.");
  }
  return source.objects as JsonObject[];
}

function sourceObject(
  objects: readonly JsonObject[],
  designation: string,
): JsonObject {
  return required(
    objects.find((object) => object.designation === designation),
    "source object " + designation,
  );
}

function assertUid(object: JsonObject, expectedUid: string): void {
  if (object.uid !== expectedUid) {
    throw new Error(
      "Tier 2 " +
        String(object.designation) +
        " UID changed from " +
        expectedUid +
        ".",
    );
  }
}

function sourceEndpoint(device: string, terminal: string): JsonObject {
  return { device, terminal };
}

function replaceEndpoint(
  object: JsonObject,
  device: string,
  terminal: string,
): void {
  const endpoints = object.endpoints as JsonObject[];
  const candidate = required(
    endpoints.find((endpoint) => endpoint.device === device),
    String(object.designation) + " endpoint for " + device,
  );
  candidate.terminal = terminal;
}

async function assertOrdinaryTree(path: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) {
    throw new Error("Tier 2 fixture copy contains a reparse point: " + path);
  }
  if (stats.isDirectory()) {
    for (const entry of await readdir(path)) {
      await assertOrdinaryTree(join(path, entry));
    }
    return;
  }
  if (!stats.isFile()) {
    throw new Error("Tier 2 fixture copy contains a non-regular file: " + path);
  }
}

export async function materializeTier2Project(
  root: string,
  fixtureName: Tier2FixtureName,
): Promise<string> {
  const fixture = TIER2_FIXTURES[fixtureName];
  const projectRoot = join(root, fixtureName);
  await cp(canonicalProjectRoot, projectRoot, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
  });
  await assertOrdinaryTree(projectRoot);

  const equipmentPath = join(projectRoot, "devices", "equipment.json");
  const equipment = await readJsonObject(equipmentPath);
  const ls1 = sourceObject(sourceObjects(equipment, "equipment"), "LS1");
  assertUid(ls1, TIER2_SHARED_SOURCE.ls1.uid);
  ls1.type = TIER2_SHARED_SOURCE.ls1.type;
  ls1.description = TIER2_SHARED_SOURCE.ls1.description;
  await writeJsonObject(equipmentPath, equipment);

  const fieldPath = join(projectRoot, "connections", "field-terminations.json");
  const field = await readJsonObject(fieldPath);
  const fieldObjects = sourceObjects(field, "field terminations");
  const supply = sourceObject(fieldObjects, "W-FLD-002");
  assertUid(supply, TIER2_SHARED_SOURCE.fieldWires["W-FLD-002"].uid);
  replaceEndpoint(
    supply,
    "LS1",
    TIER2_SHARED_SOURCE.fieldWires["W-FLD-002"].ls1Terminal,
  );

  const signal = sourceObject(fieldObjects, "W-FLD-003");
  assertUid(signal, TIER2_SHARED_SOURCE.fieldWires["W-FLD-003"].uid);
  replaceEndpoint(
    signal,
    "LS1",
    TIER2_SHARED_SOURCE.fieldWires["W-FLD-003"].ls1Terminal,
  );
  const signalRemote = required(
    (signal.endpoints as JsonObject[]).find(
      (candidate) => candidate.device !== "LS1",
    ),
    "W-FLD-003 remote endpoint",
  );
  signalRemote.device = fixture.signalRemote.device;
  signalRemote.terminal = fixture.signalRemote.terminal;
  (signal.properties as JsonObject).label =
    TIER2_SHARED_SOURCE.fieldWires["W-FLD-003"].label;

  const returnWire = TIER2_SHARED_SOURCE.fieldWires["W-FLD-004"];
  fieldObjects.push({
    uid: returnWire.uid,
    kind: "wire",
    designation: "W-FLD-004",
    endpoints: returnWire.endpoints.map(({ device, terminal }) =>
      sourceEndpoint(device, terminal),
    ),
    properties: { ...returnWire.properties },
  });
  await writeJsonObject(fieldPath, field);

  await writeJsonObject(join(projectRoot, "connections", "tier2.json"), {
    $schema:
      "https://thermiteschematics.com/schemas/0.1/source-file.schema.json",
    objects: fixture.wires.map(({ uid, designation, endpoints }) => ({
      uid,
      kind: "wire",
      designation,
      endpoints: endpoints.map(({ device, terminal }) =>
        sourceEndpoint(device, terminal),
      ),
    })),
  });

  return projectRoot;
}
