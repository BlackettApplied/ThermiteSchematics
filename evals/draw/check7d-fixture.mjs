import { rootedFixture } from "./check7b-fixture.mjs";

const terminal = (deviceUid, terminalKey) => ({ deviceUid, terminalKey });
const phases = ["U", "V", "W"];
function wire(ir, uid, a, b) {
  ir.wires.push({ uid, endpoints: [{ terminal: a }, { terminal: b }] });
}
function replaceSupplyEnds(ir, device, pin) {
  for (const w of ir.wires)
    for (const e of w.endpoints)
      if (e.terminal.deviceUid === "S")
        e.terminal = terminal(device, pin(Number(e.terminal.terminalKey[1])));
}

export function busFixture(loop = false) {
  const x = rootedFixture(),
    { ir } = x;
  ir.devices.push(
    { ...ir.devices[0], uid: "D2", designation: "OL2" },
    { uid: "Q0", designation: "Q0", typeId: "main-breaker" },
    { uid: "M2", designation: "M2", typeId: "load" },
  );
  const other = ir.functions
    .filter((f) => f.id.deviceUid === "D")
    .map((f) => ({
      ...f,
      id: { ...f.id, deviceUid: "D2" },
      terminals: f.terminals.map((t) => terminal("D2", t.terminalKey)),
    }));
  const breaker = { id: "main-breaker", terminals: [], circuitSymbols: {} };
  ir.deviceTypes.push(breaker);
  ir.functions.push(...other, {
    id: { deviceUid: "M2", functionKey: "load" },
    kind: "load",
    terminals: phases.map((p) => terminal("M2", p)),
  });
  replaceSupplyEnds(ir, "Q0", (n) => `out${n}`);
  for (const [i, phase] of phases.entries()) {
    const n = i + 1,
      input = terminal("Q0", `in${n}`),
      bus = terminal("Q0", `out${n}`),
      functionKey = `q${n}`,
      pole = other.find((f) => f.id.functionKey === `pole${n}`);
    breaker.circuitSymbols[functionKey] = "breaker";
    ir.functions.push({
      id: { deviceUid: "Q0", functionKey },
      kind: "contact",
      normal_state: "closed",
      terminals: [input, bus],
    });
    wire(ir, `supply-${n}`, terminal("S", `L${n}`), input);
    wire(ir, `branch-${n}`, bus, pole.terminals[0]);
    wire(
      ir,
      `branch-end-${n}`,
      pole.terminals[1],
      loop ? bus : terminal("M2", phase),
    );
  }
  return x;
}

export function addSecondSupply(ir, bypass) {
  const terminals = phases.map((_, i) => terminal("S2", `L${i + 1}`));
  ir.devices.push({ uid: "S2", designation: "SUPPLY2", typeId: "source" });
  ir.functions.push({
    id: { deviceUid: "S2", functionKey: "supply" },
    kind: "source",
    terminals,
  });
  for (const [i, t] of terminals.entries()) {
    const pole = ir.functions.find(
      (f) => f.id.deviceUid === "D" && f.id.functionKey === `pole${i + 1}`,
    );
    wire(ir, `second-supply-${i}`, t, pole.terminals[bypass ? 1 : 0]);
  }
}

export function addUntraversableStage(ir, kind, keepProtection) {
  const inputs = phases.map((_, i) => terminal("stage", `in${i + 1}`)),
    outputs = phases.map((_, i) => terminal("stage", `out${i + 1}`));
  ir.devices.push({ uid: "stage", designation: "T1", typeId: kind });
  ir.deviceTypes.push({
    id: kind,
    ...(kind === "transformer" ? { symbol: "thermite:transformer" } : {}),
    terminals: [...inputs, ...outputs].map((t, i) => ({
      key: t.terminalKey,
      role:
        kind === "transformer"
          ? i < 3
            ? "primary"
            : "secondary"
          : i < 3
            ? "power_input"
            : "power_output",
    })),
  });
  ir.functions.push(
    {
      id: { deviceUid: "stage", functionKey: "input" },
      kind: "load",
      terminals: inputs,
    },
    {
      id: { deviceUid: "stage", functionKey: "output" },
      kind: "other",
      terminals: outputs,
    },
  );
  if (keepProtection) replaceSupplyEnds(ir, "stage", (n) => `out${n}`);
  else {
    ir.wires = ir.wires.filter((w) =>
      w.endpoints.every((e) => e.terminal.deviceUid !== "D"),
    );
    for (const [i, phase] of phases.entries())
      wire(ir, `stage-load-${i}`, outputs[i], terminal("M", phase));
  }
  for (const [i, input] of inputs.entries())
    wire(ir, `stage-input-${i}`, terminal("S", `L${i + 1}`), input);
}
