/**
 * Each file keeps its own given input (the bug: one shared input followed you to other files).
 * Run: npx tsx tests/per-file-input-check.ts
 */
import { deleteFile, deleteFolder, deserialize, renameFile, renameFolder, serialize, type Project } from "../lib/workspace/project";
import { withExample } from "../lib/workspace/examples";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : "  " + JSON.stringify(d)}`); };
const file = (path: string, content = "x") => ({ path, content, saved: content });
const base: Project = { files: [file("Main.java"), file("other.py")], folders: [], open: ["Main.java"], active: "Main.java", mainClass: null, stdin: "", inputs: { "other.py": "7\n" }, fontSize: 14 };

/* Adding an example sets only its own entry file's input. */
const a = withExample(base, { files: [{ path: "examples/py_input/greet.py", content: "name = input()" }], entry: "examples/py_input/greet.py" } as never, "Ada\n36\n")!.project;
check("adding an example saves its sample input on its own entry file", a.inputs["examples/py_input/greet.py"] === "Ada\n36\n", a.inputs);
check("  and leaves every other file's input alone", a.inputs["other.py"] === "7\n", a.inputs);
const b = withExample(a, { files: [{ path: "examples/sort/Sort.java", content: "class Sort {}" }], entry: "examples/sort/Sort.java" } as never, "1\n8\n6\n")!.project;
check("adding a second example does not overwrite the first one's input (the reported bug)", b.inputs["examples/py_input/greet.py"] === "Ada\n36\n" && b.inputs["examples/sort/Sort.java"] === "1\n8\n6\n", b.inputs);

/* Rename, move, delete. */
const r = renameFile(b, "other.py", "renamed.py");
check("a renamed file keeps its input", r.inputs["renamed.py"] === "7\n" && !("other.py" in r.inputs), r.inputs);
const m = renameFolder(b, "examples/py_input", "examples/inputs");
check("moving a folder carries its files' inputs", m.inputs["examples/inputs/greet.py"] === "Ada\n36\n" && !("examples/py_input/greet.py" in m.inputs), m.inputs);
const d = deleteFile(b, "other.py");
check("a deleted file's input goes with it", !("other.py" in d.inputs) && d.inputs["examples/sort/Sort.java"] === "1\n8\n6\n", d.inputs);
const df = deleteFolder(b, "examples");
check("deleting a folder drops the inputs of its files only", Object.keys(df.inputs).join() === "other.py", df.inputs);

/* Saved and restored. */
const back = deserialize(serialize(b))!;
check("inputs survive saving and reloading", JSON.stringify(back.inputs) === JSON.stringify(b.inputs), back.inputs);
const ghost = deserialize(serialize({ ...b, inputs: { ...b.inputs, "gone.py": "x" } }))!;
check("  and an input for a file that no longer exists is not restored", !("gone.py" in ghost.inputs), ghost.inputs);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
