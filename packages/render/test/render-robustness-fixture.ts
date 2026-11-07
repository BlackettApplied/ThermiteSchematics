import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileProject } from "@thermite/compiler";

export const byDesignation = (value: string) => ({
  by: "designation" as const,
  value,
});

/** Recompile source, including nets and indexes, after each identity assignment. */
export async function robustnessFixture() {
  const root = await mkdtemp(join(tmpdir(), "thermite-render-robustness-"));
  await cp(resolve("packages/cli/templates/starter-default"), root, {
    recursive: true,
  });
  const read = async (file: string) =>
    JSON.parse(await readFile(join(root, file), "utf8"));
  const equipment = await read("devices/equipment.json");
  const wires = await read("connections/control-power.json");
  const potentials = await read("potentials/potentials.json");
  return {
    root,
    close: () => rm(root, { recursive: true, force: true }),
    async compile(
      variant:
        | "minimal"
        | "plant"
        | "actuation"
        | "two_psu"
        | "tb_loads"
        | "coil_fork"
        | "parallel"
        | "unnamed_jumpers"
        | "plc3"
        | "plc4"
        | "daisy"
        | "pnp"
        | "loads_via_k2"
        | "trace_via_k2"
        | "power_via_k2",
      seed?: number,
      options: {
        returnVia?: string;
        plc2Designation?: string;
        plc2Location?: string;
        noPotentials?: boolean;
        duplicatePotentials?: boolean;
        reverseAuthoredOrder?: boolean;
      } = {},
    ) {
      const returnVia = options.returnVia ?? "PLC1.M";
      const eq = structuredClone(equipment),
        w = structuredClone(wires),
        p = structuredClone(potentials);
      const uuid = (key: string) => {
        const h = createHash("sha256").update(`${seed}:${key}`).digest("hex");
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
      };
      const device = (
        designation: string,
        type: string,
        uid = uuid(designation),
      ) => ({ uid, kind: "device", designation, type: `core:${type}` });
      const wire = (
        designation: string,
        a: string,
        b: string,
        uid = uuid(designation),
      ) => ({
        uid,
        kind: "wire",
        designation,
        endpoints: [a, b].map((v) => {
          const dot = v.indexOf(".");
          return { device: v.slice(0, dot), terminal: v.slice(dot + 1) };
        }),
      });
      if (variant === "actuation") {
        eq.objects.push(
          device(
            "K1",
            "contactor-3p-1no",
            "2f1d8c4a-6b7e-4f0a-9c3d-1a2b3c4d5e01",
          ),
        );
        w.objects.push(
          wire(
            "W-K1-1",
            "PLC1.X2.0",
            "K1.A1",
            "2f1d8c4a-6b7e-4f0a-9c3d-1a2b3c4d5e02",
          ),
          wire(
            "W-K1-2",
            "K1.A2",
            returnVia,
            "2f1d8c4a-6b7e-4f0a-9c3d-1a2b3c4d5e03",
          ),
        );
        if (returnVia === "K2.A2" || returnVia === "TB1.1") {
          eq.objects.push(
            device(
              returnVia.split(".")[0]!,
              returnVia === "K2.A2" ? "contactor-3p-1no" : "terminal-block-8",
            ),
          );
          w.objects.push(wire("W-VIA", returnVia, "PS1.-"));
        }
      } else if (variant === "minimal" || variant === "plant") {
        eq.objects.push(
          device("PLC2", "plc-compact", "add5aa10-cef8-4b63-94c6-a69511867702"),
        );
        w.objects.push(
          wire(
            "W-PLC2-1",
            "PS1.+",
            "PLC2.L+",
            "66a38e78-10a6-48fc-af0e-a444e1281a52",
          ),
          wire(
            "W-PLC2-2",
            "PS1.-",
            "PLC2.M",
            "7407ac4a-5beb-42f8-b639-a70d8123d462",
          ),
        );
      } else {
        const D = (name: string, type: string) =>
          eq.objects.push(device(name, type));
        let next = 0;
        const W = (a: string, b: string) =>
          w.objects.push(wire(`W-X-${++next}`, a, b));
        const feed = (name: string) => {
          W("PS1.+", `${name}.L+`);
          W("PS1.-", `${name}.M`);
        };
        switch (variant) {
          case "unnamed_jumpers":
            D("PLC2", "plc-compact");
            for (const [i, a, b] of [
              [0, "PS1.+", "PLC2.L+"],
              [1, "PS1.+", "PLC2.L+"],
              [2, "PS1.-", "PLC2.M"],
            ] as const) {
              const jumper = wire(`JP-${i}`, a, b);
              w.objects.push({
                uid: jumper.uid,
                kind: "jumper",
                endpoints: jumper.endpoints,
              });
            }
            break;
          case "parallel":
            D("B1", "prox-pnp-3wire");
            D("TB1", "terminal-block-8");
            W("B1.4", "TB1.1");
            W("B1.4", "TB1.1");
            W("TB1.1", "PLC1.X1.0");
            W("PS1.+", "B1.1");
            W("PS1.-", "B1.3");
            break;
          case "two_psu":
            D("PLC2", "plc-compact");
            feed("PLC2");
            D("PS2", "psu-24vdc");
            for (const name of ["PLC3", "PLC4"]) {
              D(name, "plc-compact");
              W("PS2.+", `${name}.L+`);
              W("PS2.-", `${name}.M`);
            }
            break;
          case "tb_loads":
            D("PLC2", "plc-compact");
            D("TB1", "terminal-block-8");
            W("PS1.+", "TB1.1");
            W("TB1.1", "PLC2.L+");
            W("PS1.-", "TB1.2");
            W("TB1.2", "PLC2.M");
            break;
          case "coil_fork":
            for (const [name, type] of [
              ["S1", "pushbutton-nc"],
              ["LS1", "limit-switch-2wire"],
              ["TB1", "terminal-block-8"],
              ["K1", "contactor-3p-1no"],
              ["K2", "contactor-3p-1no"],
            ])
              D(name!, type!);
            for (const [a, b] of [
              ["PS1.+", "TB1.1"],
              ["TB1.1", "S1.11"],
              ["TB1.1", "LS1.13"],
              ["S1.12", "K1.A1"],
              ["LS1.14", "K2.A1"],
              ["K1.A2", "TB1.2"],
              ["K2.A2", "TB1.2"],
              ["TB1.2", "PS1.-"],
            ])
              W(a!, b!);
            break;
          case "plc3":
          case "plc4":
            for (const name of variant === "plc3"
              ? ["PLC2", "PLC3"]
              : ["PLC2", "PLC3", "PLC4"]) {
              D(name, "plc-compact");
              feed(name);
            }
            break;
          case "daisy":
            D("PLC2", "plc-compact");
            W("PLC1.L+", "PLC2.L+");
            W("PLC1.M", "PLC2.M");
            break;
          case "pnp":
            D("B1", "prox-pnp-3wire");
            D("PLC2", "plc-compact");
            W("PS1.+", "B1.1");
            W("PS1.-", "B1.3");
            feed("PLC2");
            W("B1.4", "PLC1.X1.0");
            break;
          case "loads_via_k2":
            D("K2", "contactor-3p-1no");
            D("PLC2", "plc-compact");
            W("PS1.+", "PLC2.L+");
            W("PS1.-", "K2.A2");
            W("K2.A2", "PLC2.M");
            break;
          case "trace_via_k2":
            D("K2", "contactor-3p-1no");
            D("LS1", "limit-switch-2wire");
            W("PS1.+", "K2.A1");
            W("K2.A1", "LS1.13");
            W("LS1.14", "PLC1.X1.0");
            break;
          case "power_via_k2":
            D("SRC1", "supply-480v-3ph");
            D("M1", "motor-3ph");
            D("K2", "contactor-3p-1no");
            for (const [a, b] of [
              ["SRC1.L1", "M1.U"],
              ["SRC1.L2", "M1.V"],
              ["SRC1.L3", "M1.W"],
              ["SRC1.PE", "K2.A1"],
              ["K2.A1", "M1.PE"],
            ])
              W(a!, b!);
            break;
        }
      }
      if (variant === "plant") {
        delete eq.objects[0].connectionReview;
        eq.objects[1].io = {
          addressSpace: "PLC1",
          channels: {
            di0: { address: "%I0.0", signal: "Start", usage: "in-use" },
            di1: { usage: "spare" },
          },
        };
        Object.assign(eq.objects[2], {
          io: {
            addressSpace: "PLC2",
            channels: {
              di0: { address: "%IB0" },
              di1: { address: "%I0.0" },
              do0: { address: "%IW0" },
              do1: { address: "NOT-AN-ADDRESS" },
            },
          },
        });
        for (const [name, type] of [
          ["SRC1", "supply-480v-3ph"],
          ["M1", "motor-3ph"],
          ["K1", "contactor-3p-1no"],
          ["LS1", "limit-switch-2wire"],
          ["S1", "pushbutton-nc"],
        ])
          eq.objects.push(device(name!, type!));
        const ends = [
          ["SRC1.L1", "M1.U"],
          ["SRC1.L2", "M1.V"],
          ["SRC1.L3", "M1.W"],
          ["SRC1.PE", "M1.PE"],
          ["PLC1.X2.0", "K1.A1"],
          ["K1.A2", "PS1.-"],
          ["PS1.+", "LS1.13"],
          ["LS1.14", "PLC1.X1.0"],
          ["PS1.+", "S1.11"],
          ["S1.12", "PLC2.X1.0"],
          ["SRC1.L1", "PS1.L"],
          ["SRC1.L2", "PS1.N"],
        ];
        ends.forEach(([a, b], i) =>
          w.objects.push(wire(`W-GEN-${i + 1}`, a!, b!)),
        );
      }
      if (variant === "minimal" || variant === "plant") {
        const plc = eq.objects.find(
          (o: { designation: string }) => o.designation === "PLC2",
        );
        if (options.plc2Location !== undefined)
          plc.location = options.plc2Location;
        if (options.plc2Designation !== undefined) {
          plc.designation = options.plc2Designation;
          for (const wire of w.objects)
            for (const ep of wire.endpoints)
              if (ep.device === "PLC2") ep.device = options.plc2Designation;
        }
      }
      if (options.noPotentials) p.objects = [];
      if (options.duplicatePotentials)
        p.objects.push(
          ...p.objects.map((o: { uid: string }, i: number) => ({
            ...o,
            uid: uuid(`duplicate-${o.uid}`),
            designation: `P-DUP-${i}`,
          })),
        );
      if (options.reverseAuthoredOrder)
        for (const source of [eq, w, p]) source.objects.reverse();
      if (seed !== undefined)
        for (const source of [eq, w, p])
          for (const o of source.objects)
            o.uid = uuid(o.designation ?? o.name ?? o.uid);
      for (const [file, value] of [
        ["devices/equipment.json", eq],
        ["connections/control-power.json", w],
        ["potentials/potentials.json", p],
      ] as const)
        await writeFile(join(root, file), JSON.stringify(value));
      const compiled = await compileProject(root);
      if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
      return compiled;
    },
  };
}
