import type {
  ElectricalIr,
  IrDevice,
  IrDeviceType,
  TerminalId,
} from "@thermite/compiler";
import type {
  buildCableSchedule,
  EndpointSheetZones,
} from "../cable-schedule.js";
import type { DeviceFilter } from "../device-filter.js";
export interface DocumentationRow {
  key: string;
  cells: string[];
  deviceUids: string[];
}
export interface DocumentationContext<T> {
  ir: Readonly<ElectricalIr>;
  request: { readonly device?: string; readonly filter?: DeviceFilter };
  selection: ReadonlySet<string> | undefined;
  references:
    | {
        readonly conductors?: ReadonlyMap<string, EndpointSheetZones>;
        readonly cableCores?: ReadonlyMap<
          string,
          ReadonlyMap<string, EndpointSheetZones>
        >;
      }
    | undefined;
  options: { readonly output?: "print" | "csv" } | undefined;
  devices: Map<string, IrDevice>;
  types: Map<string, IrDeviceType>;
  incident: (uids: readonly string[]) => boolean;
  label: (t: TerminalId) => string;
  nets: Map<string, string>;
  netMembers: Map<string, readonly TerminalId[]>;
  connections: Map<string, { conductor: string; peer: TerminalId | null }[]>;
  cables: ReturnType<typeof buildCableSchedule>[];
  orderedDevices: IrDevice[];
  selected: IrDevice[];
  typeDescription: (description: string | undefined, typeId: string) => string;
  typeNote: () => string;
  rows: DocumentationRow[];
  table: (
    title: string,
    columns: string[],
    widths: number[],
    notes: string[],
  ) => T;
  compare: (a: string, b: string) => number;
  compareDesignation: (a: string, b: string) => number;
  tid: (t: TerminalId) => string;
  reportText: (value: string) => string;
  reportDescription: (value: string | undefined) => string | undefined;
}
