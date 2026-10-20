import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

/**
 * The floating label that names a data structure in the scene: "arr : int[]". It sits on a small
 * dark plate so grid lines and edges behind it never cut through the text, never takes pointer
 * events, and anchors by its left edge so it lines up with the structure's left side.
 */
export function createIdentifierLabel(fontFamily: string) {
  const el = document.createElement("div");
  /* CSS2DRenderer owns display and position (it hides labels off screen), so layout stays inline. */
  Object.assign(el.style, {
    padding: "3px 9px 4px",
    borderRadius: "7px",
    background: "rgba(6, 9, 15, 0.74)",
    border: "1px solid rgba(111, 233, 255, 0.13)",
    boxShadow: "0 6px 18px rgba(0, 0, 0, 0.45)",
    font: `500 13px ${fontFamily}`,
    letterSpacing: "0",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    userSelect: "none",
    transition: "opacity 220ms ease",
  } satisfies Partial<CSSStyleDeclaration>);
  const part = (color: string, weight = "500") => {
    const s = document.createElement("span");
    Object.assign(s.style, { color, fontWeight: weight });
    el.appendChild(s);
    return s;
  };
  const name = part("#eef1f6", "600");
  const colon = part("#5d6577");
  const type = part("#93a4c3");
  const extra = part("#6b7385");
  extra.style.marginLeft = "10px";
  const aliases = document.createElement("div");
  /* Other names for the same object sit above the chip: below it are the structure's cells and markers. */
  Object.assign(aliases.style, { position: "absolute", left: "10px", bottom: "100%", marginBottom: "3px", font: `500 11px ${fontFamily}`, color: "#6b7385", whiteSpace: "nowrap" });
  el.appendChild(aliases);

  const obj = new CSS2DObject(el);
  obj.center.set(0, 1);
  obj.visible = false;
  let current = "";

  return {
    el,
    obj,
    /**
     * title is "name : type", optionally with a kind hint in parentheses ("root : Node (binary
     * tree)"); a title without " : " is shown as a plain caption. note is drawn dimmer after it.
     */
    set(title: string, note = "", also: string[] = []) {
      const key = `${title}|${note}|${also.join(",")}`;
      if (key === current) return;
      current = key;
      obj.visible = !!title;
      const cut = title.indexOf(" : ");
      if (cut < 0) {
        name.textContent = "";
        colon.textContent = "";
        type.textContent = title;
      } else {
        const rest = title.slice(cut + 3);
        const hint = /\s\(([^()]*)\)$/.exec(rest);
        name.textContent = title.slice(0, cut);
        colon.textContent = " : ";
        type.textContent = hint ? rest.slice(0, hint.index) : rest;
        note = [hint?.[1], note].filter(Boolean).join("  ");
      }
      extra.textContent = note;
      extra.style.display = note ? "" : "none";
      aliases.textContent = also.length ? `also ${also.join(", ")}` : "";
    },
  };
}
