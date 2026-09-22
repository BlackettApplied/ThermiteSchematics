import type {
  CableResult,
  ConductiveElementView,
  InspectResult,
  NetSummaryView,
  PotentialView,
  ProjectObjectView,
  QueryCommandResult,
  TerminalView,
} from "@thermite/query";

const SAFE_ATOM = /^[A-Za-z0-9._+:/=@%#~-]+$/;

function atom(value: string): string {
  return SAFE_ATOM.test(value) ? value : JSON.stringify(value);
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const member = (value as Record<string, unknown>)[key];
    if (member !== undefined) result[key] = canonicalJsonValue(member);
  }
  return result;
}

function compactJson(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

function spaces(count: number): string {
  return " ".repeat(count);
}

function none(lines: string[], indentation: number): void {
  lines.push(`${spaces(indentation)}(none)`);
}

function renderAliases(
  lines: string[],
  indentation: number,
  aliases: readonly string[],
): void {
  lines.push(`${spaces(indentation)}aliases:`);
  if (aliases.length === 0) return none(lines, indentation + 2);
  for (const alias of aliases) {
    lines.push(`${spaces(indentation + 2)}alias ${atom(alias)}`);
  }
}

function renderPotentialRow(
  lines: string[],
  indentation: number,
  potential: PotentialView,
): void {
  lines.push(
    `${spaces(indentation)}potential ${atom(potential.name)} uid=${atom(potential.uid)} electrical=${compactJson(potential.electrical)}`,
  );
}

function renderPotentials(
  lines: string[],
  indentation: number,
  potentials: readonly PotentialView[],
): void {
  lines.push(`${spaces(indentation)}potentials:`);
  if (potentials.length === 0) return none(lines, indentation + 2);
  for (const potential of potentials) {
    renderPotentialRow(lines, indentation + 2, potential);
  }
}

function renderTerminal(
  lines: string[],
  indentation: number,
  terminal: TerminalView,
): void {
  const prefix = spaces(indentation);
  const child = spaces(indentation + 2);
  lines.push(`${prefix}terminal ${atom(terminal.display)}`);
  lines.push(`${child}id ${compactJson(terminal.id)}`);
  lines.push(`${child}device-designation ${atom(terminal.deviceDesignation)}`);
  if (terminal.role !== undefined) {
    lines.push(`${child}role ${atom(terminal.role)}`);
  }
  if (terminal.rating !== undefined) {
    lines.push(`${child}rating ${compactJson(terminal.rating)}`);
  }
  if (terminal.connectionPolicy !== undefined) {
    lines.push(`${child}connection-policy ${atom(terminal.connectionPolicy)}`);
  }
  if (terminal.description !== undefined) {
    lines.push(`${child}description ${atom(terminal.description)}`);
  }
}

function renderElement(
  lines: string[],
  indentation: number,
  element: ConductiveElementView,
): void {
  const prefix = spaces(indentation);
  if (element.kind === "wire") {
    lines.push(
      `${prefix}wire ${atom(element.display)} uid=${atom(element.uid)}`,
    );
  } else if (element.kind === "jumper") {
    lines.push(
      `${prefix}jumper ${atom(element.display)} uid=${atom(element.uid)}`,
    );
  } else {
    lines.push(
      `${prefix}cable-conductor ${atom(element.display)} cable-uid=${atom(element.cableUid)} conductor-id=${atom(element.conductorId)}`,
    );
  }
}

function renderNetSummary(
  lines: string[],
  indentation: number,
  net: NetSummaryView,
): void {
  lines.push(`${spaces(indentation)}net ${atom(net.id)}`);
  renderPotentials(lines, indentation + 2, net.potentials);
}

function objectLabel(object: ProjectObjectView): string {
  return object.designation ?? `${object.kind}:${object.uid}`;
}

function renderInspect(result: InspectResult): string[] {
  const lines: string[] = [];
  const object = result.object;

  if (object.kind === "device") {
    lines.push(`device ${atom(object.designation)}`);
    lines.push(`  uid ${atom(object.uid)}`);
    lines.push(`  type ${atom(object.typeId)}`);
    if (object.description !== undefined) {
      lines.push(`  description ${atom(object.description)}`);
    }
    renderAliases(lines, 2, object.aliases);
    if (object.location !== undefined) {
      lines.push(`  location ${atom(object.location)}`);
    }
    lines.push("  terminals:");
    if (object.terminals.length === 0) none(lines, 4);
    for (const terminal of object.terminals) {
      renderTerminal(lines, 4, terminal);
      lines.push(`      net ${atom(terminal.net.id)}`);
      renderPotentials(lines, 6, terminal.net.potentials);
      lines.push("      elements:");
      if (terminal.elements.length === 0) none(lines, 8);
      for (const element of terminal.elements) renderElement(lines, 8, element);
    }
    lines.push("  functions:");
    if (object.functions.length === 0) none(lines, 4);
    for (const functionView of object.functions) {
      let row = `    function ${atom(functionView.key)} kind=${atom(functionView.kind)}`;
      if (functionView.normalState !== undefined) {
        row += ` normal-state=${atom(functionView.normalState)}`;
      }
      if (functionView.direction !== undefined) {
        row += ` direction=${atom(functionView.direction)}`;
      }
      lines.push(row);
      lines.push("      terminals:");
      if (functionView.terminals.length === 0) none(lines, 8);
      for (const terminal of functionView.terminals) {
        renderTerminal(lines, 8, terminal);
      }
    }
    lines.push("  ganged-groups:");
    if (object.gangedGroups.length === 0) none(lines, 4);
    for (const group of object.gangedGroups) {
      lines.push(`    group ${atom(group.id)}`);
      lines.push("      functions:");
      if (group.functionKeys.length === 0) none(lines, 8);
      for (const functionKey of group.functionKeys) {
        lines.push(`        function ${atom(functionKey)}`);
      }
    }
    lines.push("  internal-relations:");
    if (object.internalRelations.length === 0) none(lines, 4);
    for (const relation of object.internalRelations) {
      lines.push(
        `    relation ${atom(relation.verb)} from=${atom(relation.fromFunctionKey)} to=${atom(relation.toFunctionKey)}`,
      );
    }
    lines.push("  project-relations:");
    if (object.projectRelations.length === 0) none(lines, 4);
    for (const relation of object.projectRelations) {
      lines.push(
        `    relation ${atom(relation.direction)} ${atom(relation.relation.verb)} other=${atom(relation.otherDevice.designation)} other-uid=${atom(relation.otherDevice.uid)} via=${atom(relation.relation.display)}`,
      );
    }
    return lines;
  }

  if (object.kind === "wire") {
    lines.push(`wire ${atom(object.designation)}`);
    lines.push(`  uid ${atom(object.uid)}`);
    if (object.description !== undefined) {
      lines.push(`  description ${atom(object.description)}`);
    }
    renderAliases(lines, 2, object.aliases);
    if (object.properties !== undefined) {
      lines.push(`  properties ${compactJson(object.properties)}`);
    }
    lines.push("  endpoints:");
    for (const endpoint of object.endpoints) renderTerminal(lines, 4, endpoint);
    renderNetSummary(lines, 2, object.net);
    return lines;
  }

  if (object.kind === "jumper") {
    lines.push(`jumper ${atom(objectLabel(object))}`);
    lines.push(`  uid ${atom(object.uid)}`);
    if (object.designation !== undefined) {
      lines.push(`  designation ${atom(object.designation)}`);
    }
    if (object.description !== undefined) {
      lines.push(`  description ${atom(object.description)}`);
    }
    renderAliases(lines, 2, object.aliases);
    lines.push("  endpoints:");
    for (const endpoint of object.endpoints) renderTerminal(lines, 4, endpoint);
    renderNetSummary(lines, 2, object.net);
    return lines;
  }

  if (object.kind === "cable") {
    lines.push(`cable ${atom(object.designation)}`);
    lines.push(`  uid ${atom(object.uid)}`);
    if (object.description !== undefined) {
      lines.push(`  description ${atom(object.description)}`);
    }
    renderAliases(lines, 2, object.aliases);
    lines.push(`  type ${atom(object.typeId)}`);
    lines.push(`  cable-type ${atom(object.cableType.id)}`);
    if (object.cableType.shield !== undefined) {
      lines.push(`  shield ${String(object.cableType.shield)}`);
    }
    if (object.cableType.construction !== undefined) {
      lines.push(
        `  construction ${compactJson(object.cableType.construction)}`,
      );
    }
    lines.push(`  conductor-count ${object.conductorCount}`);
    lines.push("  conductor-ids:");
    if (object.conductorIds.length === 0) none(lines, 4);
    for (const conductorId of object.conductorIds) {
      lines.push(`    conductor ${compactJson(conductorId)}`);
    }
    return lines;
  }

  if (object.kind === "relation") {
    lines.push(`relation ${atom(objectLabel(object))}`);
    lines.push(`  uid ${atom(object.uid)}`);
    if (object.designation !== undefined) {
      lines.push(`  designation ${atom(object.designation)}`);
    }
    if (object.description !== undefined) {
      lines.push(`  description ${atom(object.description)}`);
    }
    renderAliases(lines, 2, object.aliases);
    lines.push(`  verb ${atom(object.verb)}`);
    lines.push(
      `  from ${atom(object.from.designation)} uid=${atom(object.from.uid)}`,
    );
    lines.push(
      `  to ${atom(object.to.designation)} uid=${atom(object.to.uid)}`,
    );
    return lines;
  }

  lines.push(`potential ${atom(objectLabel(object))}`);
  lines.push(`  uid ${atom(object.uid)}`);
  if (object.designation !== undefined) {
    lines.push(`  designation ${atom(object.designation)}`);
  }
  if (object.description !== undefined) {
    lines.push(`  description ${atom(object.description)}`);
  }
  renderAliases(lines, 2, object.aliases);
  lines.push(`  name ${atom(object.name)}`);
  lines.push(`  electrical ${compactJson(object.electrical)}`);
  lines.push("  selected-terminal:");
  renderTerminal(lines, 4, object.terminal);
  renderNetSummary(lines, 2, object.net);
  return lines;
}

function renderCable(result: CableResult): string[] {
  const lines = [
    `cable ${atom(result.cable.designation)}`,
    `  uid ${atom(result.cable.uid)}`,
  ];
  if (result.cable.description !== undefined) {
    lines.push(`  description ${atom(result.cable.description)}`);
  }
  renderAliases(lines, 2, result.cable.aliases);
  lines.push(`  type ${atom(result.cable.typeId)}`);
  lines.push(`  cable-type ${atom(result.cableType.id)}`);
  if (result.cableType.shield !== undefined) {
    lines.push(`  shield ${String(result.cableType.shield)}`);
  }
  if (result.cableType.construction !== undefined) {
    lines.push(`  construction ${compactJson(result.cableType.construction)}`);
  }
  lines.push("  conductors:");
  if (result.conductors.length === 0) none(lines, 4);
  for (const conductor of result.conductors) {
    lines.push(
      `    conductor ${atom(conductor.display)} id=${compactJson(conductor.id)}`,
    );
    lines.push(`      color ${atom(conductor.color)}`);
    if (conductor.size !== undefined) {
      lines.push(`      size ${atom(conductor.size)}`);
    }
    lines.push(`      net ${atom(conductor.net.id)}`);
    renderPotentials(lines, 6, conductor.net.potentials);
    lines.push("      endpoints:");
    for (const endpoint of conductor.endpoints) {
      renderTerminal(lines, 8, endpoint);
    }
  }
  return lines;
}

export function renderHumanQueryResult(result: QueryCommandResult): string {
  let lines: string[];
  if (result.command === "inspect") {
    lines = renderInspect(result);
  } else if (result.command === "neighbors") {
    lines = [
      `neighbors ${atom(result.device.designation)}`,
      `  uid ${atom(result.device.uid)}`,
      "  conductive:",
    ];
    if (result.conductive.length === 0) none(lines, 4);
    for (const neighbor of result.conductive) {
      lines.push(
        `    ${atom(neighbor.terminal.display)} -- ${atom(neighbor.element.display)} --> ${atom(neighbor.otherTerminal.display)} device=${atom(neighbor.otherDevice.designation)} uid=${atom(neighbor.otherDevice.uid)}`,
      );
    }
    lines.push("  relations:");
    if (result.relations.length === 0) none(lines, 4);
    for (const neighbor of result.relations) {
      lines.push(
        `    ${atom(neighbor.direction)} ${atom(neighbor.relation.verb)} ${atom(neighbor.otherDevice.designation)} uid=${atom(neighbor.otherDevice.uid)} via ${atom(neighbor.relation.display)}`,
      );
    }
  } else if (result.command === "trace") {
    lines = [
      `trace ${atom(result.device.designation)}`,
      `  uid ${atom(result.device.uid)}`,
      "  components:",
    ];
    if (result.components.length === 0) none(lines, 4);
    for (const component of result.components) {
      lines.push(`    component ${atom(component.net.id)}`);
      lines.push("      roots:");
      if (component.roots.length === 0) none(lines, 8);
      for (const root of component.roots) {
        lines.push(`        terminal ${atom(root.display)}`);
      }
      renderPotentials(lines, 6, component.net.potentials);
      lines.push("      visits:");
      if (component.visits.length === 0) none(lines, 8);
      for (const visit of component.visits) {
        const suffix =
          visit.via === undefined
            ? ""
            : ` via ${atom(visit.via.element.display)} from ${atom(visit.via.from.display)}`;
        lines.push(
          `        visit ${visit.hops} ${atom(visit.terminal.display)}${suffix}`,
        );
      }
      lines.push("      edges:");
      if (component.elements.length === 0) none(lines, 8);
      for (const edge of component.elements) {
        lines.push("        edge");
        renderElement(lines, 10, edge.element);
        lines.push(`          from ${atom(edge.endpoints[0].display)}`);
        lines.push(`          to ${atom(edge.endpoints[1].display)}`);
      }
    }
  } else if (result.command === "net") {
    lines = [
      `net ${atom(result.net.id)}`,
      `  selected ${atom(result.selectedTerminal.display)}`,
    ];
    renderPotentials(lines, 2, result.net.potentials);
    lines.push("  terminals:");
    if (result.net.terminals.length === 0) none(lines, 4);
    for (const terminal of result.net.terminals) {
      lines.push(`    terminal ${atom(terminal.display)}`);
    }
    lines.push("  elements:");
    if (result.net.elements.length === 0) none(lines, 4);
    for (const edge of result.net.elements) {
      lines.push("    edge");
      renderElement(lines, 6, edge.element);
      lines.push(`      from ${atom(edge.endpoints[0].display)}`);
      lines.push(`      to ${atom(edge.endpoints[1].display)}`);
    }
  } else {
    lines = renderCable(result);
  }

  return `${lines.join("\n")}\n`;
}
