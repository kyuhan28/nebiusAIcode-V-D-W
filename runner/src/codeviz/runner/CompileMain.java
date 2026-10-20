package codeviz.runner;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import javax.lang.model.element.Element;
import javax.lang.model.element.ElementKind;
import javax.lang.model.element.ExecutableElement;
import javax.lang.model.element.Modifier;
import javax.lang.model.element.TypeElement;
import javax.lang.model.element.VariableElement;
import javax.lang.model.type.ArrayType;
import javax.lang.model.type.DeclaredType;
import javax.lang.model.type.TypeKind;
import javax.lang.model.type.TypeMirror;
import javax.lang.model.util.Elements;
import javax.lang.model.util.Types;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.TaskEvent;
import com.sun.source.util.TaskListener;
import com.sun.source.util.TreePath;
import com.sun.source.util.Trees;

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
      JavacTask task = (JavacTask) javac.getTask(null, fm, diags, options, null, fm.getJavaFileObjectsFromFiles(files));
      Hierarchy hierarchy = new Hierarchy(task, src);
      task.addTaskListener(hierarchy);
      boolean ok = task.call();
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
      /* Only a successful compile has a complete, trustworthy class model. */
      if (ok) res.put("hierarchy", hierarchy.classes);
      System.out.println(Json.write(res));
    }
  }

  /**
   * The project's classes as javac itself resolved them: superclass, interfaces, modifiers, and
   * members, with override relationships decided by javac's own rules (Elements.overrides), and
   * the file and line each one is declared on. Collected as each class finishes analysis.
   */
  static final class Hierarchy implements TaskListener {
    final List<Object> classes = new ArrayList<>();
    private final Elements elements;
    private final Types types;
    private final Trees trees;
    private final Path src;
    private CompilationUnitTree unit;

    Hierarchy(JavacTask task, Path src) {
      this.elements = task.getElements();
      this.types = task.getTypes();
      this.trees = Trees.instance(task);
      this.src = src;
    }

    @Override
    public void finished(TaskEvent e) {
      if (e.getKind() != TaskEvent.Kind.ANALYZE || e.getTypeElement() == null) return;
      unit = e.getCompilationUnit();
      try {
        describe(e.getTypeElement());
      } catch (RuntimeException ignored) {
        /* The class model is a bonus; a surprise in it must never fail the compile. */
      }
    }

    private void describe(TypeElement type) {
      Map<String, Object> c = new LinkedHashMap<>();
      c.put("name", elements.getBinaryName(type).toString());
      c.put("simpleName", type.getSimpleName().toString());
      c.put("kind", type.getKind() == ElementKind.INTERFACE || type.getKind() == ElementKind.ANNOTATION_TYPE ? "interface"
          : type.getKind() == ElementKind.ENUM ? "enum" : type.getKind() == ElementKind.RECORD ? "record" : "class");
      c.put("abstract", type.getKind() == ElementKind.CLASS && type.getModifiers().contains(Modifier.ABSTRACT));
      c.put("file", unit == null ? null : src.relativize(Path.of(unit.getSourceFile().toUri())).toString());
      c.put("line", line(type));
      TypeMirror sup = type.getSuperclass();
      c.put("superclass", sup.getKind() == TypeKind.DECLARED ? binary(sup) : null);
      List<Object> ifaces = new ArrayList<>();
      for (TypeMirror i : type.getInterfaces()) ifaces.add(binary(i));
      c.put("interfaces", ifaces);
      List<Object> methods = new ArrayList<>();
      List<Object> fields = new ArrayList<>();
      for (Element m : type.getEnclosedElements()) {
        if (m instanceof ExecutableElement ex && (m.getKind() == ElementKind.METHOD || m.getKind() == ElementKind.CONSTRUCTOR)) {
          Elements.Origin origin = elements.getOrigin(m);
          if (origin == Elements.Origin.SYNTHETIC) continue;
          /* Records and enums get compiler-written members; only a mandated default constructor is worth showing. */
          if (origin == Elements.Origin.MANDATED && m.getKind() != ElementKind.CONSTRUCTOR) continue;
          Map<String, Object> d = new LinkedHashMap<>();
          d.put("name", m.getKind() == ElementKind.CONSTRUCTOR ? "<init>" : m.getSimpleName().toString());
          d.put("descriptor", descriptor(ex));
          List<Object> params = new ArrayList<>();
          for (VariableElement p : ex.getParameters()) params.add(p.asType().toString() + " " + p.getSimpleName());
          d.put("params", params);
          d.put("returns", ex.getReturnType().toString());
          d.put("modifiers", modifiers(m.getModifiers()));
          d.put("implicit", origin == Elements.Origin.MANDATED);
          d.put("line", line(m));
          d.put("overrides", overridden(ex, type));
          methods.add(d);
        } else if (m instanceof VariableElement v && (m.getKind() == ElementKind.FIELD || m.getKind() == ElementKind.ENUM_CONSTANT)) {
          if (elements.getOrigin(m) != Elements.Origin.EXPLICIT) continue;
          Map<String, Object> d = new LinkedHashMap<>();
          d.put("name", v.getSimpleName().toString());
          d.put("type", v.asType().toString());
          d.put("modifiers", modifiers(m.getModifiers()));
          d.put("line", line(m));
          fields.add(d);
        }
      }
      c.put("methods", methods);
      c.put("fields", fields);
      classes.add(c);
      for (Element inner : type.getEnclosedElements()) if (inner instanceof TypeElement t) describe(t);
    }

    /** The nearest supertype method this one overrides, as "binary.Class#name", by javac's rules. */
    private String overridden(ExecutableElement m, TypeElement owner) {
      if (m.getKind() != ElementKind.METHOD || m.getModifiers().contains(Modifier.STATIC) || m.getModifiers().contains(Modifier.PRIVATE)) return null;
      java.util.ArrayDeque<TypeMirror> queue = new java.util.ArrayDeque<>(types.directSupertypes(owner.asType()));
      Set<String> seen = new java.util.HashSet<>();
      while (!queue.isEmpty()) {
        TypeMirror t = queue.poll();
        if (!(t instanceof DeclaredType dt) || !(dt.asElement() instanceof TypeElement st) || !seen.add(st.getQualifiedName().toString())) continue;
        for (Element o : st.getEnclosedElements()) {
          if (o instanceof ExecutableElement oe && o.getKind() == ElementKind.METHOD && o.getSimpleName().equals(m.getSimpleName()) && elements.overrides(m, oe, owner))
            return elements.getBinaryName(st) + "#" + o.getSimpleName();
        }
        queue.addAll(types.directSupertypes(t));
      }
      return null;
    }

    private Integer line(Element el) {
      TreePath path = trees.getPath(el);
      if (path == null) return null;
      long pos = trees.getSourcePositions().getStartPosition(path.getCompilationUnit(), path.getLeaf());
      return pos < 0 ? null : (int) path.getCompilationUnit().getLineMap().getLineNumber(pos);
    }

    private String binary(TypeMirror t) {
      Element el = types.asElement(t);
      return el instanceof TypeElement te ? elements.getBinaryName(te).toString() : t.toString();
    }

    private static List<Object> modifiers(Set<Modifier> mods) {
      List<Object> out = new ArrayList<>();
      for (Modifier m : mods) out.add(m.toString());
      return out;
    }

    /** The JVM descriptor ("(I)V") the recorder reports for a running method, to match frames to members. */
    private String descriptor(ExecutableElement m) {
      StringBuilder b = new StringBuilder("(");
      for (VariableElement p : m.getParameters()) b.append(desc(types.erasure(p.asType())));
      return b.append(")").append(m.getKind() == ElementKind.CONSTRUCTOR ? "V" : desc(types.erasure(m.getReturnType()))).toString();
    }

    private String desc(TypeMirror t) {
      return switch (t.getKind()) {
        case BOOLEAN -> "Z"; case BYTE -> "B"; case CHAR -> "C"; case SHORT -> "S"; case INT -> "I";
        case LONG -> "J"; case FLOAT -> "F"; case DOUBLE -> "D"; case VOID -> "V";
        case ARRAY -> "[" + desc(((ArrayType) t).getComponentType());
        case DECLARED -> "L" + binary(t).replace('.', '/') + ";";
        default -> "Ljava/lang/Object;";
      };
    }
  }
}
