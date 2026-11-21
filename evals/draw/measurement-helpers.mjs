import * as group0 from "./measurement/runtime.mjs";
import * as group1 from "./measurement/text-metrics.mjs";
import * as group2 from "./measurement/text-layout.mjs";
import * as group3 from "./measurement/text-fields.mjs";
import * as group4 from "./measurement/landings.mjs";
import * as group5 from "./measurement/paint.mjs";
import * as group6 from "./measurement/facts.mjs";
import { geometry as group7 } from "./measurement/geometry.mjs";
import * as group8 from "./measurement/terminals.mjs";
import * as group9 from "./measurement/reports.mjs";
import * as group10 from "./measurement/outline.mjs";
import { cableCaptionMarks } from "./measurement/cable-caption-marks.mjs";
import * as faceStrokes from "./measurement/face-strokes.mjs";
import * as preparation from "./measurement/prepare.mjs";
import * as tranche3 from "./measurement/tranche3.mjs";
import * as tranche4 from "./measurement/tranche4.mjs";
import * as wirePlates from "./measurement/wire-plates.mjs";
import * as terminalLabels from "./measurement/terminal-label-clearance.mjs";
import * as circuitMarks from "./measurement/circuit-marks.mjs";
import { IdentifierMeasurementError } from "./identifier-errors.mjs";
export const measurementHelpers = Object.freeze({
  IdentifierMeasurementError,
  cableCaptionMarks,
  ...faceStrokes,
  ...wirePlates,
  ...terminalLabels,
  ...circuitMarks,
  terminalLabelClearanceMm: 0.5,
  ...preparation,
  ...tranche3,
  ...tranche4,
  ...group0,
  ...group1,
  ...group2,
  ...group3,
  ...group4,
  ...group5,
  ...group6,
  ...group7,
  ...group8,
  ...group9,
  ...group10,
  bindings: {
    ownedLandings: {
      parameters: ["e", "endpoints", "clip"],
      dependencies: [
        "h",
        "all",
        "attr",
        "elementsById",
        "ids",
        "ownerKey",
        "point",
        "terminalCaptionOwners",
      ],
    },
    tagLayer: {
      parameters: ["e"],
      dependencies: [
        "colour",
        "fillPaint",
        "orders",
        "shapeClips",
        "sx",
        "sy",
        "textPaintRows",
        "visible",
        "h",
      ],
    },
    point: { parameters: ["x", "y"], dependencies: ["rr", "sx", "sy"] },
    screenBox: { parameters: ["r"], dependencies: ["rr", "sx", "sy"] },
    bounds: { parameters: ["e", "box"], dependencies: ["point"] },
    intersect: { parameters: ["a", "b"], dependencies: [] },
    visible: {
      parameters: ["e", "keepHidden"],
      dependencies: ["bounds", "intersect", "point", "root", "vb"],
    },
    attr: { parameters: ["e", "name"], dependencies: [] },
    tagIdentity: { parameters: ["e"], dependencies: ["attr", "ids"] },
    ancestors: { parameters: ["e"], dependencies: ["root"] },
    documentIdentity: { parameters: ["e"], dependencies: ["attr", "ids"] },
    identity: {
      parameters: ["e"],
      dependencies: ["ancestors", "attr", "ids", "documentIdentity"],
    },
    terminalDescriptionOwner: { parameters: ["e", "uid"], dependencies: [] },
    reportRuns: {
      parameters: ["e", "rendered", "matrix"],
      dependencies: ["bounds", "continuationOwner", "point", "h"],
    },
    shapeClips: { parameters: ["e"], dependencies: ["point", "root"] },
    routeShape: {
      parameters: ["e"],
      dependencies: [
        "attr",
        "identity",
        "ownerKey",
        "point",
        "rr",
        "shapeClips",
        "sx",
        "sy",
        "visible",
      ],
    },
    ownerKey: { parameters: ["raw", "prefix"], dependencies: [] },
    landingOwners: {
      parameters: ["e", "endpoints"],
      dependencies: ["attr", "ids", "ownerKey", "terminalCaptionOwners"],
    },
    omittedNetLabels: {
      parameters: [],
      dependencies: [
        "bounds",
        "identity",
        "intersect",
        "ownerKey",
        "root",
        "visible",
      ],
    },
    continuationOwner: { parameters: ["e"], dependencies: [] },
    continuationInfo: {
      parameters: ["e"],
      dependencies: ["continuationOwner", "point"],
    },
    tableRectangles: { parameters: ["parent"], dependencies: [] },
    close: { parameters: ["a", "b"], dependencies: [] },
    reportContains: { parameters: ["a", "b"], dependencies: [] },
    stackedTopology: {
      parameters: ["parent"],
      dependencies: ["bounds", "close", "tableRectangles", "visible"],
    },
    reportTextPainted: { parameters: ["e"], dependencies: ["visible"] },
    paintedCellText: {
      parameters: ["parent", "cell"],
      dependencies: [
        "ids",
        "measuredReportText",
        "reportContains",
        "reportTextPainted",
      ],
    },
    stackedReportCells: {
      parameters: ["parent"],
      dependencies: [
        "all",
        "bounds",
        "close",
        "paintedCellText",
        "stackedCache",
        "stackedTopology",
        "tableRectangles",
      ],
    },
    reportTextCell: {
      parameters: ["column", "ink"],
      dependencies: ["reportContains", "stackedTopology"],
    },
    paintedShapeBounds: {
      parameters: ["e", "bbox", "viewport", "clips", "points", "css", "matrix"],
      dependencies: ["intersect", "point", "rr", "sx", "sy"],
    },
    colour: {
      parameters: ["fill"],
      dependencies: ["colourCache", "paintContext"],
    },
    fillPaint: { parameters: ["e"], dependencies: ["colour"] },
    contains: { parameters: ["b", "p"], dependencies: [] },
    occlusion: {
      parameters: ["t"],
      dependencies: ["contains", "intersect", "occluders", "rr", "sx", "sy"],
    },
    glyphAt: {
      parameters: ["layer", "p"],
      dependencies: ["glyphMasks", "rr", "sx", "sy", "textPaintGeometry"],
    },
    layerHit: {
      parameters: ["o", "p"],
      dependencies: ["contains", "glyphAt", "rr", "sx", "sy"],
    },
    blend: {
      parameters: ["foreground", "alpha", "background"],
      dependencies: [],
    },
    luminance: { parameters: ["rgb"], dependencies: [] },
    contrast: { parameters: ["a", "b"], dependencies: ["luminance"] },
    tagPaint: {
      parameters: ["t"],
      dependencies: [
        "blend",
        "contrast",
        "glyphAt",
        "intersect",
        "layerHit",
        "tagLayers",
        "h",
      ],
    },
    strokeInk: {
      parameters: ["e", "clip", "matrix", "subdivide"],
      dependencies: [
        "colour",
        "contains",
        "fillPaint",
        "occluders",
        "orders",
        "point",
        "shapeClips",
        "sx",
        "sy",
        "h",
      ],
    },
  },
});
