/**
 * The languages the coding assistant writes, and what is true of each in this project's runner.
 * Shared by the browser (which language a file is) and the server (what to tell the model, and
 * which code blocks to accept back). The facts here describe the actual runner setup; keep them
 * in step with runner/README.md.
 */
export type AiLanguage = "java" | "python" | "c" | "cpp";
export const AI_LANGUAGES: readonly AiLanguage[] = ["java", "python", "c", "cpp"];

export type LanguageProfile = {
  id: AiLanguage;
  name: string;
  /** The tag the model should put on its code block, and the tags accepted back. */
  fence: string;
  fences: string[];
  runtime: string;
  rules: string[];
};

export const PROFILES: Record<AiLanguage, LanguageProfile> = {
  java: {
    id: "java", name: "Java", fence: "java", fences: ["java"],
    runtime: "Java 21 (OpenJDK). Programs are compiled with javac and run on the JVM; only the JDK's standard library is available. Input comes from standard input (Scanner or BufferedReader).",
    rules: [
      "Write Java 21. Keep the public class name matching the file name, and keep the package declaration.",
      "Use java.util collections and the standard library; no external libraries.",
      "Do not use Python, C, or C++ syntax or libraries.",
    ],
  },
  python: {
    id: "python", name: "Python", fence: "python", fences: ["python", "py", "python3"],
    runtime: "Python 3.12 (CPython). The standard library is available, plus these installed packages: numpy, pandas, matplotlib (save figures with savefig; there is no display), scipy, scikit-learn, sympy, networkx, pillow, python-dateutil. Programs have no network access. input() reads standard input.",
    rules: [
      "Write idiomatic Python 3.12 with 4-space indentation: built-ins, comprehensions, and the standard library where they fit.",
      "Do not translate Java patterns (no getters and setters, no classes where a function will do, no type declarations as in Java).",
      "Use only the standard library and the packages listed as installed.",
    ],
  },
  c: {
    id: "c", name: "C", fence: "c", fences: ["c", "h"],
    runtime: "C17, compiled with gcc 13 (-std=c17 -Wall -Wextra, linked with -lm). Every run is checked by AddressSanitizer, UndefinedBehaviorSanitizer, and LeakSanitizer. Input comes from standard input (scanf, fgets).",
    rules: [
      "Write standard C17. No C++: no classes, references, namespaces, templates, new or delete, std::, or iostream.",
      "Include every header the code uses (stdio.h, stdlib.h, string.h, stdbool.h, ...) and declare functions before they are used.",
      "Check the result of malloc, calloc, and realloc, free every allocation exactly once, keep the old pointer until realloc succeeds, and never read past the end of a buffer.",
    ],
  },
  cpp: {
    id: "cpp", name: "C++", fence: "cpp", fences: ["cpp", "c++", "cc", "cxx", "hpp"],
    runtime: "C++20, compiled with g++ 13 (-std=c++20 -Wall -Wextra). Runs are checked by AddressSanitizer and UndefinedBehaviorSanitizer. The standard library (STL containers, algorithms, smart pointers) is available; nothing else. Input comes from standard input (std::cin).",
    rules: [
      "Write modern C++20: standard containers and algorithms, references, const-correctness, and RAII.",
      "Prefer std::vector, std::string, std::unique_ptr, and std::make_shared over raw new and delete unless the task is about them.",
      "Do not use Java libraries or syntax, and avoid C-only patterns (malloc, char buffers) where idiomatic C++ is safer.",
    ],
  },
};

/** The language a file is written in, from its extension; null when the extension does not say (a .h header, a data file). */
export function languageOfPath(path: string | null | undefined): AiLanguage | null {
  if (!path) return null;
  if (path.endsWith(".java")) return "java";
  if (path.endsWith(".py")) return "python";
  if (/\.c$/.test(path)) return "c";
  if (/\.(cpp|cc|cxx|hpp|hh|hxx)$/.test(path)) return "cpp";
  return null;
}

/** The language a code block's tag names, if it is one of the four. */
export function languageOfFence(tag: string): AiLanguage | null {
  const t = tag.trim().toLowerCase();
  for (const l of AI_LANGUAGES) if (PROFILES[l].fences.includes(t)) return l;
  return null;
}
