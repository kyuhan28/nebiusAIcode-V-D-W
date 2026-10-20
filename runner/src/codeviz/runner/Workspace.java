package codeviz.runner;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/** A disposable directory for one execution. Paths from the request are validated before use. */
public final class Workspace implements AutoCloseable {
  public record SourceFile(String path, String content) {}
  public record EntryPoint(String className, String path) {}

  private static final Pattern SAFE_PATH = Pattern.compile("^[A-Za-z0-9_$][A-Za-z0-9_$.\\-]*(/[A-Za-z0-9_$][A-Za-z0-9_$.\\-]*)*\\.(java|py|c|h|cpp|cc|cxx|hpp|hh|hxx|txt|csv|tsv|json|md|xml|ya?ml|toml|ini|cfg)$");
  private static final Pattern PACKAGE = Pattern.compile("(?m)^\\s*package\\s+([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)\\s*;");
  private static final Pattern MAIN = Pattern.compile("static\\s+(?:final\\s+)?void\\s+main\\s*\\(\\s*(?:final\\s+)?String\\s*(?:\\[\\s*]\\s*\\w+|\\.\\.\\.\\s*\\w+|\\w+\\s*\\[\\s*])");
  private static final Pattern TYPE = Pattern.compile("(?m)^\\s*(?:public\\s+|final\\s+|abstract\\s+)*(?:class|record|enum|interface)\\s+([A-Za-z_$][\\w$]*)");

  final Path root;
  final Path src;
  final Path out;
  final Path tmp;
  final List<SourceFile> files;

  private Workspace(Path root, List<SourceFile> files) throws IOException {
    this.root = root;
    this.src = Files.createDirectories(root.resolve("src"));
    this.out = Files.createDirectories(root.resolve("out"));
    this.tmp = Files.createDirectories(root.resolve("tmp"));
    this.files = files;
  }

  /** Validates the request's files and writes them under a fresh directory. */
  static Workspace create(Config cfg, List<SourceFile> files) throws IOException, RunnerException {
    validate(cfg, files);
    Files.createDirectories(cfg.workRoot());
    Workspace ws = new Workspace(Files.createDirectory(cfg.workRoot().resolve(UUID.randomUUID().toString())), files);
    for (SourceFile f : files) {
      Path target = ws.src.resolve(f.path()).normalize();
      if (!target.startsWith(ws.src)) {
        ws.close();
        throw new RunnerException(400, "bad_path", "File path escapes the project: " + f.path());
      }
      Files.createDirectories(target.getParent());
      Files.writeString(target, f.content(), StandardCharsets.UTF_8);
    }
    return ws;
  }

  /** Checked when the request arrives, so bad uploads are refused before anything is queued. */
  static void validate(Config cfg, List<SourceFile> files) throws RunnerException {
    if (files.isEmpty()) throw new RunnerException(400, "no_files", "Add at least one .java or .py file.");
    if (files.size() > cfg.maxFiles()) throw new RunnerException(413, "too_many_files", "Projects are limited to " + cfg.maxFiles() + " files.");
    long total = 0;
    for (SourceFile f : files) {
      if (f.path() == null || !SAFE_PATH.matcher(f.path()).matches() || f.path().contains(".."))
        throw new RunnerException(400, "bad_path", "File paths must be relative paths to source files (.java, .py, .c, .h, .cpp, .hpp, ...) or data files (.txt, .csv, .json, ...) without '..': " + f.path());
      total += f.content().getBytes(StandardCharsets.UTF_8).length;
    }
    if (total > cfg.maxSourceBytes()) throw new RunnerException(413, "too_large", "Source files are limited to " + (cfg.maxSourceBytes() / 1024) + " KB in total.");
    java.util.Set<String> seen = new java.util.HashSet<>();
    for (SourceFile f : files) {
      if (!seen.add(f.path())) throw new RunnerException(400, "duplicate_path", "Two files share the path " + f.path());
    }
  }

  /** Classes that declare a main method, as fully qualified names. */
  static List<EntryPoint> entryPoints(List<SourceFile> files) {
    List<EntryPoint> found = new ArrayList<>();
    for (SourceFile f : files) {
      if (!f.path().endsWith(".java")) continue;
      String code = stripComments(f.content());
      if (!MAIN.matcher(code).find()) continue;
      Matcher pkg = PACKAGE.matcher(code);
      String prefix = pkg.find() ? pkg.group(1) + "." : "";
      String fileClass = f.path().substring(f.path().lastIndexOf('/') + 1).replace(".java", "");
      Matcher type = TYPE.matcher(code);
      String name = type.find() ? type.group(1) : fileClass;
      /* Prefer the class named after the file, which is where javac requires a public class to live. */
      if (code.matches("(?s).*\\b(class|record|enum|interface)\\s+" + Pattern.quote(fileClass) + "\\b.*")) name = fileClass;
      found.add(new EntryPoint(prefix + name, f.path()));
    }
    return found;
  }

  static String stripComments(String code) {
    return code.replaceAll("(?s)/\\*.*?\\*/", " ").replaceAll("//[^\\n]*", " ");
  }

  List<Path> sourcePaths() throws IOException {
    try (Stream<Path> s = Files.walk(src)) {
      return s.filter(p -> p.toString().endsWith(".java")).sorted().toList();
    }
  }

  /** Every compiled class name, used to tell user code apart from the JDK while tracing. */
  List<String> compiledClasses() throws IOException {
    try (Stream<Path> s = Files.walk(out)) {
      return s.filter(p -> p.toString().endsWith(".class"))
          .map(p -> out.relativize(p).toString().replace('/', '.').replaceAll("\\.class$", ""))
          .toList();
    }
  }

  String relative(Path p) {
    return src.relativize(p).toString();
  }

  /**
   * Removes the job folder. Never throws: a folder the runner cannot read or delete (one a Docker
   * sandbox user created) is left behind with a note in the log, and the run's result stands.
   */
  @Override
  public void close() {
    try (Stream<Path> s = Files.walk(root)) {
      s.sorted(Comparator.reverseOrder()).forEach(p -> {
        try { Files.deleteIfExists(p); } catch (IOException ignored) {}
      });
    } catch (IOException | RuntimeException e) {
      System.err.println("[runner] could not fully remove " + root + ": " + e);
    }
  }

  static List<SourceFile> fromRequest(Object raw) throws RunnerException {
    if (!(raw instanceof List<?> list)) throw new RunnerException(400, "bad_request", "files must be an array of { path, content }.");
    List<SourceFile> files = new ArrayList<>();
    for (Object o : list) {
      if (!(o instanceof Map<?, ?> m) || !(m.get("path") instanceof String p) || !(m.get("content") instanceof String c))
        throw new RunnerException(400, "bad_request", "Each file needs a string path and content.");
      files.add(new SourceFile(p.replace('\\', '/'), c));
    }
    return files;
  }
}
