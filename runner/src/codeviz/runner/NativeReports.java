package codeviz.runner;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turns GCC's diagnostics and the sanitizers' reports into structured results. Everything here is
 * read from what the tools printed; nothing is inferred from the source. Every sanitizer finding is
 * marked confirmed, since the tool observed it while the program ran.
 */
final class NativeReports {
  private NativeReports() {}

  private static String rel(String path, List<String> prefixes) {
    if (path == null) return null;
    for (String p : prefixes) if (path.startsWith(p)) return path.substring(p.length());
    return path;
  }

  private static boolean inProject(String path, List<String> prefixes) {
    if (path == null) return false;
    for (String p : prefixes) if (path.startsWith(p)) return true;
    return false;
  }

  /* ---------------- compiler ---------------- */

  private static final Pattern LINKER = Pattern.compile("^(?:(\\S+?):(\\d+):\\(\\.\\w+\\+0x[0-9a-f]+\\): )?(.*undefined reference to .*|.*multiple definition of .*)$");

  /** GCC's JSON diagnostics (one array per compiled file) and the linker's messages. */
  @SuppressWarnings("unchecked")
  static List<Map<String, Object>> compilerDiagnostics(String stderr, List<String> prefixes) {
    List<Map<String, Object>> out = new ArrayList<>();
    for (String line : stderr.lines().toList()) {
      String t = line.trim();
      if (t.startsWith("[")) {
        try {
          for (Object o : (List<Object>) Json.parse(t)) {
            if (!(o instanceof Map<?, ?> d)) continue;
            String kind = String.valueOf(d.get("kind"));
            if (!kind.equals("error") && !kind.equals("warning") && !kind.equals("fatal error")) continue;
            Map<String, Object> diag = new LinkedHashMap<>();
            Object locs = d.get("locations");
            if (locs instanceof List<?> l && !l.isEmpty() && l.get(0) instanceof Map<?, ?> loc && loc.get("caret") instanceof Map<?, ?> caret) {
              diag.put("file", rel(String.valueOf(caret.get("file")), prefixes));
              diag.put("line", caret.get("line"));
              diag.put("column", caret.get("column"));
            } else {
              diag.put("file", null); diag.put("line", null); diag.put("column", null);
            }
            diag.put("severity", kind.equals("warning") ? "warning" : "error");
            String option = d.get("option") instanceof String s ? " [" + s + "]" : "";
            diag.put("message", d.get("message") + option);
            out.add(diag);
          }
        } catch (RuntimeException ignored) {}
        continue;
      }
      Matcher m = LINKER.matcher(t);
      if (m.find() && !t.startsWith("collect2")) {
        Map<String, Object> diag = new LinkedHashMap<>();
        diag.put("file", m.group(1) == null ? null : rel(m.group(1), prefixes));
        diag.put("line", m.group(2) == null ? null : Integer.parseInt(m.group(2)));
        diag.put("column", null);
        diag.put("severity", "error");
        diag.put("message", "Linker: " + m.group(3).replace('`', '\'').replace("’", "'"));
        out.add(diag);
      }
    }
    return out;
  }

  /* ---------------- sanitizers ---------------- */

  private static final Pattern ASAN = Pattern.compile("==\\d+==ERROR: AddressSanitizer: (.+?)(?: on (?:unknown )?address (0x[0-9a-f]+))?(?: \\(|$| at pc)");
  private static final Pattern ACCESS = Pattern.compile("^(READ|WRITE) of size (\\d+) at (0x[0-9a-f]+)");
  private static final Pattern FRAME = Pattern.compile("^\\s*#\\d+ 0x[0-9a-f]+ in (\\S+) (\\S+?):(\\d+)(?::(\\d+))?");
  private static final Pattern REGION = Pattern.compile("^0x[0-9a-f]+ is located (\\d+) bytes? (to the left of|to the right of|after|before|inside of) (\\d+)-byte region");
  private static final Pattern LEAK = Pattern.compile("^(Direct|Indirect) leak of (\\d+) byte\\(s\\) in (\\d+) object\\(s\\) allocated from:");
  private static final Pattern UBSAN = Pattern.compile("^(\\S+?):(\\d+):(\\d+): runtime error: (.*)$");

  private static final Map<String, String> TITLES = Map.ofEntries(
      Map.entry("heap-use-after-free", "Use after free"),
      Map.entry("heap-buffer-overflow", "Heap buffer overflow"),
      Map.entry("stack-buffer-overflow", "Stack buffer overflow"),
      Map.entry("global-buffer-overflow", "Global buffer overflow"),
      Map.entry("stack-use-after-scope", "Use of a variable after its scope ended"),
      Map.entry("stack-overflow", "Stack overflow (recursion too deep)"),
      Map.entry("double-free", "Double free"),
      Map.entry("invalid-free", "Invalid free"),
      Map.entry("null-dereference", "Null pointer dereference"),
      Map.entry("SEGV", "Invalid memory access"),
      Map.entry("alloc-dealloc-mismatch", "Mismatched allocation and deallocation"),
      Map.entry("new-delete-type-mismatch", "Deleted with the wrong size or type"),
      Map.entry("leak", "Memory leak"),
      Map.entry("undefined-behavior", "Undefined behavior"));

  private static Map<String, Object> issue(String tool, String kind) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("tool", tool);
    m.put("kind", kind);
    m.put("title", TITLES.getOrDefault(kind, kind));
    m.put("confirmed", true);
    return m;
  }

  /** AddressSanitizer, LeakSanitizer, and UndefinedBehaviorSanitizer findings, in report order. */
  static List<Map<String, Object>> sanitizerReports(String stderr, List<String> prefixes) {
    List<Map<String, Object>> out = new ArrayList<>();
    List<String> lines = stderr.lines().toList();
    Map<String, Object> cur = null;
    String section = "access";
    for (String raw : lines) {
      String line = raw.trim();
      Matcher m;
      if ((m = ASAN.matcher(line)).find()) {
        String what = m.group(1).trim();
        String kind = what.contains("double-free") ? "double-free"
            : what.contains("not malloc()-ed") ? "invalid-free"
            : what.startsWith("alloc-dealloc-mismatch") ? "alloc-dealloc-mismatch"
            : what.startsWith("new-delete-type-mismatch") ? "new-delete-type-mismatch"
            : what.split(" ")[0];
        cur = issue("AddressSanitizer", kind);
        cur.put("message", what + (m.group(2) != null ? " at address " + m.group(2) : ""));
        if (m.group(2) != null) cur.put("address", m.group(2));
        out.add(cur);
        section = "access";
        continue;
      }
      if (line.contains("ERROR: LeakSanitizer: detected memory leaks")) { cur = null; section = "leak"; continue; }
      if ((m = LEAK.matcher(line)).find()) {
        cur = issue("LeakSanitizer", "leak");
        cur.put("direct", m.group(1).equals("Direct"));
        cur.put("bytes", Long.parseLong(m.group(2)));
        cur.put("objects", Long.parseLong(m.group(3)));
        cur.put("message", m.group(1) + " leak of " + m.group(2) + " byte(s) in " + m.group(3) + " object(s)");
        out.add(cur);
        section = "leakframes";
        continue;
      }
      if ((m = UBSAN.matcher(line)).find() && inProject(m.group(1), prefixes)) {
        Map<String, Object> u = issue("UndefinedBehaviorSanitizer", "undefined-behavior");
        String msg = m.group(4);
        u.put("title", msg.startsWith("signed integer overflow") ? "Signed integer overflow"
            : msg.contains("division by zero") ? "Division by zero"
            : msg.contains("null pointer") ? "Null pointer use"
            : msg.contains("out of bounds") ? "Index out of bounds"
            : msg.startsWith("shift") ? "Invalid shift"
            : msg.contains("misaligned") ? "Misaligned access" : "Undefined behavior");
        u.put("message", msg);
        u.put("file", rel(m.group(1), prefixes));
        u.put("line", Integer.parseInt(m.group(2)));
        u.put("column", Integer.parseInt(m.group(3)));
        out.add(u);
        cur = null;
        continue;
      }
      if (cur == null) continue;
      if ((m = ACCESS.matcher(line)).find()) {
        cur.put("access", Map.of("op", m.group(1).toLowerCase(), "size", Integer.parseInt(m.group(2)), "address", m.group(3)));
        continue;
      }
      if (line.startsWith("Hint: address points to the zero page")) { cur.put("kind", "null-dereference"); cur.put("title", TITLES.get("null-dereference")); continue; }
      if ((m = REGION.matcher(line)).find()) { cur.put("region", m.group(0).replaceFirst("^0x[0-9a-f]+ ", "The address ")); continue; }
      if (line.startsWith("freed by thread")) { section = "freed"; continue; }
      if (line.startsWith("previously allocated by thread") || line.startsWith("allocated by thread")) { section = "allocated"; continue; }
      if (line.startsWith("SUMMARY:")) { if (!"leakframes".equals(section)) cur = null; continue; }
      if ((m = FRAME.matcher(line)).find() && inProject(m.group(2), prefixes)) {
        Map<String, Object> loc = new LinkedHashMap<>();
        loc.put("file", rel(m.group(2), prefixes));
        loc.put("line", Integer.parseInt(m.group(3)));
        loc.put("function", m.group(1));
        String key = switch (section) { case "freed" -> "freed"; case "allocated" -> "allocated"; default -> "at"; };
        if (key.equals("at") && cur.get("file") == null) {
          cur.put("file", loc.get("file")); cur.put("line", loc.get("line")); cur.put("function", loc.get("function"));
        } else if (!key.equals("at") && cur.get(key) == null) cur.put(key, loc);
      }
    }
    return out;
  }

  private static final Pattern TERMINATE = Pattern.compile("terminate called after throwing an instance of '([^']+)'(?:\\s*\\n\\s*what\\(\\):\\s*(.*))?");

  /** An uncaught C++ exception, from the message std::terminate prints. */
  static Map<String, Object> uncaughtException(String stderr) {
    Matcher m = TERMINATE.matcher(stderr);
    if (!m.find()) return null;
    Map<String, Object> ex = new LinkedHashMap<>();
    ex.put("type", m.group(1));
    ex.put("message", m.group(2) == null ? "An exception was thrown and never caught." : m.group(2).trim());
    return ex;
  }

  static String signalName(int sig) {
    return switch (sig) {
      case 11 -> "Segmentation fault (SIGSEGV)";
      case 6 -> "Aborted (SIGABRT)";
      case 8 -> "Arithmetic error (SIGFPE)";
      case 7 -> "Bus error (SIGBUS)";
      case 9 -> "Killed (SIGKILL)";
      default -> "Signal " + sig;
    };
  }
}
