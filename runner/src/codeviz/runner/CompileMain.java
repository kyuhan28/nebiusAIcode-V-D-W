package codeviz.runner;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

/**
 * Runs inside a separate, resource-limited JVM. Compiles the given sources with the real
 * javac and prints structured diagnostics as one JSON line.
 * Usage: CompileMain <srcDir> <outDir> <file>...
 */
public final class CompileMain {
  public static void main(String[] args) throws Exception {
    Path src = Path.of(args[0]);
    String out = args[1];
    JavaCompiler javac = ToolProvider.getSystemJavaCompiler();
    if (javac == null) {
      System.out.println("{\"ok\":false,\"fatal\":\"This Java installation has no compiler. Install a full JDK.\"}");
      return;
    }
    DiagnosticCollector<JavaFileObject> diags = new DiagnosticCollector<>();
    try (StandardJavaFileManager fm = javac.getStandardFileManager(diags, Locale.US, StandardCharsets.UTF_8)) {
      List<File> files = new ArrayList<>();
      for (int i = 2; i < args.length; i++) files.add(new File(args[i]));
      List<String> options = List.of("-g", "-proc:none", "-encoding", "UTF-8", "-Xlint:all,-serial,-processing", "-Xmaxerrs", "50", "-d", out);
      boolean ok = javac.getTask(null, fm, diags, options, null, fm.getJavaFileObjectsFromFiles(files)).call();
      List<Object> list = new ArrayList<>();
      for (Diagnostic<? extends JavaFileObject> d : diags.getDiagnostics()) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("severity", d.getKind() == Diagnostic.Kind.ERROR ? "error" : d.getKind() == Diagnostic.Kind.NOTE ? "info" : "warning");
        String file = d.getSource() == null ? null : src.relativize(Path.of(d.getSource().toUri())).toString();
        m.put("file", file);
        m.put("line", d.getLineNumber() > 0 ? d.getLineNumber() : null);
        m.put("column", d.getColumnNumber() > 0 ? d.getColumnNumber() : null);
        m.put("message", d.getMessage(Locale.US));
        list.add(m);
      }
      Map<String, Object> res = new LinkedHashMap<>();
      res.put("ok", ok);
      res.put("diagnostics", list);
      System.out.println(Json.write(res));
    }
  }
}
