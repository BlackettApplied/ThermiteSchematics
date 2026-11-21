import type {
  PresentationGraph,
  LocationGroup,
  DeviceGroup,
} from "../types.js";
import type { IrDevice } from "@thermite/compiler";
import {
  invariant,
  deviceGroupId,
  locationIdentity,
  locationGroupId,
} from "./util.js";
import { compareLocationIdentity } from "../ordering.js";

export function validateDeviceGroups(
  graph: Readonly<PresentationGraph>,
  deviceByUid: Map<string, IrDevice>,
  locationById: Map<string, LocationGroup>,
) {
  const deviceGroupByUid = new Map<string, DeviceGroup>();
  const deviceGroupById = new Map<string, DeviceGroup>();
  for (const group of graph.deviceGroups) {
    invariant(
      !deviceGroupById.has(group.id),
      `${group.id} unique device group`,
    );
    deviceGroupById.set(group.id, group);
    deviceGroupByUid.set(group.deviceUid, group);
    const device = deviceByUid.get(group.deviceUid);
    invariant(device !== undefined, `${group.id} exact device`);
    invariant(
      group.id === deviceGroupId(device.uid),
      `${group.id} tagged device ID`,
    );
    invariant(
      group.designation === device.designation,
      `${group.id} designation`,
    );
    invariant(group.typeId === device.typeId, `${group.id} type`);
    invariant(group.label.role === "device", `${group.id} device label`);
    const parent = locationById.get(group.parentId);
    invariant(parent !== undefined, `${group.id} location parent`);
    invariant(
      JSON.stringify(parent.identity) ===
        JSON.stringify(locationIdentity(device)),
      `${group.id} exact authored/virtual location`,
    );
  }
  return deviceGroupById;
}

export function validateLocations(graph: Readonly<PresentationGraph>) {
  const locationById = new Map<string, LocationGroup>();
  for (const group of graph.locationGroups) {
    invariant(!locationById.has(group.id), `${group.id} unique location`);
    locationById.set(group.id, group);
    invariant(group.parentId === "root", `${group.id} root parent`);
    invariant(group.label.role === "location", `${group.id} location label`);
    invariant(
      group.id === locationGroupId(group.identity),
      `${group.id} tagged location identity`,
    );
  }
  const sortedLocations = [...graph.locationGroups].sort((left, right) =>
    compareLocationIdentity(left.identity, right.identity),
  );
  invariant(
    JSON.stringify(graph.locationGroups) === JSON.stringify(sortedLocations),
    "location order",
  );
  return locationById;
}
