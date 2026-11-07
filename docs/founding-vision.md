# Founding Vision

This document records the product direction, including aspirations beyond the
implemented compiler and rendering features. See the [README](../README.md) and
[format reference](formats-and-compatibility.md) for current capabilities and limits.

## Thesis

Electrical documentation should describe the **system**, not a predetermined set of drawing pages.

The project will create a structured, version-controlled electrical system description from which schematics and other engineering views can be generated on demand.

A drawing is therefore not the source artifact. It is a projection of the source artifact.

## The problem with drawing-first documentation

Conventional electrical CAD is optimized around creating and maintaining drawings. Even when teams use the same CAD package and symbol libraries, the usefulness of the final package depends on what the drafting engineer chose to show and how they chose to organize it.

This creates a fundamental information problem: future users can only inspect views that someone created in the past.

A technician may need to know:

- everything that can prevent a contactor from energizing;
- every field device feeding one PLC input module;
- all conductors in a particular cable;
- every load supplied by one 24 VDC power supply;
- the full path between a sensor and the PLC;
- every component affected by a damaged cable;
- spare conductors reaching a junction box;
- all safety-related elements capable of stopping one motor.

Traditional documentation answers these questions well only when the original drawing package happened to be organized around them.

The proposed system does not require the original designer to predict those future questions.

## The new source of truth

The committed source describes engineering facts:

- which objects exist;
- which reusable component types they instantiate;
- which terminals those components expose;
- which physical conductors connect which terminals;
- which conductors belong to cables;
- which functional relationships exist between objects;
- what electrical and engineering properties apply;
- what rules and library versions were used to validate the model.

From those facts, software builds a normalized graph that can be queried and rendered in many ways.

## Product experience

The ideal user does not spend most of their time manipulating drawing primitives.

An engineer may work conversationally:

> Add a 2 HP, 480 VAC three-phase conveyor motor controlled by the PLC, with a local disconnect and overload protection.

The agent translates the request into explicit source changes. The compiler validates those changes. The engineer reviews a semantic diff and any warnings or errors.

Later, a technician can ask:

> Show me everything that can keep K1 from energizing.

The system traverses the graph, chooses the relevant objects, builds an appropriate control-circuit view, and renders it.

The agent is an interface to the model, not the authority over it.

## Core principles

### 1. Model first

Electrical truth lives in structured data. Drawings, tables, PDFs, and UI views are derived artifacts.

### 2. Author facts once

The same connection or component property should not need to be independently maintained on several pages.

### 3. Any useful view should be generatable

The system should not require the designer to predict every future diagnostic or documentation perspective.

### 4. Correctness is deterministic

LLMs may create, modify, search, and explain the model, but schema validation, reference resolution, topology checks, and engineering rules are conventional deterministic software.

### 5. Git is a first-class workflow

The source should support meaningful diffs, review, rollback, branching, CI, and reproducible builds.

A change should look conceptually like “connect overload auxiliary contact to PLC input 14,” not “move line segment 47.”

### 6. Human names are not identity

Reference designations are essential to engineering communication, but they are mutable. Stable internal identity lets the system preserve history and cross-references when `K1` becomes `K101`.

### 7. Logical topology and physical geometry are different concerns

Electrical connectivity should not contain schematic page coordinates. Panel, enclosure, DIN-rail, routing, and 3D information can be modeled separately and linked by stable object identity.

### 8. Interoperability over isolation

Where established standards provide useful semantics, identifiers, or presentation rules, the system should map to them rather than inventing unnecessary alternatives.

## What this is not

This is not initially:

- a replacement visual CAD editor;
- a database-first digital twin platform;
- an AI that guesses whether a circuit is safe;
- a full NEC, UL, NFPA, or IEC compliance engine;
- a panel-layout or wire-routing product;
- a requirement that every engineering organization adopt one drawing style by hand.

Those may become adjacent capabilities. They are not required to prove the central idea.

## Why the generated-view model matters

A saved schematic can still exist. A commissioning package can still be frozen to PDF. A service manual can still reference a stable figure.

The important distinction is that these are **outputs**.

A saved view may be expressed as a deterministic query plus presentation options. A rendered output may be cached by a content hash. Neither acquires authority over the underlying electrical model.

This means changing one connection updates every future view automatically.

## The long-term opportunity

Once a trustworthy system model exists, schematic generation is only one application.

The same graph can support:

- troubleshooting assistance;
- BOM generation;
- PLC I/O lists;
- wire and cable schedules;
- terminal plans;
- design-rule checking;
- change-impact analysis;
- commissioning/test generation;
- cross-discipline digital-twin integration;
- component substitution analysis;
- automated design assistance;
- maintenance history linked to stable component identity.

The enduring asset is not the renderer. It is the structured electrical system model and the tools that can reason deterministically over it.

## Founding product test

The idea is proven when one moderately complex source model can generate several useful, substantially different schematics on demand without any manually authored schematic sheets.

For example, from one motor-control system:

1. generate the three-phase M1 power circuit;
2. generate everything that can prevent K1 from energizing;
3. generate LS1 through its PLC input, including field power;
4. generate every conductor in CBL1;
5. generate every device supplied by PS1;
6. change LS1 to a three-wire PNP sensor and regenerate all affected views.

If those outputs are readable, deterministic, and correctly reflect the same source model, the core thesis is working.
