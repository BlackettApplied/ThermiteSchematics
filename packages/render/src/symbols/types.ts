export type SymbolSide = "west" | "north" | "east" | "south";

export type SymbolStyle =
  "body" | "operator" | "actuator" | "terminal" | "annotation";

export interface SymbolPoint {
  readonly x: number;
  readonly y: number;
}

export interface SymbolPortDefinition {
  readonly id: string;
  readonly side: SymbolSide;
  readonly offset: number;
  readonly order: number;
}

export type SymbolPrimitive =
  | {
      readonly kind: "line";
      readonly from: SymbolPoint;
      readonly to: SymbolPoint;
      readonly style: SymbolStyle;
    }
  | {
      readonly kind: "polyline";
      readonly points: readonly SymbolPoint[];
      readonly style: SymbolStyle;
    }
  | {
      readonly kind: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly radius?: number;
      readonly style: SymbolStyle;
    }
  | {
      readonly kind: "circle";
      readonly center: SymbolPoint;
      readonly radius: number;
      readonly style: SymbolStyle;
    }
  | {
      readonly kind: "arc";
      readonly from: SymbolPoint;
      readonly to: SymbolPoint;
      readonly radiusX: number;
      readonly radiusY: number;
      readonly clockwise: boolean;
      readonly style: SymbolStyle;
    };

export interface SymbolDefinition {
  readonly format: "ais-symbol/0.1";
  readonly id: `ais:${string}`;
  readonly size: { readonly width: number; readonly height: number };
  readonly ports: readonly SymbolPortDefinition[];
  readonly primitives: readonly SymbolPrimitive[];
}

export interface SymbolPortBinding {
  readonly portId: string;
  readonly terminalKey: string;
}

export type SymbolOrientation = "left-to-right" | "top-to-bottom";

export const SYMBOL_SIDES = Object.freeze([
  "west",
  "north",
  "east",
  "south",
] as const satisfies readonly SymbolSide[]);

export const SYMBOL_STYLES = Object.freeze([
  "body",
  "operator",
  "actuator",
  "terminal",
  "annotation",
] as const satisfies readonly SymbolStyle[]);
