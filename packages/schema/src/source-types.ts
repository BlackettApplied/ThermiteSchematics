import type {
  Cable,
  CableType,
  Device,
  Jumper,
  Potential,
  Relation,
  ValidatedDeviceType,
  Wire,
} from "./generated/index.js";

export type ProjectObject =
  Cable | Device | Jumper | Potential | Relation | Wire;

export type LibraryType = CableType | ValidatedDeviceType;
