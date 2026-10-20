/**
 * Turns the types a recorder reports into the names a programmer writes. Declared types come
 * from the class files (java.util.Map<java.lang.String, java.lang.Integer>); runtime types come
 * from heap objects and are erased (java.util.HashMap). Nothing here guesses a type argument
 * that was not recorded.
 */
import type { HeapObj } from "./interpret";

const JDK = /^(java|javax|jdk|sun|com\.sun)\./;

/** One qualified class name, shortened: java.util.Map$Entry -> Map.Entry, Main$Node -> Node. */
export function simpleName(qualified: string): string {
  const jdk = JDK.test(qualified);
  const cls = qualified.slice(qualified.lastIndexOf(".") + 1);
  if (!cls.includes("$")) return cls;
  const parts = cls.split("$");
  /* Anonymous and local classes (Main$1) keep their binary name; there is nothing shorter that is true. */
  if (parts.some((p) => /^\d/.test(p))) return cls;
  return jdk ? parts.join(".") : parts[parts.length - 1];
}

/** A whole type expression, generics and arrays included: Map<String, List<Integer>>, int[][]. */
export function formatType(type: string | null | undefined): string | null {
  if (!type) return null;
  return type.replace(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g, (name) => (name === "extends" || name === "super" ? name : simpleName(name)));
}

/** The erased class name of a type expression, for comparing a declared type with the runtime class. */
export function rawName(type: string | null | undefined): string | null {
  if (!type) return null;
  return type.replace(/<.*$/s, "").replace(/(\[\])+$/, "");
}

/** The runtime type of a heap object, as precisely as the recording allows. */
export function runtimeType(obj: HeapObj | undefined): string | null {
  if (!obj) return null;
  if (obj.t === "array") return `${formatType(obj.of)}[]`;
  return simpleName(obj.cls);
}

/**
 * The type shown next to a variable: the declared type when the class file recorded one, the
 * runtime class otherwise. When a reference's object is a different class than its declared
 * type (List<Integer> holding an ArrayList), that class is returned as `runtime` too.
 */
export function describeType(declared: string | null | undefined, obj: HeapObj | undefined): { type: string | null; runtime: string | null } {
  const shown = formatType(declared);
  const actual = runtimeType(obj);
  if (!shown) return { type: actual, runtime: null };
  if (!actual || !obj || obj.t === "array") return { type: shown, runtime: null };
  const sameClass = simpleName(rawName(declared) ?? "") === actual;
  return { type: shown, runtime: sameClass ? null : actual };
}

/** "arr : int[]", or "scores : Map<String, Integer>" with the runtime class kept separate. */
export function identifier(name: string, type: string | null, runtime?: string | null): string {
  return type ? `${name} : ${type}${runtime ? ` (${runtime})` : ""}` : name;
}
