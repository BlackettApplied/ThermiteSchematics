import type {
  PresentationContext,
  SymbolRepresentation,
  PresentationGroups,
} from "./model.js";
import type { IrDevice } from "@thermite/compiler";
import type { LocationIdentity, LocationGroup } from "../types.js";
import {
  locationIdentity,
  locationGroupId,
  required,
  deviceGroupId,
  presentationLabel,
  textSource,
} from "./util.js";
import {
  PRESENTATION_CLASS_RANK,
  compareText,
  compareLocationIdentity,
} from "../ordering.js";

export function buildGroups(
  _context: PresentationContext,
  representations: readonly SymbolRepresentation[],
): PresentationGroups {
  const devices = new Map<string, IrDevice>();
  for (const representation of representations)
    devices.set(representation.device.uid, representation.device);
  const devicesByLocation = new Map<string, IrDevice[]>();
  const identityById = new Map<string, LocationIdentity>();
  for (const device of devices.values()) {
    const identity = locationIdentity(device);
    const id = locationGroupId(identity);
    identityById.set(id, identity);
    devicesByLocation.set(id, [...(devicesByLocation.get(id) ?? []), device]);
  }
  const locationGroups = buildLocationGroups(devicesByLocation, identityById);
  const locationById = new Map(
    locationGroups.map((group) => [group.id, group]),
  );
  const locationByDeviceUid = new Map<string, LocationGroup>();
  for (const device of devices.values()) {
    locationByDeviceUid.set(
      device.uid,
      required(
        locationById.get(locationGroupId(locationIdentity(device))),
        `Location group for ${device.uid} is missing.`,
      ),
    );
  }
  const deviceGroups = buildDeviceGroups(
    representations,
    devices,
    locationByDeviceUid,
  );
  return {
    locationGroups,
    deviceGroups,
    locationByDeviceUid,
    deviceByUid: new Map(deviceGroups.map((group) => [group.deviceUid, group])),
  };
}

function buildDeviceGroups(
  representations: readonly SymbolRepresentation[],
  devices: Map<string, IrDevice>,
  locationByDeviceUid: Map<string, LocationGroup>,
) {
  const flowRankByDeviceUid = new Map<string, number>();
  for (const representation of representations) {
    const classRank =
      PRESENTATION_CLASS_RANK[representation.rule.classification];
    flowRankByDeviceUid.set(
      representation.device.uid,
      Math.min(
        flowRankByDeviceUid.get(representation.device.uid) ??
          Number.MAX_SAFE_INTEGER,
        classRank,
      ),
    );
  }
  const deviceGroups = [...devices.values()]
    .sort(
      (left, right) =>
        (flowRankByDeviceUid.get(left.uid) ?? Number.MAX_SAFE_INTEGER) -
          (flowRankByDeviceUid.get(right.uid) ?? Number.MAX_SAFE_INTEGER) ||
        compareText(left.designation, right.designation),
    )
    .map((device) => {
      const id = deviceGroupId(device.uid);
      const parent = required(
        locationByDeviceUid.get(device.uid),
        `Device ${device.uid} has no location group.`,
      );
      return {
        id,
        parentId: parent.id,
        deviceUid: device.uid,
        designation: device.designation,
        typeId: device.typeId,
        label: presentationLabel("device", id, "device", device.designation, [
          textSource(
            "device",
            [device.uid],
            "device.designation",
            device.designation,
          ),
        ]),
      };
    });
  return deviceGroups;
}

function buildLocationGroups(
  devicesByLocation: Map<string, IrDevice[]>,
  identityById: Map<string, LocationIdentity>,
) {
  const locationGroups = [...devicesByLocation].map(([id, locationDevices]) => {
    const identity = required(
      identityById.get(id),
      `Location identity ${id} is missing.`,
    );
    const sortedDevices = [...locationDevices].sort((left, right) =>
      compareText(left.designation, right.designation),
    );
    const textSources =
      identity[0] === "virtual"
        ? []
        : [
            textSource(
              "device",
              [(sortedDevices[0] as IrDevice).uid],
              "device.location",
              identity[1],
            ),
          ];
    return {
      id,
      parentId: "root" as const,
      identity,
      label: presentationLabel(
        "location",
        id,
        "location",
        identity[1],
        textSources,
      ),
    };
  });
  locationGroups.sort((left, right) =>
    compareLocationIdentity(left.identity, right.identity),
  );
  return locationGroups;
}
