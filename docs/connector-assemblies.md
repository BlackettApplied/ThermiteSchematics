# Connector and cable assemblies

Connector assemblies describe molded cordsets, direct mating connections and protective caps between named device connectors. They are separate from communication links and electrical conductors. Use them when a drawing identifies an assembly but omits its internal pin wiring.

An assembly reserves one port at each end. It never creates wires, cable cores, terminal jumps, net membership or a powered-device assertion. Required electrical terminals remain unconnected until explicit electrical conductor source connects them, even when a library pin table identifies those terminals behind an occupied connector.

## Library ports

Add named ports to the component type:

```json
{
  "connectorPorts": {
    "X1": {
      "connector": "M12 A-coded female, 5-pin",
      "description": "Pressure input",
      "pins": {
        "1": { "terminal": "L+", "description": "24 V supply" },
        "3": { "terminal": "M", "description": "Return" }
      }
    }
  }
}
```

The enclosing type still declares its authoritative `terminals` and `functions`. `pins` is optional; omit unknown pin information. An informational pin's `terminal`, when present, must reference an existing type terminal. Multiple pins may explicitly reference the same physical terminal. Pin metadata never infers cable mapping, jumps or electrical continuity.

`connector` is authored descriptive text; it is not an automatic compatibility check. Existing `ports` remains the communication namespace. A type cannot reuse a key in both namespaces. Do not create aliases that make one physical connector appear as two independently occupiable ports.

A connector-only cap or Y splitter can have empty terminal/function dictionaries and real named connector ports. A splitter's branches are separate ports; no internal wiring is inferred.

## Project assemblies

Create an ordinary relation with a stable UID/designation:

```json
{
  "uid": "42000000-0000-4000-8000-000000000011",
  "kind": "relation",
  "designation": "CBL-PRESSURE",
  "relation": "associated_with",
  "from": { "device": "RACK1" },
  "to": { "device": "PT1" },
  "assembly": {
    "kind": "cable",
    "fromPort": "X1",
    "toPort": "M12",
    "status": "documented",
    "cable": { "specification": "M12 molded cordset", "lengthM": 2 },
    "pinMapping": {
      "status": "unresolved",
      "reason": "Source identifies the cordset but omits its pin mapping."
    }
  }
}
```

The relation UID/designation is the cable or assembly identity. Cable metadata requires `specification` and optionally accepts `manufacturer`, `orderNumber`, `lengthM` and `route`. Omit unknown facts. Relation `description` can retain source labels. Optional `status` accepts `documented`, `planned` or `verified`; it describes the assembly record, not electrical suitability or pin verification.

- `kind: "cable"` requires cable metadata and unresolved pin mapping.
- `kind: "direct"` has no cable metadata and keeps pin mapping unresolved.
- `kind: "cap"` connects to a real protective-cap device, has no cable metadata and requires `pinMapping.status: "not-applicable"` with a reason.

Assemblies connect different devices using existing connector ports, one assembly per port. A relation cannot also declare `connection`. Invalid occupancy, pin references or assembly combinations report E207. Reusing a port for both cable and cap fails. Separate cables at distinct ports of an explicit splitter are supported.

Device instances may use `connectionReview.connectorPorts` with the existing `required`, `intentionally-unused` and `deferred` dispositions. Occupied connectors report assembly-level connection and mapping status; their electrical terminals are checked independently. Unoccupied connectors are not inferred spare.

## Views, schedules and source identity

Add an assembly view to a normal packet:

```json
{
  "format": "connector-assembly-view-request/0.1",
  "title": "Top rack field cordsets",
  "devices": ["RACK1"],
  "assemblies": ["CBL-PRESSURE"],
  "notes": ["Source sheet 07; conductor mapping remains unresolved."]
}
```

Selectors are exact unique device or relation designations/UIDs:

- No selectors: all assemblies and declared connector devices.
- `devices` alone: their incident assemblies and endpoint devices; all ports on explicitly selected devices remain visible.
- `assemblies` alone: exactly those assemblies and their endpoints; other endpoint ports are summarized as a count pointing to the schedule.
- Both: `assemblies` remains the exact link set; `devices` additionally includes the named devices and all their ports. Link selection is not intersected with device selection.

An occupied port whose assembly is omitted is labeled `outside view`; a port with no assembly is labeled `unoccupied`. Disconnected selected devices remain visible. Selection does not invent caps or automatically traverse a splitter's other branches.

ELK places blocks, ports and paths. Visible labels preserve device names/descriptions, connector names, cable specifications, authored assembly lifecycle status and mapping status. Notes and the assembly schedule retain mapping explanations. Paths represent complete assemblies and have no electrical junction dots. Independent assemblies may cross with a visual gap, but coincident segments are rejected because they could imply a false cable branch.

Text begins at 2.7 mm, with a 2.5 mm minimum after limited sheet fit. Bounds and overlaps are checked. Oversized views fail explicitly; select fewer assemblies or larger paper. Page count is secondary to readable source coverage.

Run `node thermite.mjs report assemblies --project <project> -o output/assemblies.csv` for a schedule, or add `{ "format": "documentation-view-request/0.1", "kind": "assemblies" }` to a packet. Cable assemblies also appear in the BOM; caps/splitters are counted as device instances. Communication reports exclude assemblies. Electrical wire/cable-core schedules remain reserved for modeled conductors.

The query API `buildConnectorAssemblyInventory(ir)` returns `connector-assembly-inventory/0.1` with `assemblies` and `ports`. Device inspection includes `connectorPorts`; relation and incident-relation inspection includes `assembly`.

SVG audit attributes are `data-connector-assembly` (relation UID), `data-assembly-designation`, `data-assembly-endpoints` (`[{deviceUid,portKey}, ...]`), `data-pin-mapping`, `data-device-uid`, `data-connector-port` and `data-port-occupancy`. Generated SVG remains an artifact, never electrical source.

This version has no resolved assembly-to-conductor mapping. Manufacturer pin tables cannot supply an installed cordset's missing wiring. Explicit electrical wire/cable-core source remains necessary where verified evidence exists. Connector compatibility, safety suitability, ratings, shielding and installation correctness are not inferred.
