import type { ElectricalIr } from "@thermite/compiler";
import type { DocumentationTable, resolveDeviceFilter } from "@thermite/query";
import type {
  Draft,
  SchematicPacketRequest,
  ReferenceSelection,
} from "./types.js";
import { sheetLabel } from "./page.js";

/** Indexes describe content drafts only; appending index pages must happen later. */
export function referenceTables(
  ir: Readonly<ElectricalIr>,
  drafts: readonly Pick<Draft, "view" | "references" | "documentationTable">[],
  request: Pick<SchematicPacketRequest, "references">,
  referenceDevices: ReturnType<typeof resolveDeviceFilter> | undefined,
): {
  tables: DocumentationTable[];
  referenceSelection: ReferenceSelection | undefined;
} {
  let referenceSelection: ReferenceSelection | undefined;
  const indexTable: DocumentationTable = {
    kind: "index",
    title: "Drawing index",
    columns: ["Sheet", "View", "Devices"],
    widths: [0.08, 0.42, 0.5],
    notes: [
      "Index covers the generated content sheets. References point to this packet revision.",
      ...(request.references === false
        ? [
            "Device/function reference index omitted by request; content sheets remain indexed.",
          ]
        : []),
    ],
    rows: drafts.map((d, i) => ({
      key: String(i + 1),
      cells: [
        String(i + 1),
        sheetLabel(d.view),
        [...new Set(d.references?.map((r) => r.designation) ?? [])].join(", "),
      ],
      deviceUids: [...new Set(d.references?.map((r) => r.deviceUid) ?? [])],
    })),
  };
  const groups = new Map<
    string,
    {
      designation: string;
      functions: string;
      locations: string[];
      uid: string;
    }
  >();
  const retainedGroups: typeof groups = new Map();
  const selectedReferenceDevices = new Set(
    referenceDevices?.deviceUids ?? ir.devices.map((d) => d.uid),
  );
  drafts.forEach((d, i) =>
    d.references?.forEach((r) => {
      const key = JSON.stringify([r.deviceUid, r.functions]);
      const g = groups.get(key) ?? {
        designation: r.designation,
        functions: r.functions.join(", ") || "Terminal / schedule",
        locations: [],
        uid: r.deviceUid,
      };
      g.locations.push(`${i + 1} / ${r.zone}`);
      groups.set(key, g);
      if (
        request.references !== false &&
        selectedReferenceDevices.has(r.deviceUid) &&
        !(
          request.references?.appearances === "drawings" && d.documentationTable
        )
      ) {
        const retained = retainedGroups.get(key) ?? {
          ...g,
          functions:
            request.references?.appearances === "drawings" &&
            !r.functions.length
              ? "Device / terminal / port"
              : g.functions,
          locations: [],
        };
        retained.locations.push(`${i + 1} / ${r.zone}`);
        retainedGroups.set(key, retained);
      }
    }),
  );
  if (request.references !== undefined)
    referenceSelection = {
      format: "reference-selection/0.1",
      enabled: request.references !== false,
      appearances:
        request.references === false
          ? "all"
          : (request.references.appearances ?? "all"),
      ...(referenceDevices ? { filter: referenceDevices.filter } : {}),
      deviceUids:
        referenceDevices?.deviceUids ?? ir.devices.map((d) => d.uid).sort(),
      outsideDeviceUids: referenceDevices?.outsideDeviceUids ?? [],
      totalGroups: groups.size,
      retainedGroups: retainedGroups.size,
      omittedGroupKeys: [...groups.keys()].filter(
        (k) => !retainedGroups.has(k),
      ),
    };
  const refTable: DocumentationTable = {
    kind: "references",
    title: "Device and function references",
    columns: ["Device", "Function / representation", "Sheet / zone"],
    widths: [0.2, 0.35, 0.45],
    notes: [
      request.references && request.references.appearances === "drawings"
        ? "Repeated functions represent the same physical device. References include diagram appearances only."
        : "Repeated functions represent the same physical device. References include schedule appearances.",
      ...(referenceSelection
        ? [
            `Filtered reference index: ${retainedGroups.size} of ${groups.size} device/function groups retained. Content sheets and continuation references are unchanged.`,
          ]
        : []),
    ],
    rows: [...retainedGroups]
      .sort(([, a], [, b]) =>
        a.designation < b.designation
          ? -1
          : a.designation > b.designation
            ? 1
            : 0,
      )
      .map(([key, g]) => ({
        key,
        cells: [
          g.designation,
          g.functions,
          [...new Set(g.locations)].join("; "),
        ],
        deviceUids: [g.uid],
      })),
  };
  return {
    tables:
      request.references === false ? [indexTable] : [indexTable, refTable],
    referenceSelection,
  };
}
