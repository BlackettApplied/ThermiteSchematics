import type { ElectricalIr } from "@thermite/compiler";

/** Exact source selectors. Include dimensions intersect; exclusions take precedence. */
export interface DeviceFilter {
  readonly devices?: readonly string[];
  readonly excludeDevices?: readonly string[];
  readonly types?: readonly string[];
  readonly excludeTypes?: readonly string[];
  readonly locations?: readonly string[];
  readonly excludeLocations?: readonly string[];
}
export interface DeviceFilterSelection {
  readonly filter: DeviceFilter;
  readonly deviceUids: readonly string[];
  readonly outsideDeviceUids: readonly string[];
}
export function resolveDeviceFilter(
  ir: Readonly<ElectricalIr>,
  value: DeviceFilter,
): DeviceFilterSelection {
  const keys = [
    "devices",
    "excludeDevices",
    "types",
    "excludeTypes",
    "locations",
    "excludeLocations",
  ] as const;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.keys(value).length ||
    Object.keys(value).some(
      (k) => !keys.includes(k as (typeof keys)[number]),
    ) ||
    keys.some(
      (k) =>
        Object.hasOwn(value, k) &&
        (!Array.isArray(value[k]) ||
          !value[k]!.length ||
          value[k]!.length > 1000 ||
          value[k]!.some((s) => typeof s !== "string" || !s.trim()) ||
          new Set(value[k]).size !== value[k]!.length),
    )
  )
    throw new Error(
      "Invalid device filter. Use nonempty unique arrays of exact devices, types or locations and their exclusions.",
    );
  const resolveDevices = (items: readonly string[] | undefined) => {
    if (!items) return undefined;
    const ids = items.map((name) => {
      const matches = ir.devices.filter(
        (d) => d.uid === name || d.designation === name,
      );
      if (matches.length !== 1)
        throw new Error(
          `Filter device ${JSON.stringify(name)} does not resolve uniquely.`,
        );
      return matches[0]!.uid;
    });
    if (new Set(ids).size !== ids.length)
      throw new Error(
        "Device filter repeats a device through different selectors.",
      );
    return new Set(ids);
  };
  const devices = resolveDevices(value.devices),
    excluded = resolveDevices(value.excludeDevices);
  for (const name of [...(value.types ?? []), ...(value.excludeTypes ?? [])])
    if (!ir.deviceTypes.some((t) => t.id === name))
      throw new Error(`Filter type ${JSON.stringify(name)} does not exist.`);
  for (const name of [
    ...(value.locations ?? []),
    ...(value.excludeLocations ?? []),
  ])
    if (!ir.devices.some((d) => d.location === name))
      throw new Error(
        `Filter location ${JSON.stringify(name)} does not exist.`,
      );
  const selected = ir.devices.filter(
    (d) =>
      (!devices || devices.has(d.uid)) &&
      (!value.types || value.types.includes(d.typeId)) &&
      (!value.locations ||
        (d.location !== undefined && value.locations.includes(d.location))) &&
      !excluded?.has(d.uid) &&
      !value.excludeTypes?.includes(d.typeId) &&
      !(
        d.location !== undefined && value.excludeLocations?.includes(d.location)
      ),
  );
  const set = new Set(selected.map((d) => d.uid));
  return {
    filter: structuredClone(value),
    deviceUids: [...set].sort(),
    outsideDeviceUids: ir.devices
      .filter((d) => !set.has(d.uid))
      .map((d) => d.uid)
      .sort(),
  };
}
