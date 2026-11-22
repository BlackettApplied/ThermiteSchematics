import { paintedWireUids } from "./conductor-ink.mjs";
import { cableListingMatches } from "./cable-listing.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DOMParser } from "linkedom";
import { sha256 } from "./snapshot.mjs";
import { libraryTypes, canonical } from "./source-files.mjs";
import {
  SYMBOL_PROFILES,
  symbolProfile,
} from "../../packages/schema/dist/index.js";
import {
  regeneratePacket,
  regenerateView,
  cleanChecker,
  deliveredBytes,
  pdf,
} from "./artifacts.mjs";
import {
  conveyorOutputs,
  conveyorBaseline,
  conveyorPacketRequest,
  captureChain,
  exportFile,
  verifyStandaloneExport,
  regenerateConveyorBundle,
} from "./conveyor-exports.mjs";
import {
  read,
  write,
  objects,
  locate,
  cli,
  ok,
  query,
  replaceObject,
  addSource,
  device,
  wire,
  ep,
  docView,
  view,
} from "./task-support.mjs";
export function schematicSheets(packet) {
  return (packet?.sheets ?? []).filter(
    (s) =>
      s.view?.format?.startsWith("schematic-view/") ||
      [
        "circuit",
        "wiring",
        "communication",
        "signal-loop",
        "connector-assembly",
      ].includes(s.view?.kind),
  );
}
export function drawingNames(packet) {
  const names = new Set(
    schematicSheets(packet).flatMap((s) =>
      (s.references ?? []).map((r) => r.designation),
    ),
  );
  for (const sheet of schematicSheets(packet))
    if (sheet.view?.root?.kind === "cable")
      names.add(sheet.view.root.designation);
  return names;
}
// Packet coverage covers only audited circuit/wiring views. Continuous
// schematic exports also emit physical wire paths with source UIDs.
function drawnWires(packet) {
  const uids = new Set();
  for (const sheet of schematicSheets(packet)) {
    if (!sheet.svg) continue;
    const svg = new DOMParser().parseFromString(sheet.svg, "image/svg+xml");
    for (const path of svg.querySelectorAll("path.wire-path[data-wire-uid][d]"))
      if (path.getAttribute("d").trim())
        uids.add(path.getAttribute("data-wire-uid"));
  }
  return uids;
}
export function fitsRole(object, type, role) {
  if (role === "cable") return object?.kind === "cable";
  if (object?.kind !== "device" || !type) return false;
  const profile = SYMBOL_PROFILES.find((p) => p.id === symbolProfile(type)),
    family = profile?.id.split(":")[1],
    functions = Object.values(type.functions ?? {}),
    has = (kind, direction) =>
      functions.some(
        (f) => f.kind === kind && (!direction || f.direction === direction),
      );
  switch (role) {
    case "supply":
      return (
        has("source") &&
        functions.some((f) => f.kind === "source" && f.terminals?.length === 3)
      );
    case "breaker":
    case "overload":
      return family === role;
    case "contactor":
      return has("coil") && has("contact");
    case "motor":
      return !!profile && /^motor(?:-|$)/.test(family);
    case "psu":
      return has("source") && has("load");
    case "plc":
      return has("channel", "input") && has("channel", "output");
    case "terminal":
    case "junction":
      return functions.length > 0 && functions.every((f) => f.kind === "bus");
    case "start-button":
      return (
        family === "pushbutton" &&
        functions.some((f) => f.kind === "contact" && f.normal_state === "open")
      );
    case "level-switch":
      return ["level-switch", "level-sensor", "conductivity-probe"].includes(
        family,
      );
    case "stop-button":
      return (
        family === "pushbutton" &&
        functions.some(
          (f) => f.kind === "contact" && f.normal_state === "closed",
        )
      );
    case "pnp-sensor":
      return (
        has("load") &&
        has("channel", "output") &&
        family === "sensor-3wire" &&
        /\bPNP\b/i.test(type.description ?? "")
      );
    case "pressure-transmitter":
      return !!profile?.support.some(
        (s) => s.family === "signal-loop" && s.role === "from",
      );
    case "analog-input":
      return (
        Object.values(type.terminals ?? {}).some((t) =>
          /analog.?input/i.test(t.role ?? ""),
        ) ||
        functions.some(
          (f) =>
            f.kind === "channel" &&
            f.direction === "input" &&
            f.terminals?.length === 2,
        )
      );
    case "hmi":
      return (
        Object.values(type.ports ?? {}).some((p) => p.medium === "ethernet") &&
        !fitsRole(object, type, "plc")
      );
    case "indicator":
      return family === "lamp";
    default:
      return false;
  }
}

function gapExists(gap, requirement, types) {
  if (!gap || canonical(gap) !== canonical(requirement.allowedGap))
    return false;
  const inventory = types.filter((t) => t.library === gap.library);
  if (!inventory.length) return false;
  if (gap.capability === "digital-input-count")
    return (
      Math.max(
        ...inventory.map(
          (t) =>
            Object.values(t.functions ?? {}).filter(
              (f) =>
                f.kind === "channel" &&
                f.direction === "input" &&
                f.terminals?.length === 1,
            ).length,
        ),
      ) < gap.minimum
    );
  return !inventory.some((type) =>
    fitsRole({ kind: "device" }, type, gap.capability),
  );
}
function applyRequest(call) {
  if (
    call.argv?.[0] !== "agent" ||
    call.argv?.[1] !== "apply-source-patch" ||
    call.exit !== 0
  )
    return null;
  try {
    const request = JSON.parse(call.request ?? "null");
    return request?.dryRun === false ? request : null;
  } catch {
    return null;
  }
}
function recordedDigest(value) {
  return typeof value === "string" && value.startsWith("sha256-")
    ? Buffer.from(value.slice(7), "base64").toString("hex")
    : null;
}
function changedWireUids(applies) {
  const touched = new Set();
  for (const { call, request } of applies) {
    const targets = new Set(request.files?.map(({ path }) => path));
    for (const file of call.patchFiles ?? []) {
      if (
        !file.changed ||
        !targets.has(file.path) ||
        !call.before?.files?.[file.path] ||
        !call.after?.files?.[file.path] ||
        recordedDigest(file.beforeIntegrity) !== call.before.files[file.path] ||
        recordedDigest(file.afterIntegrity) !== call.after.files[file.path]
      )
        continue;
      const before = call.before.documents?.[file.path]?.objects;
      const after = call.after.documents?.[file.path]?.objects;
      if (!Array.isArray(before) || !Array.isArray(after)) continue;
      const prior = new Map(before.map((object) => [object.uid, object]));
      for (const object of after)
        if (
          object.kind === "wire" &&
          object.uid &&
          canonical(prior.get(object.uid)) !== canonical(object)
        )
          touched.add(object.uid);
    }
  }
  return touched;
}
function hasRule(version, patch) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  return (
    !!match &&
    (+match[1] > 1 ||
      (+match[1] === 1 &&
        (+match[2] > 6 || (+match[2] === 6 && +match[3] >= patch))))
  );
}

export function assessDogfood({
  task,
  promptVersion = task.version,
  validationExit,
  files,
  packet,
  sourceObjects,
  types = [],
  calls,
  matrix,
  drawEvidence,
  counts,
  diagnostics = [],
}) {
  const spec = task.deliverables,
    byTag = new Map(
      sourceObjects.filter((o) => o.designation).map((o) => [o.designation, o]),
    ),
    byType = new Map(types.map((t) => [t.id, t])),
    drawn = drawingNames(packet),
    wireInk = drawnWires(packet),
    requirements = spec.requirements;
  const applies = calls.flatMap((call) => {
    const request = applyRequest(call);
    return request && call.editsByThisCall?.length ? [{ call, request }] : [];
  });
  const changedWires = changedWireUids(applies);
  let paintedChangeWires;
  const uidNames = new Map(sourceObjects.map((o) => [o.uid, o.designation]));
  const warnings = diagnostics.map((d) => ({
    ...d,
    designation:
      d.designation ??
      uidNames.get(d.uid) ??
      /^([^:]+):/.exec(d.message ?? "")?.[1],
  }));
  const psuInputs = (psu) =>
    Object.values(byType.get(psu?.type)?.functions ?? {})
      .filter((f) => f.kind === "load")
      .flatMap((f) => f.terminals);
  const inputConductors = (psu, terminal) =>
    sourceObjects.filter(
      (o) =>
        ["wire", "jumper"].includes(o.kind) &&
        o.endpoints?.some(
          (e) => e?.device === psu.designation && e.terminal === terminal,
        ),
    );
  const deferredInput = (psu, terminal) =>
    psu.connectionReview?.terminals?.[terminal]?.status === "deferred" &&
    inputConductors(psu, terminal).length === 0 &&
    warnings.some(
      (d) => d.designation === psu.designation && d.code === "W905",
    );
  const rows = Array.isArray(matrix) ? matrix : [];
  const decisions = requirements.map((requirement) => {
    const matches = rows.filter(
        (r) =>
          typeof r.id === "string" && r.id.toUpperCase() === requirement.id,
      ),
      row = matches[0],
      evidence = row?.evidence,
      summary = typeof evidence === "string" ? evidence : evidence?.summary;
    const names = row?.designations,
      known =
        Array.isArray(names) &&
        names.every((tag) => typeof tag === "string" && byTag.has(tag)),
      changeRow = /^(?:C|P)-CHANGE$/.test(requirement.id),
      represented =
        known &&
        names.every((tag) => {
          const object = byTag.get(tag);
          if (changeRow && object.kind === "wire")
            return (
              changedWires.has(object.uid) &&
              (paintedChangeWires ??= new Set(
                schematicSheets(packet).flatMap((sheet) =>
                  sheet.svg ? [...paintedWireUids(sheet.svg)] : [],
                ),
              )).has(object.uid)
            );
          return drawn.has(tag);
        });
    const declaredGap =
      names?.length > 0 && gapExists(evidence?.libraryGap, requirement, types);
    const ownsSubject = (tag, role) => {
      const object = byTag.get(tag),
        type = byType.get(object?.type);
      if (fitsRole(object, type, role)) return true;
      if (!declaredGap) return false;
      if (!object)
        return (
          evidence?.unmodeled === true &&
          evidence.libraryGap.capability === role &&
          typeof tag === "string" &&
          tag.trim().length > 0
        );
      return (
        role === "level-switch" &&
        evidence.libraryGap.capability === role &&
        symbolProfile(type ?? {}) === "thermite:switch"
      );
    };
    const gapSubjects =
      declaredGap &&
      requirement.roles.every((role) =>
        names.some((tag) => ownsSubject(tag, role)),
      ) &&
      names.every((tag) =>
        requirement.roles.some((role) => ownsSubject(tag, role)),
      );
    let pass =
      matches.length === 1 &&
      ["satisfied", "substituted", "deferred"].includes(row?.status) &&
      typeof summary === "string" &&
      summary.trim().length >= 8 &&
      (known || (row?.status === "deferred" && gapSubjects)) &&
      (requirement.id !== "C-CHANGE" ||
        !hasRule(promptVersion, 1) ||
        names.length > 0);
    let deferredJustified = false;
    if (row?.status === "deferred") {
      const diagnosis = typeof evidence === "object" && evidence.diagnostic;
      deferredJustified =
        requirement.obligation === "may" ||
        gapSubjects ||
        !!(
          diagnosis &&
          names?.length > 0 &&
          names.includes(diagnosis.designation) &&
          requirement.roles.some((role) =>
            fitsRole(
              byTag.get(diagnosis.designation),
              byType.get(byTag.get(diagnosis.designation)?.type),
              role,
            ),
          ) &&
          warnings.some(
            (d) =>
              d.code === diagnosis.code &&
              d.designation === diagnosis.designation,
          )
        );
      pass =
        pass &&
        deferredJustified &&
        names.every(
          (tag) => drawn.has(tag) || (!byTag.has(tag) && gapSubjects),
        );
    } else {
      pass =
        pass &&
        represented &&
        (requirement.roles.length === 0 ||
          names.every((tag) =>
            requirement.roles.some((role) =>
              fitsRole(byTag.get(tag), byType.get(byTag.get(tag)?.type), role),
            ),
          )) &&
        requirement.roles.every((role) =>
          names.some((tag) =>
            fitsRole(byTag.get(tag), byType.get(byTag.get(tag)?.type), role),
          ),
        );
      if (requirement.roles.includes("psu"))
        pass =
          pass &&
          !names.some((tag) => {
            const psu = byTag.get(tag);
            return psuInputs(psu).some((terminal) =>
              deferredInput(psu, terminal),
            );
          });
      if (requirement.normalState)
        pass =
          pass &&
          names.some((tag) =>
            Object.values(
              byType.get(byTag.get(tag)?.type)?.functions ?? {},
            ).some(
              (f) =>
                f.kind === "contact" &&
                f.normal_state === requirement.normalState,
            ),
          );
      if (row?.status === "substituted")
        pass = pass && summary.trim().length >= 20;
    }
    const bindings = new Map(
      (names ?? []).map((tag) => [
        tag,
        requirement.roles.filter((role) =>
          row?.status === "deferred"
            ? ownsSubject(tag, role)
            : fitsRole(byTag.get(tag), byType.get(byTag.get(tag)?.type), role),
        ),
      ]),
    );
    return {
      id: requirement.id,
      pass: !!pass,
      row,
      deferredJustified,
      bindings,
    };
  });
  // Only a PLC and its onboard analog-input role may share identities.
  // Check every role pair: another shared role must not hide a mismatch.
  for (let i = 0; i < decisions.length; i++)
    for (let j = i + 1; j < decisions.length; j++) {
      const a = decisions[i],
        b = decisions[j];
      for (const [tag, roles] of a.bindings) {
        const other = b.bindings.get(tag);
        if (
          roles.length &&
          other?.length &&
          roles.some((role) =>
            other.some(
              (otherRole) =>
                role !== otherRole &&
                ![role, otherRole].every((r) =>
                  ["plc", "analog-input"].includes(r),
                ),
            ),
          )
        ) {
          a.pass = false;
          b.pass = false;
        }
      }
    }
  const allDeviceCoverage = sourceObjects
    .filter(
      (o) =>
        o.kind === "device" && !fitsRole(o, byType.get(o.type), "terminal"),
    )
    .every((o) => drawn.has(o.designation));
  const drawnConductors = new Set(
    (packet?.coverage?.conductors ?? [])
      .filter((c) => c.appearances?.length)
      .map((c) => c.designation),
  );
  const psus = sourceObjects.filter((o) =>
    fitsRole(o, byType.get(o.type), "psu"),
  );
  const feedDrawn =
    psus.length > 0 &&
    psus.every((psu) => {
      const inputs = psuInputs(psu);
      const powerView = schematicSheets(packet).some(
        (s) =>
          s.view.family === "power" &&
          s.view.root?.designation === psu.designation,
      );
      return (
        inputs.length > 0 &&
        inputs.every((terminal) => {
          if (deferredInput(psu, terminal)) return true;
          return inputConductors(psu, terminal).some(
            (o) =>
              wireInk.has(o.uid) ||
              drawnConductors.has(o.designation ?? o.uid) ||
              powerView,
          );
        })
      );
    });
  const checks = {
    validation: validationExit === 0,
    viewsAndPacket:
      spec.views.every((name) => files[`drawings/${name}`] === true) &&
      ["html", "json", "pdf"].every(
        (ext) => files[`drawings/packet.${ext}`] === true,
      ) &&
      packet?.sheets?.some((s) => s.view?.kind === "index"),
    guardedChange:
      applies.length > 0 &&
      files["drawings/before.json"] === true &&
      files["drawings/review.json"] === true,
    reports:
      spec.reports.every((kind) => files[`drawings/${kind}.csv`] === true) &&
      files["drawings/diagnostics.json"] === true &&
      files["drawings/cable.json"] === true,
    coverage: allDeviceCoverage && feedDrawn,
    pdfV1V5: drawEvidence
      ? drawEvidence.format === "thermite-agent-draw-evidence/1.0" &&
        drawEvidence.V1 === true &&
        drawEvidence.V5 === true
      : null,
    requirementMatrix:
      rows.length === requirements.length && decisions.every((d) => d.pass),
    counts:
      ["localTypes", "sourceReads", "failedCalls"].every(
        (key) => Number.isInteger(counts?.[key]) && counts[key] >= 0,
      ) &&
      (!hasRule(promptVersion, 0) || counts.attemptedWrites === 0),
  };
  const expectedNames = new Set(
    decisions
      .filter((d) => d.row?.status === "deferred")
      .flatMap((d) => d.row.designations ?? []),
  );
  for (const object of sourceObjects)
    if (
      byType.get(object.type)?.connectionCoverage?.status === "partial" ||
      Object.values(object.connectionReview ?? {}).some((points) =>
        Object.values(points).some((p) => p.status === "deferred"),
      )
    )
      expectedNames.add(object.designation);
  const controllerTags = new Set(
    decisions.flatMap((d) =>
      [...d.bindings]
        .filter(([, roles]) => roles.includes("plc"))
        .map(([tag]) => tag),
    ),
  );
  const separateAnalogTags = new Set(
    decisions.flatMap((d) =>
      [...d.bindings]
        .filter(
          ([tag, roles]) =>
            roles.includes("analog-input") && !controllerTags.has(tag),
        )
        .map(([tag]) => tag),
    ),
  );
  return {
    pass:
      Object.entries(checks)
        .filter(([key]) => key !== "pdfV1V5")
        .every(([, v]) => v === true) && checks.pdfV1V5 !== false,
    checks,
    requirements: decisions.map(({ row, bindings, ...d }) => d),
    pending: [
      ...(checks.pdfV1V5 === null
        ? ["PDF V1/V5 requires E3 or blinded visual judgement"]
        : []),
      ...[...separateAnalogTags].map(
        (tag) =>
          `Separate analog input ${tag}: its link to the controlling PLC is not verified by this checker. Judge the authored integration; no backplane or expansion relation is inferred.`,
      ),
    ],
    counts,
    rubricPending: true,
    expectedWarnings: [...expectedNames]
      .filter((name) => byTag.get(name)?.kind === "device")
      .map((designation) => ({
        anyOf: ["W903", "W904", "W905"].map((code) => ({ code, designation })),
      })),
    actualWarnings: warnings.filter((d) => d.severity === "warning"),
  };
}
export async function checkDogfood(ctx) {
  const safeRead = (path) => {
    try {
      return JSON.parse(deliveredBytes(ctx, path));
    } catch {
      return null;
    }
  };
  const conveyor = ctx.task.id === "D-conveyor";
  const spec = ctx.task.deliverables,
    sourceObjects = objects(ctx.project),
    types = libraryTypes(ctx.project),
    matrix = safeRead("requirement-matrix.json"),
    byTag = new Map(sourceObjects.map((o) => [o.designation, o])),
    byType = new Map(types.map((t) => [t.id, t])),
    clean = cleanChecker(ctx),
    files = {},
    views = new Map();
  const namesFor = (id) =>
    Array.isArray(matrix)
      ? matrix.find(
          (row) => typeof row?.id === "string" && row.id.toUpperCase() === id,
        )?.designations
      : undefined;
  const roleByFile = {
    "motor-power.pdf": ["motor", "power"],
    "ps1-loads.pdf": ["psu", "loads"],
    "contactor-actuation.pdf": ["contactor", "actuation"],
  };
  for (const name of spec.views) {
    const [role, intent] =
      roleByFile[name] ?? roleByFile["contactor-actuation.pdf"];
    const row = spec.requirements.find((r) => r.roles.includes(role));
    const names = namesFor(row?.id);
    const roots = Array.isArray(names)
      ? names.filter((tag) =>
          fitsRole(byTag.get(tag), byType.get(byTag.get(tag)?.type), role),
        )
      : [];
    const fallback = [
      "view",
      roots[0],
      "--" + intent,
      "-o",
      "drawings/" + name,
    ];
    views.set(name, { roots, intent, fallback });
  }
  const cableRow = spec.requirements.find((r) => r.roles[0] === "cable");
  const cableTags = namesFor(cableRow?.id);
  const bundle = conveyor
    ? await regenerateConveyorBundle(
        ctx,
        spec,
        views,
        Array.isArray(cableTags)
          ? cableTags.filter((tag) => byTag.get(tag)?.kind === "cable")
          : [],
      )
    : null;
  const legacy = (path) => !bundle?.artifacts.has(path);
  const formats = ["json", "pdf", "html"].filter((ext) =>
    legacy("drawings/packet." + ext),
  );
  const regenerated = formats.length
    ? await regeneratePacket(ctx, {
        request: conveyorPacketRequest,
        formats,
        bindRequest: conveyor,
      })
    : null;
  const fallbacks = new Map();
  for (const [name, { roots, fallback }] of views) {
    const path = "drawings/" + name;
    if (!legacy(path)) continue;
    files[path] =
      roots.length > 0 &&
      (await regenerateView(ctx, path, fallback, { roots })).pass;
    fallbacks.set(path, fallback);
  }
  for (const ext of formats) {
    const path = "drawings/packet." + ext;
    files[path] = regenerated.matches[ext];
    fallbacks.set(path, ["packet", "--input", conveyorPacketRequest]);
  }
  for (const kind of spec.reports) {
    const path = `drawings/${kind}.csv`;
    if (!legacy(path)) continue;
    const argv = ["report", kind],
      out = join(ctx.evidence, `checker-${kind}.csv`);
    const result = cli(clean, ...argv, "-o", out);
    const delivered = exportFile(ctx, path);
    files[path] =
      result.status === 0 && !!delivered.bytes?.equals(readFileSync(out));
    fallbacks.set(path, argv);
  }
  if (legacy("drawings/diagnostics.json")) {
    const diagnostic = query(clean, "diagnostics", "--json");
    files["drawings/diagnostics.json"] =
      canonical(safeRead("drawings/diagnostics.json")) ===
      canonical(diagnostic);
    fallbacks.set("drawings/diagnostics.json", ["diagnostics"]);
  }
  if (legacy("drawings/cable.json")) {
    const listing = safeRead("drawings/cable.json");
    files["drawings/cable.json"] = cableListingMatches(
      listing,
      sourceObjects,
      (designation) => query(clean, "cable", designation, "--json"),
    );
    if (files["drawings/cable.json"])
      fallbacks.set("drawings/cable.json", ["cable", listing.designation]);
  }
  if (legacy("drawings/review.json")) {
    const argv = ["review", "--before", conveyorBaseline];
    let reviewed = null;
    try {
      reviewed = query(clean, ...argv, "--json");
    } catch {}
    files["drawings/review.json"] =
      !!reviewed &&
      canonical(reviewed) === canonical(safeRead("drawings/review.json"));
    fallbacks.set("drawings/review.json", argv);
  }

  const required = conveyorOutputs(spec);
  const verified = new Map(bundle?.artifacts);
  const verify = (path) => {
    if (!verified.has(path)) {
      const fallback =
        fallbacks.get(path) ??
        views.get(
          path
            .split("/")
            .at(-1)
            .replace(/\.html$/, ".pdf"),
        )?.fallback;
      verified.set(
        path,
        verifyStandaloneExport(ctx, path, {
          matches: files[path],
          fallback,
        }),
      );
    }
    return verified.get(path);
  };
  if (conveyor)
    for (const path of required)
      files[path] = verify(path).status === "current";
  const capture = conveyor ? captureChain(ctx, verify) : null;
  files[conveyorBaseline] = !!safeRead(conveyorBaseline);
  const packet = bundle?.packet ?? regenerated?.packet;
  const counts = {
    localTypes: types.filter((t) => t.library !== "core").length,
    sourceReads: ctx.metrics?.sourceReads ?? 0,
    attemptedWrites: ctx.metrics?.attemptedWrites?.length ?? 0,
    failedCalls: (ctx.calls ?? []).filter(
      (c) => c.phase === "agent" && c.exit !== 0,
    ).length,
  };
  let drawEvidence = existsSync(join(ctx.evidence, "draw-evidence.json"))
    ? read(join(ctx.evidence, "draw-evidence.json"))
    : null;
  if (drawEvidence)
    for (const path of ["drawings/packet.pdf", "drawings/packet.html"]) {
      const { bytes } = exportFile(ctx, path);
      if (!bytes || drawEvidence.files?.[path] !== sha256(bytes))
        drawEvidence = { ...drawEvidence, V1: false, V5: false, stale: true };
    }
  const outcome = assessDogfood({
    task: ctx.task,
    promptVersion: ctx.promptVersion,
    validationExit: cli(clean, "validate", ".").status,
    files,
    packet,
    sourceObjects,
    types,
    calls: ctx.calls ?? [],
    matrix,
    drawEvidence,
    counts,
    diagnostics: ctx.validationDiagnostics ?? [],
  });
  if (!conveyor) return outcome;
  const artifacts = Object.fromEntries(
    required.map((path) => [path, verified.get(path).status]),
  );
  const extras = Object.fromEntries(
    [...(bundle?.artifacts ?? [])]
      .filter(([path]) => !required.includes(path))
      .map(([path, { status }]) => [path, status]),
  );
  const status =
    bundle?.status === "current" || !bundle
      ? (["tampered", "missing", "stale", "unverified"].find((value) =>
          Object.values(artifacts).includes(value),
        ) ?? "current")
      : bundle.status;
  const usedBundle = bundle?.artifacts.size > 0;
  const usedStandalone =
    required.some(legacy) ||
    capture.files.some(({ input }) => input && legacy(input));
  return {
    ...outcome,
    pass: outcome.pass && status === "current",
    exports: {
      route:
        usedBundle && usedStandalone
          ? "mixed"
          : usedBundle || bundle?.status === "invalid-request"
            ? "bundle"
            : "legacy",
      status,
      artifacts,
      ...(Object.keys(extras).length && { extras }),
      ...(bundle && { request: bundle.request, findings: bundle.findings }),
    },
    captureCurrent: capture.status === "current",
    capture,
  };
}
export function referenceDogfood(ctx) {
  prepareDogfoodProject(ctx, { exportDrawings: true });
  return "Reference deliverables are generated. The matrix distinguishes modeled requirements and disclosed substitutions from specific compiler/library gaps. Unfinished hookups and print-size visual checks remain explicit; this is not electrical approval.";
}

// Export tests supply their own delivery commands from the same source,
// packet request, and review baseline as the scripted reference.
export function prepareDogfoodProject(ctx, { exportDrawings = false } = {}) {
  const pump = ctx.task.id === "D-pump",
    prefix = pump ? "P" : "C",
    base = structuredClone(
      read(new URL("./fixtures/motor-starter.json", import.meta.url)),
    );
  const existing = new Set(objects(ctx.project).map((o) => o.designation));
  const added = base.objects.filter(
    (o) =>
      !existing.has(o.designation) &&
      !["W-PWR-014", "W-PWR-015"].includes(o.designation),
  );
  for (const object of added) {
    if (object.properties) {
      delete object.properties.size;
      delete object.properties.color;
    }
    if (object.kind === "cable")
      for (const core of object.conductors)
        core.usage = core.id === "2-" ? "spare" : "in-use";
  }
  if (!pump) {
    for (const object of added) {
      if (object.designation === "LS1") {
        object.designation = "PX1";
        object.type = "core:prox-pnp-3wire";
        object.description =
          "Generic PNP discharge sensor; physical selected-part pinout remains for review";
      }
      for (const endpoint of object.endpoints ?? [])
        if (endpoint?.device === "LS1") {
          endpoint.device = "PX1";
          endpoint.terminal = endpoint.terminal === "13" ? "1" : "4";
        }
      if (typeof object.description === "string")
        object.description = object.description.replaceAll("LS1", "PX1");
      if (object.properties?.label)
        object.properties.label = object.properties.label.replaceAll(
          "LS1",
          "PX1",
        );
    }
    added.push(wire("W-PX1-RETURN", ep("PX1", "3"), ep("JB1", "X1.3")));
  }
  added.push(
    device("START1", "core:limit-switch-2wire", {
      description:
        "Proposed NO start contact represented by the shipped generic limit-switch contact, a disclosed functional substitution; actuator/part selection requires review",
    }),
    wire("W-START-FEED", ep("PS1", "+"), ep("START1", "13")),
    wire("W-START-INPUT", ep("START1", "14"), ep("PLC1", "X1.1")),
  );
  if (!pump) {
    const noButton = structuredClone(
      libraryTypes(ctx.project).find((t) => t.id === "core:limit-switch-2wire"),
    );
    delete noButton.library;
    noButton.id = "eval:start-button-no";
    noButton.symbol = "thermite:pushbutton";
    noButton.description =
      "Generic NO start pushbutton function using shipped generic contact terminal keys; selected-part physical pinout and actuator remain unverified.";
    added.find((o) => o.designation === "START1").type = noButton.id;
    added.find((o) => o.designation === "START1").description =
      noButton.description;
    write(join(ctx.project, "libraries/eval/library.json"), {
      name: "eval",
      version: "0.1.0",
      sources: ["types.json"],
    });
    write(join(ctx.project, "libraries/eval/types.json"), {
      types: [noButton],
    });
    const localManifest = read(join(ctx.project, "system.json"));
    localManifest.libraries.push({
      name: "eval",
      version: "0.1.0",
      path: "libraries/eval",
    });
    write(join(ctx.project, "system.json"), localManifest);
    ok(ctx, "lock", ".");
  } else {
    added.find((o) => o.designation === "START1").type = "core:pushbutton-no";
    added.find((o) => o.designation === "START1").description =
      "Generic NO start pushbutton; selected hardware and ratings remain unverified.";
    const level = added.find((o) => o.designation === "LS1");
    level.type = "core:level-switch-no";
    level.description =
      "Generic NO level contact; actuation level, process meaning and selected hardware remain unspecified.";
    const cable = added.find((o) => o.designation === "CBL1");
    cable.description =
      "Pressure transmitter interface cable; both second-pair cores are explicit terminated spares.";
    for (const core of cable.conductors)
      core.usage = core.id.startsWith("2") ? "spare" : "in-use";
    // Preserve two separate passive signal nets, following core's unpowered RM3
    // interface example. Do not invent AI mode, current shunts or loop power.
    const feed = added.find((o) => o.designation === "W-FLD-001");
    feed.endpoints = [ep("TB1", "3"), ep("PLC1", "AI0-")];
    feed.properties.label = "PRESSURE-AI0-";
    const positive = added.find((o) => o.designation === "W-FLD-002");
    positive.endpoints = [ep("JB1", "X1.1"), ep("PT1", "+")];
    positive.properties.label = "PRESSURE-LOOP+";
    const negative = added.find((o) => o.designation === "W-FLD-003");
    negative.endpoints = [ep("PT1", "-"), ep("JB1", "X1.2")];
    negative.properties.label = "PRESSURE-LOOP-";
    const remove = new Set(["JP1", "W-CTL-003", "W-CTL-004"]);
    for (let i = added.length - 1; i >= 0; i--)
      if (remove.has(added[i].designation)) added.splice(i, 1);
    for (const object of added)
      for (const endpoint of object.endpoints ?? [])
        if (endpoint?.device === "PLC1")
          endpoint.terminal =
            { "X1.0": "DI0", "X1.1": "DI1", "X2.0": "DO0" }[
              endpoint.terminal
            ] ?? endpoint.terminal;
    added.push(
      device("PT1", "core:transmitter-2wire-4-20ma", {
        description:
          "Brief's pressure measurement role, using the generic two-wire 4-20 mA interface; range, supply and compatibility not selected.",
        connectionReview: {
          terminals: {
            "+": {
              status: "deferred",
              reason:
                "Unpowered generic loop interface: select loop power, PLC AI mode and hardware compatibility before service; no electrical performance is asserted.",
            },
          },
        },
      }),
      wire("W-FLD-AI+", ep("TB1", "2"), ep("PLC1", "AI0+")),
      wire("W-LEVEL-FEED", ep("PS1", "+"), ep("LS1", "13")),
      wire("W-LEVEL-INPUT", ep("LS1", "14"), ep("PLC1", "DI0")),
    );
  }
  const stop = added.find((o) => o.designation === "PB1");
  if (!pump)
    stop.connectionReview = {
      terminals: {
        11: {
          status: "deferred",
          reason:
            "Stop remains in the coil chain. Separate PLC monitoring is unfinished: the installed compact PLC has only two DI, occupied by the discharge sensor and start contact. Select/review a larger PLC before adding the third input.",
        },
      },
    };
  addSource(ctx, "reference-machine.json", added);
  if (pump) {
    replaceObject(ctx, "PLC1", "type", "core:plc-8di-8do-2ai");
    addSource(ctx, "hmi-network.json", [
      device("HMI1", "core:hmi"),
      wire("W-HMI-SUPPLY", ep("PS1", "+"), ep("HMI1", "L+")),
      wire("W-HMI-RETURN", ep("PS1", "-"), ep("HMI1", "M")),
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
  }
  if (exportDrawings) ok(ctx, "validate", ".");
  const writePacketRequest = () => {
    const fields = objects(ctx.project)
      .filter(
        (o) =>
          ["wire", "jumper"].includes(o.kind) &&
          /W-FLD|JP1|W-PX1/.test(o.designation),
      )
      .map((o) => o.designation);
    const views = [
      view("M1", "power"),
      view("K1", "control"),
      pump
        ? {
            format: "circuit-view-request/0.1",
            title: "PS1 DC distribution",
            groups: [
              ["PLC1", ["W-CTL-001", "W-CTL-002"]],
              ["HMI1", ["W-HMI-SUPPLY", "W-HMI-RETURN"]],
            ].map(([designation, conductors]) => ({
              id: designation.toLowerCase(),
              label: `Generic supply to ${designation}; verify selected hardware ratings`,
              functions: [
                {
                  device: { by: "designation", value: "PS1" },
                  key: "dc_output",
                },
                {
                  device: { by: "designation", value: designation },
                  key: "supply",
                },
              ],
              conductors,
            })),
          }
        : view("PS1", "loads"),
      view("CBL1", "conductors"),
      {
        format: "wiring-view-request/0.1",
        title: "Field hookup and terminal points",
        conductors: fields,
      },
      {
        format: "wiring-view-request/0.1",
        title: "Proposed start contact to PLC input",
        conductors: ["W-START-FEED", "W-START-INPUT"],
      },
      ...(pump
        ? [
            {
              format: "wiring-view-request/0.1",
              title: "Level contact to PLC input",
              conductors: ["W-LEVEL-FEED", "W-LEVEL-INPUT"],
            },
            {
              format: "signal-loop-view-request/0.1",
              from: { device: "PT1", function: "signal" },
              to: { device: "PLC1", function: "ai0" },
              notes: [
                "Unpowered generic interface; select loop power, AI mode and compatible hardware before service.",
              ],
            },
            { format: "communication-view-request/0.1", medium: "ethernet" },
          ]
        : []),
      ...ctx.task.deliverables.reports.map(docView),
    ];
    write(join(ctx.project, "packet.request.json"), {
      format: "schematic-packet-request/0.1",
      index: true,
      views,
    });
  };
  const emitOutputs = () => {
    ok(ctx, "view", "M1", "--power", "-o", "drawings/motor-power.pdf");
    ok(
      ctx,
      "view",
      "K1",
      "--actuation",
      "-o",
      "drawings/contactor-actuation.pdf",
    );
    if (!pump)
      ok(ctx, "view", "PS1", "--loads", "-o", "drawings/ps1-loads.pdf");
    writePacketRequest();
    for (const ext of ["json", "html", "pdf"])
      ok(
        ctx,
        "packet",
        "--input",
        "packet.request.json",
        "-o",
        `drawings/packet.${ext}`,
      );
    for (const kind of ctx.task.deliverables.reports)
      ok(ctx, "report", kind, "-o", `drawings/${kind}.csv`);
    write(
      join(ctx.project, "drawings/diagnostics.json"),
      query(ctx, "diagnostics", "--json"),
    );
    write(
      join(ctx.project, "drawings/cable.json"),
      query(ctx, "cable", "CBL1", "--json"),
    );
  };
  const emitReview = () =>
    write(
      join(ctx.project, "drawings/review.json"),
      query(ctx, "review", "--before", "drawings/before.json", "--json"),
    );
  // Exercise the brief's order: produce, guarded change, then regenerate.
  if (exportDrawings) emitOutputs();
  ok(ctx, "snapshot", "-o", "drawings/before.json");
  replaceObject(
    ctx,
    "M1",
    "description",
    pump
      ? "5 HP pump motor requirement; generic 480 VAC model, selected-part protection and nameplate review unfinished"
      : "2 HP 480 V conveyor motor requirement; generic model, selected-part protection and nameplate review unfinished",
  );
  if (exportDrawings) emitReview();
  replaceObject(ctx, "W-START-INPUT", "properties", {
    ...locate(ctx.project, "W-START-INPUT").object.properties,
    label: "START-INPUT-REVIEWED",
  });
  if (exportDrawings) {
    emitReview();
    emitOutputs();
  } else writePacketRequest();
  const mapping = {
    SUPPLY: ["SRC1"],
    BREAKER: ["CB1"],
    STARTER: ["K1", "OL1"],
    MOTOR: ["M1"],
    PSU: ["PS1"],
    PLC: ["PLC1"],
    TERMINALS: ["TB1"],
    CABLE: ["CBL1"],
    START: ["START1"],
    STOP: ["PB1"],
    COIL: pump ? ["PLC1", "K1"] : ["PLC1", "K1", "OL1"],
    LEVEL: ["LS1"],
    TRANSMITTER: ["PT1"],
    ANALOG: ["PLC1"],
    NETWORK: ["PLC1", "HMI1"],
    SENSOR: ["PX1"],
    JUNCTION: ["JB1"],
    SPARE: ["CBL1"],
    CHANGE: ["M1"],
  };
  const matrix = ctx.task.deliverables.requirements.map((requirement) => {
    const key = requirement.id.slice(2),
      names = mapping[key] ?? [];
    if (key === "PSU")
      return {
        id: requirement.id,
        status: "deferred",
        designations: ["PS1"],
        evidence: {
          summary:
            "PS1 DC loads are drawn; its AC input feed is not designed. Input rating and branch protection require reviewed engineering facts, so no 480 V feed is wired.",
          diagnostic: { code: "W905", designation: "PS1" },
        },
      };
    if (!pump && key === "STOP")
      return {
        id: requirement.id,
        status: "deferred",
        designations: names,
        evidence: {
          summary:
            "The NC stop is drawn in the coil chain. Monitoring it as a third PLC input is unfinished because the two shipped DI are occupied. Choose a reviewed larger PLC; W905 preserves this unfinished work.",
          diagnostic: { code: "W905", designation: "PB1" },
        },
      };
    if (key === "INDICATOR")
      return {
        id: requirement.id,
        status: "deferred",
        designations: [],
        evidence: {
          summary:
            "The brief makes the indicator conditional. It is omitted from this reference; no selected lamp or stack-light hardware and ratings are asserted.",
        },
      };
    return {
      id: requirement.id,
      status: "satisfied",
      designations: names,
      evidence: {
        summary:
          pump && key === "ANALOG"
            ? "PT1 is wired through the field cable and terminal strip to PLC1.AI0+/AI0-. The same PLC provides the digital control and HMI link. Loop power, input mode, ratings and hardware compatibility remain unselected."
            : pump && key === "START"
              ? "START1 uses the shipped generic NO pushbutton; no selected-part certification is asserted."
              : key === "START"
                ? "The local generic NO pushbutton uses the required catalog profile and the shipped generic contact shape. Manufacturer selection and physical pinout remain unverified; no selected-part certification is asserted."
                : ["FRICTION", "VISUAL", "GUIDE"].includes(key)
                  ? "See friction.md for observed output-generation results and the explicit pending visual inspection. This is not a visual-quality pass."
                  : `Validated source and regenerated packet show ${names.join(", ") || "the requested deliverables"}. See drawings/ and the guarded snapshot/review requests; no manufacturer certification is asserted.`,
      },
    };
  });
  write(join(ctx.project, "requirement-matrix.json"), matrix);
  if (!exportDrawings) return;
  write(
    join(ctx.project, "friction.md"),
    `Reference uses shipped generic models, not manufacturer-verified equipment. Wire gauge/color claims from the synthetic base were removed. ${pump ? "Core 0.2.0 supplies the transmitter, analog-input PLC, level switch, NO start button and HMI. PT1 is drawn through JB1, CBL1 and TB1 into PLC1.AI0+/AI0-. PLC1 also drives the contactor and links to the HMI; there is no separate analog controller or invented backplane. The two-wire interface is unpowered, following the shipped RM3 interface example: loop power, AI mode, compatibility, range and physical hardware still require engineering selection. PLC1 and HMI1 DC supply magnitudes and interface ratings remain unspecified by their generic types; no compatibility certification is asserted. Level reference condition and actuation meaning are unspecified." : "PNP wiring follows the shipped generic 1/3/4 model through JB1, CBL1 and TB1; physical selected-part review remains. The third PLC input for stop monitoring is deferred with W905. Conditional indicator is omitted, rather than claimed unavailable in core."} ${pump ? "The pump uses shipped core types without authoring local types." : "The generic NO pushbutton local type copies the shipped contact shape and declares the required profile; physical part selection is unverified."} All generated outputs succeeded without recovery calls. Tool-call and failure counts are in the run score. PS1 input is intentionally unwired: the starter feed is not designed, its input rating and branch protection are unverified (W905). Visual inspection of at least two outputs and PDF V1/V5 remain pending independent judgement.\n`,
  );
  if (pump) {
    const bytes = readFileSync(join(ctx.project, "AGENTS.md")).length;
    write(join(ctx.project, "guide-observation.json"), {
      bytes,
      needed:
        "Scripted reference: no model context; guide policy is implemented by the reference helpers, not claimed as an agent read.",
    });
  }
}
