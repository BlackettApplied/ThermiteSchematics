import { displaySheet } from "./browser.mjs";

function mutateInk(root, name) {
  const one = (s) => root.querySelector(s);
  const all = (s) => [...root.querySelectorAll(s)];
  if (name === "missing-strip") {
    const groups = all("[data-terminal-strip]");
    for (const group of groups) group.remove();
    return groups.length;
  }
  if (name === "dropped-core" || name === "wrong-peer") {
    const groups = all("[data-strip-incidence]").filter(
      (e) =>
        e.getAttribute("data-strip-incidence").startsWith("[") &&
        JSON.parse(e.getAttribute("data-strip-incidence"))[1] === "2-",
    );
    for (const e of groups) {
      if (name === "dropped-core") e.remove();
      else {
        const text = e.querySelector("text").cloneNode(true);
        for (const t of e.querySelectorAll("text")) t.remove();
        text.textContent = "CBL1/2- → invented.99";
        e.append(text);
      }
    }
    return groups.length;
  }
  if (name === "missing-bridge" || name === "extra-bridge") {
    const bridge = one("[data-strip-jumper]");
    if (!bridge) return 0;
    if (name === "missing-bridge") bridge.remove();
    else {
      const added = bridge.cloneNode(true);
      added.setAttribute("data-strip-jumper", "invented-extra-bridge");
      bridge.parentElement.append(added);
    }
    return 1;
  }
  if (name === "stub-crosses-bridge") {
    const stub = all("[data-strip-incidence]").find((group) =>
      group.textContent.includes("CBL1/1+ → JB1.X1.1"),
    );
    const path = stub?.querySelector("path");
    if (!path) return 0;
    // Restore the premature bend while leaving the source binding and
    // endpoints intact. The first bridge track is 6 mm from TB1's edge.
    const elbow = path.getPointAtLength(0).x + 3.5;
    const original = path.getAttribute("d");
    const crossing = original.replace(/ H [-\d.]+ V /u, ` H ${elbow} V `);
    if (crossing === original) return 0;
    path.setAttribute("d", crossing);
    return 1;
  }
  if (name === "missing-continuation") {
    const markers = all("[data-strip-continuation]");
    for (const m of markers) m.remove();
    return markers.length;
  }
  if (name === "broken-reference") {
    const ref = one("[data-strip-row]");
    if (!ref) return 0;
    ref.textContent = "T99/R99";
    return 1;
  }
  return 0;
}
function mutateIdentity(root, name) {
  if (name === "wrong-order") {
    const ts = [...root.querySelectorAll("[data-strip-terminal]")];
    if (ts.length < 2) return 0;
    const delta = ts[1].getBBox().y - ts[0].getBBox().y;
    ts[0].setAttribute("transform", `translate(0 ${delta})`);
    ts[1].setAttribute("transform", `translate(0 ${-delta})`);
    return 2;
  }
  if (name === "identity-only") {
    const shapes = [
      ...root.querySelectorAll(
        '[data-sheet-kind="terminal-strip"] :is(rect,path,line,polyline,polygon,circle,ellipse,text)',
      ),
    ];
    for (const s of shapes) s.remove();
    return shapes.length;
  }
  if (name === "hidden-root") {
    root.style.opacity = "0";
    return 1;
  }
  return 0;
}
export async function mutateTerminalSvg(page, svg, name) {
  await displaySheet(page, svg);
  return page.evaluate(
    ({ name, ink, identity }) => {
      const root = document.querySelector("svg");
      const changed =
        (0, eval)(`(${ink})`)(root, name) ||
        (0, eval)(`(${identity})`)(root, name);
      return { changed, svg: root.outerHTML };
    },
    { name, ink: mutateInk.toString(), identity: mutateIdentity.toString() },
  );
}
