# v0.1 Implementation Plan

## Objective

Prove the core thesis with the smallest credible implementation:

> One text-based electrical system model can be validated and used to generate several useful schematic views on demand without manually authored schematic sheets.

The first milestone is not a production ECAD replacement. It is an architectural proof.

## Recommended stack

- **Language:** TypeScript
- **Runtime:** Node.js
- **Source:** JSON
- **Schema:** JSON Schema, with generated/shared TypeScript types as convenient
- **Layout:** ELK via `elkjs`
- **Rendering:** direct SVG generation
- **Interface:** CLI first
- **Source control:** Git
- **Tests:** fixture-driven compiler and snapshot/semantic renderer tests

The browser can become a UI later without replacing the core compiler.

## Repository skeleton

```text
/
  README.md
  docs/
    FOUNDING_VISION.md
    ARCHITECTURE.md
    DATA_MODEL.md
    SCHEMATIC_RENDERING.md
    V0_1_PLAN.md

  packages/
    schema/
    compiler/
    graph/
    rules/
    query/
    symbols/
    layout/
    renderer/
    cli/

  examples/
    motor-starter/

  library/
    core/
```

The package boundaries may initially live in fewer workspace packages if that makes iteration faster.

## Reference system

Build one representative industrial example containing approximately:

- 480 VAC three-phase source;
- branch protection;
- contactor K1;
- overload OL1;
- motor M1;
- 24 VDC power supply PS1;
- PLC with at least one DI and one DO;
- stop/permissive contact chain;
- field limit/proximity switch LS1;
- terminal block;
- one multi-conductor cable;
- at least one jumper/shared 24 VDC distribution point.

The example should deliberately exercise the distinction between conductors, cables, derived nets, device-internal functional relationships, and view-specific flow.

## Milestone 1 — Source + schema

Implement JSON schemas for:

- project manifest;
- device instance;
- device type;
- wire;
- cable;
- jumper;
- relation;
- potential declaration.

Create the core component types required by the reference system.

Success criterion: malformed objects fail with useful source locations and messages.

## Milestone 2 — Compiler + IR

Implement:

- project loading;
- library loading;
- stable identity handling;
- type expansion;
- terminal resolution;
- endpoint resolution;
- reverse indexes;
- cable conductor expansion;
- derived electrical nets;
- declared-potential propagation.

Success criterion: the reference project compiles into a normalized inspectable graph.

## Milestone 3 — Rules

Implement only high-value deterministic checks:

- unknown device/terminal/type;
- missing conductor endpoint;
- invalid cable conductor;
- conflicting potential declarations on one derived net;
- simple AC/DC and voltage-class incompatibility;
- duplicate/exclusive assignment checks where unambiguous.

Success criterion: intentionally broken fixtures fail for the expected reason and rule ID.

## Milestone 4 — Query primitives

Implement:

```text
thermite inspect <designation>
thermite neighbors <designation>
thermite trace <designation>
thermite net <designation.terminal>
thermite cable <designation>
```

Queries should operate on the IR, not grep source files directly.

Success criterion: the tool can answer topology questions without rendering.

## Milestone 5 — Symbols + layout + SVG

Implement the minimal symbol set and a presentation transform for two initial view families:

1. control/logic path;
2. power path.

Adapt the view model to ELK with fixed symbol port sides/order and orthogonal routing. Render the resulting geometry to SVG.

Success criterion: readable deterministic diagrams with no manual coordinates in project source.

Implementation status: complete. M5 provides the versioned in-process
`SchematicViewRequest` seam and `thermite render <designation> --family control|power`,
with reviewed deterministic K1 control and M1 power SVG goldens from the unchanged
motor-starter model. Milestone 6 completes the five higher-level `thermite view`
demonstrations and LS1 source-edit experiment below.

## Milestone 6 — Demonstration queries

Support commands or equivalent structured calls for:

```text
thermite view M1 --power
thermite view K1 --actuation
thermite view LS1 --to PLC1 --include-power
thermite view CBL1 --conductors
thermite view PS1 --loads
```

All five must render from the same project model.

Then modify LS1 from a two-wire switch to a three-wire PNP sensor and demonstrate that validation and every relevant generated view change from the source edit alone.

Implementation status: complete. All five commands render from one fresh successful
in-memory IR of the unchanged canonical project. The isolated ordinary-directory PNP
experiment proves the invalid type-only intermediate state and the clean completed
source edit, with M1 byte-identical and every semantically affected view updated.
Reviewed semantic/SVG/CLI goldens, exemption-free collision validation in both flows,
packed API/command smoke, and the Windows/Ubuntu portability matrix cover the final
`render/0.2`, `ais-symbols/0.3`, and
`elk-layered/0.4+elkjs-0.12.0` contract.

## Milestone 7 — Agent integration

Only after the deterministic core works, expose a narrow tool API suitable for an agent:

- resolve/search objects;
- inspect object;
- execute graph query;
- validate project;
- create view from structured specification;
- apply proposed source patch.

The agent should consume compiler diagnostics rather than reproduce engineering checks itself.

Implementation status: complete. The stateless `@thermite/agent-tools` package
and JSON-only `thermite agent` namespace expose the six planned operations over fresh
compiler/query/render execution, including integrity-guarded source-patch staging and
per-file atomic replacement. Determinism, installed-package behavior, product
goldens, and Windows/Ubuntu portability are covered by the Milestone 7 acceptance
suite; MCP remains only a possible later adapter over the typed toolbox.

## Test strategy

### Compiler tests

Small fixture projects for each semantic rule and edge case.

### Graph tests

Assert exact derived net membership and traversal results.

### Renderer tests

Do not rely exclusively on pixel snapshots. Test semantic invariants such as:

- expected objects included;
- expected terminal-to-edge attachments;
- no accidental graphical crossing treated as connectivity;
- stable ordering for fixed input;
- valid SVG.

Use image/snapshot comparison as an additional regression layer once the visual style stabilizes.

### Golden example

Keep the motor-starter project as a reviewed golden model and generated-view test case.

## Deferred deliberately

Do not let these block v0.1:

- visual drag-and-drop authoring;
- real-time collaboration;
- database-backed source of truth;
- panel geometry;
- 3D layout;
- wire routing/duct fill;
- full regulatory/code-compliance validation;
- comprehensive manufacturer library;
- import/export from major ECAD formats;
- perfect automatic layout for arbitrary plant-scale systems;
- fine-grained view-cache invalidation.

## First decision checkpoints

Implementation should answer these questions quickly:

1. Is the proposed source model pleasant to author and diff?
2. Does deriving nets from two-ended conductive elements handle the reference system cleanly?
3. Can component types carry enough semantic knowledge without becoming unwieldy?
4. Can ELK respect electrical port constraints well enough after semantic preprocessing?
5. Which presentation rules must be ours rather than delegated to generic layout?
6. Can the same model create multiple views that are actually better for troubleshooting than a fixed drawing package?

If the answer to #6 is yes, continue outward from the compiler/model rather than building a traditional drawing editor around it.
