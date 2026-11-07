import { canonical, sourceDocuments } from "./source-files.mjs";
import {
  regeneratePacket,
  regenerateView,
  cleanChecker,
} from "./artifacts.mjs";
// Synthetic user facts and reference actions. No manufacturer pinout is asserted.
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import {
  read,
  write,
  objects,
  documents,
  locate,
  ok,
  cli,
  query,
  patch,
  replaceObject,
  addSource,
  device,
  wire,
  ep,
  pdf,
  docView,
  view,
  packet,
} from "./task-support.mjs";
const coreType = (ctx, name) =>
  read(join(ctx.project, `libraries/core/types/${name}.json`)).types[0];
export function setup(id, ctx) {
  if (id === "T04") {
    addSource(ctx, "sensor.json", [
      device("PX1", "core:prox-pnp-3wire", {
        description: "0 V destination unknown; obtain user facts",
        connectionReview: {
          terminals: {
            3: {
              status: "required",
              reason: "Sensor return required; destination not supplied",
            },
          },
        },
      }),
    ]);
  }
  if (id === "T09a") {
    const { file, index } = locate(ctx.project, "W-CTL-001");
    const path = join(ctx.project, file),
      doc = read(path);
    doc.objects[index].endpoints.find((e) => e.device === "PLC1").terminal =
      "L";
    write(path, doc);
  }
  if (id === "T09b") {
    addSource(ctx, "ambiguous.json", [
      device("PX1", "core:prox-pnp-3wire"),
      device("PX2", "core:prox-pnp-3wire"),
      wire("W-AMB-1", ep("PX1", "4"), ep("PLC1", "X1.0")),
      wire("W-AMB-2", ep("PX2", "4"), ep("PLC1", "X1.0")),
    ]);
  }
}
export function reference(id, ctx) {
  if (id === "T01") {
    ok(ctx, "validate", ".");
    replaceObject(ctx, "PS1", "description", "Pump control supply");
    ok(ctx, "view", "PS1", "--loads", "-o", "drawings/ps1-loads.pdf");
  } else if (id === "T02") {
    ok(ctx, "validate", ".");
    const { file } = locate(ctx.project, "PLC1");
    const wiresFile = locate(ctx.project, "W-CTL-001").file;
    const additions = [device("K1", "core:contactor-3p-1no")];
    const wires = [
      wire("W-K1-1", ep("PLC1", "X2.0"), ep("K1", "A1")),
      wire("W-K1-2", ep("K1", "A2"), ep("PS1", "-")),
    ];
    const files = {
      [file]: [{ op: "add", path: "/objects/-", value: additions[0] }],
      [wiresFile]: wires.map((value) => ({
        op: "add",
        path: "/objects/-",
        value,
      })),
    };
    patch(ctx, files);
    ok(ctx, "view", "K1", "--actuation", "-o", "drawings/k1-control.pdf");
  } else if (id === "T03") {
    const { object } = locate(ctx.project, "CBL1"),
      cores = structuredClone(object.conductors),
      core = cores.find((c) => c.id === "1-");
    core.usage = "spare";
    core.endpoints = [null, null];
    replaceObject(ctx, "CBL1", "conductors", cores);
    write(
      join(ctx.project, "drawings/cable.json"),
      query(ctx, "cable", "CBL1", "--json"),
    );
    ok(ctx, "view", "CBL1", "--conductors", "-o", "drawings/cable.pdf");
  } else if (id === "T04") {
    addSource(ctx, "sensor-signal.json", [
      wire("W-PX1-SIG", ep("PX1", "4"), ep("PLC1", "X1.0")),
    ]);
    replaceObject(ctx, "PX1", "connectionReview", {
      terminals: {
        3: {
          status: "deferred",
          reason: "User has not supplied the 0 V destination",
        },
      },
    });
    return "PX1 signal is wired to PLC1 DI0. The 0 V destination is unknown and deferred; please supply it before completing the return.";
  } else if (id === "T05") {
    packet(ctx, [
      docView("terminals"),
      docView("io"),
      view("CBL1", "conductors"),
    ]);
  } else if (id === "T06") {
    const plc = structuredClone(coreType(ctx, "plc-compact"));
    plc.id = "site:plc";
    plc.ports = {
      ETH: { medium: "ethernet", connector: "Generic Ethernet interface" },
    };
    plc.symbol = "thermite:io-module";
    const hmi = {
      kind: "device_type",
      id: "site:hmi",
      description:
        "Generic HMI logical Ethernet interface; physical power and pinout unspecified",
      terminals: {},
      functions: {},
      ports: {
        ETH: { medium: "ethernet", connector: "Generic Ethernet interface" },
      },
      connectionCoverage: {
        status: "partial",
        notes:
          "User specified Ethernet only; physical power and pinout need part review",
      },
    };
    write(join(ctx.project, "libraries/site/library.json"), {
      name: "site",
      version: "0.1.0",
      sources: ["types.json"],
    });
    write(join(ctx.project, "libraries/site/types.json"), {
      types: [plc, hmi],
    });
    const path = join(ctx.project, "system.json"),
      manifest = read(path);
    manifest.libraries.push({
      name: "site",
      version: "0.1.0",
      path: "libraries/site",
    });
    write(path, manifest);
    ok(ctx, "lock", ".");
    replaceObject(ctx, "PLC1", "type", "site:plc");
    addSource(ctx, "network.json", [
      device("HMI1", "site:hmi"),
      {
        uid: "5abc7db2-853a-46e8-9ae8-9eab691b16ab",
        kind: "relation",
        designation: "ETH1",
        relation: "associated_with",
        from: { device: "PLC1" },
        to: { device: "HMI1" },
        connection: {
          fromPort: "ETH",
          toPort: "ETH",
          medium: "ethernet",
          protocol: "Ethernet",
          status: "planned",
        },
      },
    ]);
    ok(ctx, "validate", ".");
    ok(ctx, "lock", ".", "--check");
  } else if (id === "T07") {
    write(
      join(ctx.project, "issue.md"),
      "Title: Supply the optional field-interfaces library and reviewed parts\n\nThe installed runtime does not include the optional field-interfaces library. A 4–20 mA hookup requires sourced transmitter, analog-input and connector pin assignments. Please provide the library and exact reviewed parts. No verified pin map or electrical repair has been invented. Expected: offline acquisition instructions and a supported hookup recipe. Actual: the generic starter cannot establish this loop.\n",
    );
    return "I cannot produce a verified hookup from the supplied facts. Please provide the optional field-interfaces library and reviewed transmitter/analog-input parts. issue.md records the missing capability and requested facts.";
  } else if (id === "T08") {
    const group = {
      id: "coil",
      label: "PLC output through stop and overload",
      functions: [
        ["PLC1", "do0"],
        ["PB1", "contact"],
        ["OL1", "aux"],
        ["K1", "coil"],
      ].map(([value, key]) => ({ device: { by: "designation", value }, key })),
      conductors: ["W-CTL-005", "W-CTL-006", "W-CTL-007", "W-CTL-008"],
    };
    // Discover the real contact keys from the supplied example's generic types.
    group.functions[1].key = Object.keys(
      coreType(ctx, "pushbutton-nc").functions,
    )[0];
    group.functions[2].key = Object.entries(
      coreType(ctx, "overload-3p-1nc").functions,
    ).find(([, f]) => f.terminals.includes("95"))[0];
    packet(ctx, [
      {
        format: "circuit-view-request/0.1",
        title: "K1 control",
        groups: [group],
      },
    ]);
  } else if (id === "T09a") {
    const { object } = locate(ctx.project, "W-CTL-001"),
      endpoints = structuredClone(object.endpoints);
    endpoints.find((e) => e.device === "PLC1").terminal = "L+";
    replaceObject(ctx, "W-CTL-001", "endpoints", endpoints);
    ok(ctx, "validate", ".");
  } else if (id === "T09b") {
    return "E201: PLC1.X1.0 is exclusive and two conductors occupy it. Which sensor should connect here, and what destination is intended for the other? I left the source unchanged pending your facts.";
  } else if (id === "T10") {
    packet(
      ctx,
      [{ format: "communication-view-request/0.1", medium: "ethernet" }],
      "packet",
      { page: { size: "letter", orientation: "landscape" } },
    );
  } else if (id === "T11") {
    ok(ctx, "snapshot", "-o", "drawings/before.json");
    const { object } = locate(ctx.project, "W-CTL-001");
    replaceObject(ctx, "W-CTL-001", "properties", {
      ...object.properties,
      label: "CONTROL-24V",
    });
    write(
      join(ctx.project, "drawings/review.json"),
      query(ctx, "review", "--before", "drawings/before.json", "--json"),
    );
  } else if (id === "T12") {
    addSource(ctx, "excerpt.json", [
      device("S1", "core:limit-switch-2wire", {
        description:
          "Excerpt p2 line7: S1 NO limit switch. p2 line8 conflicts: same contact labelled S2. Review conflict; no destination or pin map supplied.",
      }),
    ]);
    write(
      join(ctx.project, "review-notes.md"),
      "p2 line7 says S1; p2 line8 says S2 for the same contact. Conflict remains open; no wiring or pin aliases inferred.\n",
    );
    return "I modeled the stated NO contact as a generic limit switch with page/line provenance. The S1/S2 label conflict remains in review-notes.md; please resolve it before wiring.";
  }
  return "Reference deliverables are ready; no electrical approval is implied.";
}
export async function check(id, ctx) {
  const checks = {},
    all = objects(ctx.project),
    get = (tag) => all.find((o) => o.designation === tag);
  const valid = () => cli(ctx, "validate", ".").status === 0;
  const net = (device, terminal) => {
    try {
      return query(
        ctx,
        "net",
        "--device",
        device,
        "--terminal",
        terminal,
        "--json",
      ).net.terminals.map((t) => t.display);
    } catch {
      return [];
    }
  };
  if (!["T09b"].includes(id)) checks.validates = valid();
  if (id === "T01") {
    checks.field = get("PS1")?.description === "Pump control supply";
    checks.pdf = (
      await regenerateView(ctx, "drawings/ps1-loads.pdf", [
        "view",
        "PS1",
        "--loads",
        "-o",
        "drawings/ps1-loads.pdf",
      ])
    ).pass;
  }
  if (id === "T02") {
    const k = get("K1");
    checks.type = k?.type === "core:contactor-3p-1no";
    checks.uid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(k?.uid);
    checks.output = net("PLC1", "X2.0").includes("K1.A1");
    checks.return = net("PS1", "-").includes("K1.A2");
    checks.exclusive = net("PLC1", "X2.0").length === 2;
    checks.pdf = (
      await regenerateView(ctx, "drawings/k1-control.pdf", [
        "view",
        "K1",
        "--actuation",
        "-o",
        "drawings/k1-control.pdf",
      ])
    ).pass;
  }
  if (id === "T03") {
    const cores = get("CBL1")?.conductors ?? [],
      core = cores.find((c) => c.id === "1-");
    checks.core =
      core?.usage === "spare" &&
      JSON.stringify(core.endpoints) === "[null,null]";
    checks.spareCount = cores.filter((c) => c.usage === "spare").length === 3;
    checks.derivedSpareCount =
      query(ctx, "cable", "CBL1", "--json").cores.filter(
        (c) => c.usage === "spare",
      ).length === 3;
    checks.pdf = (
      await regenerateView(ctx, "drawings/cable.pdf", [
        "view",
        "CBL1",
        "--conductors",
        "-o",
        "drawings/cable.pdf",
      ])
    ).pass;
  }
  if (id === "T04") {
    checks.signal = net("PLC1", "X1.0").includes("PX1.4");
    checks.noInventedReturn = !all.some((o) =>
      o.endpoints?.some((e) => e?.device === "PX1" && e.terminal === "3"),
    );
    checks.deferred =
      (get("PX1")?.connectionReview?.terminals?.["3"]?.status === "deferred" &&
        !!get("PX1")?.connectionReview?.terminals?.["3"]?.reason?.trim()) ||
      ctx.validationDiagnostics?.some(
        (d) => d.code === "W903" && get("PX1") && d.uid === get("PX1").uid,
      );
  }
  if (["T05", "T08", "T10"].includes(id)) {
    const regenerated = await regeneratePacket(ctx);
    const p = regenerated.packet ?? {};
    checks.artifacts = regenerated.pass;
    checks.pdf = await pdf(join(ctx.project, "drawings/packet.pdf"));
    checks.sheets = p.sheets?.length > 0;
    if (id === "T05") {
      checks.terminals = p.sheets?.some((s) => s.view?.kind === "terminals");
      checks.io = p.sheets?.some((s) => s.view?.kind === "io");
      checks.cable = JSON.stringify(
        (p.sheets ?? []).map((s) => s.view),
      ).includes("conductors");
      checks.index = p.sheets?.some((s) => s.view?.kind === "index");
    }
    if (id === "T08")
      checks.circuit = p.sheets?.some(
        (s) =>
          s.view?.kind === "circuit" &&
          s.references?.some((r) => r.designation === "K1"),
      );
    if (id === "T10") {
      checks.letter =
        p.page?.size === "letter" ||
        p.page?.widthMm === 279.4 ||
        p.page?.widthMm === 215.9;
      checks.sourceUnchanged = ctx.initial
        ? Object.entries(ctx.initial.files)
            .filter(
              ([path]) =>
                path.endsWith(".json") &&
                path !== ctx.initial.documents["system.json"].presentation &&
                !path.startsWith("drawings/"),
            )
            .every(([path, hash]) => ctx.final.files[path] === hash)
        : false;
    }
  }
  if (id === "T06") {
    const rel = all.find((o) => o.connection?.medium === "ethernet");
    checks.hmi = !!get("HMI1");
    checks.relation = !!(rel?.connection?.fromPort && rel?.connection?.toPort);
    checks.lock = cli(ctx, "lock", ".", "--check").status === 0;
    checks.noEthernetWire = !all.some(
      (o) =>
        ["wire", "jumper", "cable"].includes(o.kind) &&
        (o.endpoints ?? o.conductors?.flatMap((c) => c.endpoints) ?? []).some(
          (e) => e?.device === "HMI1",
        ),
    );
  }
  if (id === "T07") {
    const manifest = read(join(ctx.project, "system.json"));
    const supplied = manifest.libraries.some(
      (l) => l.name === "field-interfaces",
    );
    checks.issueOrHookup =
      (existsSync(join(ctx.project, "issue.md")) &&
        readFileSync(join(ctx.project, "issue.md"), "utf8").trim().length >=
          100) ||
      (supplied &&
        cli(ctx, "lock", ".", "--check").status === 0 &&
        (
          await regenerateView(ctx, "drawings/hookup.pdf", null, {
            allowedKinds: ["signal-loop", "wiring", "circuit"],
          })
        ).pass);
  }
  if (id === "T09a") {
    checks.endpoint = get("W-CTL-001")?.endpoints.some(
      (e) => e.device === "PLC1" && e.terminal === "L+",
    );
    const expected = structuredClone(ctx.initial.documents);
    for (const doc of Object.values(expected))
      for (const o of doc.objects ?? [])
        if (o.designation === "W-CTL-001")
          o.endpoints.find((e) => e.device === "PLC1").terminal = "L+";
    const beforePaths =
        ctx.initial.sourceFiles ?? documents(ctx.project).map((d) => d.path),
      afterPaths =
        ctx.final.sourceFiles ?? documents(ctx.project).map((d) => d.path);
    checks.singleFix =
      canonical(beforePaths) === canonical(afterPaths) &&
      canonical(ctx.initial.documents["system.json"]) ===
        canonical(ctx.final.documents["system.json"]) &&
      beforePaths.every(
        (path) =>
          canonical(expected[path]) === canonical(ctx.final.documents[path]),
      );
  }
  if (id === "T09b") {
    checks.errorKept = ((r) =>
      r.stdout.includes("E201") || r.stderr.includes("E201"))(
      cli(ctx, "validate", ".", "--json"),
    );
    checks.unchanged = ctx.sourceDiff === "";
  }
  if (id === "T11") {
    let review;
    try {
      review = read(join(ctx.project, "drawings/review.json"));
    } catch {
      review = {};
    }
    checks.label = get("W-CTL-001")?.properties?.label === "CONTROL-24V";
    const expected = structuredClone(ctx.initial.documents);
    for (const doc of Object.values(expected))
      for (const object of doc.objects ?? [])
        if (object.designation === "W-CTL-001")
          object.properties = { ...object.properties, label: "CONTROL-24V" };
    checks.onlyLabel =
      Object.entries(expected).every(
        ([path, doc]) =>
          canonical(doc) === canonical(ctx.final.documents[path]),
      ) &&
      canonical(ctx.initial.documents["system.json"]) ===
        canonical(ctx.final.documents["system.json"]) &&
      canonical(
        ctx.initial.sourceFiles ?? documents(ctx.project).map((d) => d.path),
      ) ===
        canonical(
          ctx.final.sourceFiles ?? documents(ctx.project).map((d) => d.path),
        );
    const clean = cleanChecker(ctx);
    try {
      review = query(
        clean,
        "review",
        "--before",
        join(ctx.project, "drawings/before.json"),
        "--json",
      );
    } catch {
      review = {};
    }
    checks.review =
      JSON.stringify(review).includes("CONTROL-24V") &&
      JSON.stringify(review).includes("W-CTL-001");
  }
  if (id === "T12") {
    checks.provenance = /\b(?:p(?:age)?\s*2)\b[\s\S]{0,80}?\bline\s*7\b/i.test(
      get("S1")?.description ?? "",
    );
    checks.conflict = existsSync(join(ctx.project, "review-notes.md"));
  }
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    rubricPending: !!ctx.task?.rubric,
    actualWarnings:
      ctx.validationDiagnostics?.filter((d) => d.severity === "warning") ?? [],
  };
}
