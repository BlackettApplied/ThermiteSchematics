/** Independent measured repeat audit. */
export interface RepeatAudit {
  findings: { sheet: number; kind: string; [key: string]: unknown }[];
  measurements: { sheet: number; [key: string]: unknown }[];
  appearanceCount: number;
  repeatCount: number;
}
/** Native full appearances reconciled with printed mirror/return ink. */
export interface MirrorReturnRecord {
  uid: string;
  functionKey: string;
  kind: string;
  sheet: number;
  view: number | string;
  assessment: string;
  findings: { kind: string; sheet: number; [key: string]: unknown }[];
  measurements: { [key: string]: unknown }[];
}
export interface MirrorReturnAudit {
  records: readonly MirrorReturnRecord[];
  coilAppearances: readonly MirrorReturnRecord[];
  contactAppearances: readonly MirrorReturnRecord[];
  findings: readonly { kind: string; sheet: number; [key: string]: unknown }[];
  extra: readonly { kind: string; sheet: number; [key: string]: unknown }[];
}
