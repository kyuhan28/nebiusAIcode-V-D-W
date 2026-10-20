package codeviz.runner;

import com.sun.jdi.AbsentInformationException;
import com.sun.jdi.ArrayReference;
import com.sun.jdi.ArrayType;
import com.sun.jdi.Bootstrap;
import com.sun.jdi.BooleanValue;
import com.sun.jdi.CharValue;
import com.sun.jdi.ClassType;
import com.sun.jdi.DoubleValue;
import com.sun.jdi.Field;
import com.sun.jdi.FloatValue;
import com.sun.jdi.IncompatibleThreadStateException;
import com.sun.jdi.IntegerValue;
import com.sun.jdi.LocalVariable;
import com.sun.jdi.Location;
import com.sun.jdi.LongValue;
import com.sun.jdi.Method;
import com.sun.jdi.ObjectReference;
import com.sun.jdi.PrimitiveValue;
import com.sun.jdi.ReferenceType;
import com.sun.jdi.StackFrame;
import com.sun.jdi.StringReference;
import com.sun.jdi.ThreadReference;
import com.sun.jdi.Value;
import com.sun.jdi.VirtualMachine;
import com.sun.jdi.VoidValue;
import com.sun.jdi.connect.AttachingConnector;
import com.sun.jdi.connect.Connector;
import com.sun.jdi.event.BreakpointEvent;
import com.sun.jdi.event.ClassPrepareEvent;
import com.sun.jdi.event.Event;
import com.sun.jdi.event.EventSet;
import com.sun.jdi.event.ExceptionEvent;
import com.sun.jdi.event.LocatableEvent;
import com.sun.jdi.event.MethodExitEvent;
import com.sun.jdi.event.VMDeathEvent;
import com.sun.jdi.event.VMDisconnectEvent;
import com.sun.jdi.request.BreakpointRequest;
import com.sun.jdi.request.ClassPrepareRequest;
import com.sun.jdi.request.EventRequest;
import com.sun.jdi.request.EventRequestManager;
import com.sun.jdi.request.ExceptionRequest;
import com.sun.jdi.request.MethodExitRequest;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * Runs inside the sandbox. Launches the user's program suspended under JDWP on loopback,
 * attaches the Java Debug Interface, and steps line by line through user code only,
 * recording a snapshot of the call stack and reachable objects at every step.
 *
 * Usage: TraceMain <requestFile> <resultFile>
 */
public final class TraceMain {
  private static final String[] EXCLUDE = {"java.*", "javax.*", "jdk.*", "sun.*", "com.sun.*"};
  private static final int MAX_FRAMES = 16;
  private static final int MAX_OBJECTS = 300;
  private static final int MAX_ITEMS = 256;
  private static final int MAX_STRING = 300;

  private final Set<String> userClasses;
  /** User classes seen so far, so their static fields can be recorded alongside the stack. */
  private final List<ReferenceType> preparedTypes = new ArrayList<>();
  private final int maxSteps;
  private final Json.Writer steps = new Json.Writer(12L * 1024 * 1024);
  private int stepCount;
  private IoTracer io;
  private String lastHeap = "";
  private String stopReason;
  private Map<String, Object> exception;
  private final StringBuilder stdout = new StringBuilder();
  private final int maxOutput;
  private boolean stdoutTruncated;

  /**
   * Frame identity. JDI stack frames are only valid while a thread is suspended, so every active
   * user-code invocation gets its own id here, bottom (outermost) first, one list per thread. A
   * frame is pushed when a step first sees it and popped on its real method-exit event, so two
   * calls of the same method (recursion, or one call after another) never share an id.
   */
  private record Active(long id, Method method) {}
  private final Map<Long, List<Active>> shadows = new HashMap<>();
  private long nextFrameId = 1;
  /** Frames whose parameter names were already sent; and the last declared-type table sent per frame. */
  private final Set<Long> announced = new HashSet<>();
  private final Map<Long, String> lastTypes = new HashMap<>();
  /** Declared field types of every prepared user class, sent once instead of with every object. */
  private final Map<String, Object> classInfo = new LinkedHashMap<>();
  private MethodExitRequest exitReq;

  private TraceMain(Set<String> userClasses, int maxSteps, int maxOutput) {
    this.userClasses = userClasses;
    this.maxSteps = maxSteps;
    this.maxOutput = maxOutput;
  }

  @SuppressWarnings("unchecked")
  public static void main(String[] args) throws Exception {
    Map<String, Object> req = (Map<String, Object>) Json.parse(Files.readString(Path.of(args[0])));
    Path resultFile = Path.of(args[1]);
    List<String> javaCmd = (List<String>) (List<?>) req.get("command");
    Set<String> classes = new HashSet<>((List<String>) (List<?>) req.get("classes"));
    int maxSteps = ((Number) req.get("maxSteps")).intValue();
    int maxOutput = ((Number) req.get("maxOutput")).intValue();
    long deadline = System.currentTimeMillis() + ((Number) req.get("timeoutMs")).longValue();
    byte[] stdin = ((String) req.getOrDefault("stdin", "")).getBytes(StandardCharsets.UTF_8);

    TraceMain t = new TraceMain(classes, maxSteps, maxOutput);
    Map<String, Object> result = t.run(javaCmd, (String) req.get("mainClass"), stdin, deadline);
    Files.writeString(resultFile, Json.write(result), StandardCharsets.UTF_8);
  }

  private Map<String, Object> run(List<String> javaCmd, String mainClass, byte[] stdin, long deadline) throws Exception {
    List<String> cmd = new ArrayList<>(javaCmd);
    int cp = cmd.indexOf("-cp");
    cmd.add(cp, "-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:0");
    Process proc = new ProcessBuilder(cmd).start();
    BufferedReader out = new BufferedReader(new InputStreamReader(proc.getInputStream(), StandardCharsets.UTF_8));

    /* The JDWP agent announces its port on stdout before the program starts. */
    String first = out.readLine();
    if (first == null || !first.contains("address:")) {
      proc.destroyForcibly();
      throw new IllegalStateException("The debugger could not start the program.");
    }
    int port = Integer.parseInt(first.substring(first.lastIndexOf(':') + 1).trim());

    Thread outReader = new Thread(() -> {
      char[] buf = new char[4096];
      try {
        int n;
        while ((n = out.read(buf)) != -1) {
          synchronized (stdout) {
            int room = maxOutput - stdout.length();
            if (room > 0) stdout.append(buf, 0, Math.min(room, n));
            if (n > room) stdoutTruncated = true;
          }
        }
      } catch (Exception ignored) {}
    });
    outReader.setDaemon(true);
    outReader.start();
    ChildProcess.Capture err = new ChildProcess.Capture(proc.getErrorStream(), maxOutput);
    try (OutputStream os = proc.getOutputStream()) {
      if (stdin.length > 0) os.write(stdin);
    } catch (Exception ignored) {}

    VirtualMachine vm = attach(port);
    Thread watchdog = new Thread(() -> {
      try {
        while (proc.isAlive()) {
          if (System.currentTimeMillis() > deadline) {
            stopReason = "timeout";
            proc.destroyForcibly();
            return;
          }
          Thread.sleep(50);
        }
      } catch (InterruptedException ignored) {}
    });
    watchdog.setDaemon(true);
    watchdog.start();

    steps.raw("[");
    try {
      loop(vm, mainClass);
    } catch (com.sun.jdi.VMDisconnectedException ignored) {
      /* The program finished or was stopped. */
    }
    steps.raw("]");

    if (!proc.waitFor(3, TimeUnit.SECONDS)) proc.destroyForcibly();
    proc.waitFor(2, TimeUnit.SECONDS);
    outReader.join(1000);

    Map<String, Object> res = new LinkedHashMap<>();
    res.put("steps", new Json.RawJson(steps.toString()));
    res.put("stepCount", stepCount);
    res.put("truncated", stopReason != null);
    res.put("stopReason", stopReason);
    synchronized (stdout) {
      res.put("stdout", stdout.toString());
    }
    res.put("stdoutTruncated", stdoutTruncated);
    res.put("stderr", err.text());
    res.put("stderrTruncated", err.truncated);
    res.put("exitCode", proc.isAlive() ? -1 : proc.exitValue());
    res.put("exception", exception);
    /* Recorded input operations, and the exact stdin they read from, for the input visualizer. */
    res.put("io", io == null ? List.of() : io.events());
    res.put("ioTruncated", io != null && io.truncated());
    res.put("stdin", new String(stdin, StandardCharsets.UTF_8));
    res.put("classes", classInfo);
    return res;
  }

  private static VirtualMachine attach(int port) throws Exception {
    AttachingConnector socket = Bootstrap.virtualMachineManager().attachingConnectors().stream()
        .filter(c -> c.name().equals("com.sun.jdi.SocketAttach"))
        .findFirst().orElseThrow();
    Map<String, Connector.Argument> a = socket.defaultArguments();
    a.get("hostname").setValue("127.0.0.1");
    a.get("port").setValue(String.valueOf(port));
    a.get("timeout").setValue("10000");
    return socket.attach(a);
  }

  /**
   * A breakpoint at the start of every executable line of every user class. Unlike line
   * stepping, this also fires when a loop jumps back to the same line, so tight loops are
   * recorded (and stopped by the step limit) instead of going silent.
   */
  private void loop(VirtualMachine vm, String mainClass) throws Exception {
    EventRequestManager erm = vm.eventRequestManager();
    ClassPrepareRequest prepare = erm.createClassPrepareRequest();
    for (String ex : EXCLUDE) prepare.addClassExclusionFilter(ex);
    prepare.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
    prepare.enable();
    ExceptionRequest exReq = erm.createExceptionRequest(null, false, true);
    exReq.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
    exReq.enable();
    io = new IoTracer(vm, erm, userClasses, () -> stepCount);
    io.install();
    /* Real returns from user methods, with their values. JDK classes are filtered out by the agent. */
    exitReq = erm.createMethodExitRequest();
    for (String ex : EXCLUDE) exitReq.addClassExclusionFilter(ex);
    exitReq.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
    exitReq.enable();
    vm.resume();

    while (true) {
      EventSet set = vm.eventQueue().remove(500);
      if (set == null) continue;
      /* Events at one location can arrive together; a method's last line runs before it returns. */
      List<Event> ordered = new ArrayList<>();
      set.forEach(ordered::add);
      ordered.sort((x, y) -> Boolean.compare(x instanceof MethodExitEvent, y instanceof MethodExitEvent));
      for (Event ev : ordered) {
        if (ev instanceof VMDeathEvent || ev instanceof VMDisconnectEvent) return;
        if (io.handle(ev)) continue;
        if (ev instanceof ClassPrepareEvent cpe) {
          ReferenceType type = cpe.referenceType();
          if (!userClasses.contains(type.name())) continue;
          preparedTypes.add(type);
          describeClass(type);
          for (Method m : type.methods()) {
            if (m.isAbstract() || m.isNative()) continue;
            try {
              /* Every code range of every line, not just the first: a for-each header's
                 hasNext()/next() live in a second range, and without it the header would only
                 pause once instead of on each pass. */
              java.util.Set<Long> seen = new java.util.HashSet<>();
              for (Location line : m.allLineLocations()) {
                for (Location loc : m.locationsOfLine(line.lineNumber())) {
                  if (!seen.add(loc.codeIndex())) continue;
                  BreakpointRequest bp = erm.createBreakpointRequest(loc);
                  bp.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
                  bp.enable();
                }
              }
            } catch (AbsentInformationException ignored) {}
          }
        } else if (ev instanceof BreakpointEvent be) {
          record(be, "line");
        } else if (ev instanceof ExceptionEvent ee) {
          describeException(ee);
          record(ee, "exception");
        } else if (ev instanceof MethodExitEvent me && me.request() == exitReq) {
          onExit(me);
        }
        if (stepCount >= maxSteps || steps.full()) {
          stopReason = steps.full() ? "trace_size" : "max_steps";
          try { vm.exit(0); } catch (Exception ignored) {}
          return;
        }
      }
      set.resume();
    }
  }

  private void describeException(ExceptionEvent ee) {
    ObjectReference ex = ee.exception();
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("type", ex.referenceType().name());
    Value msg = readField(ex, "detailMessage");
    m.put("message", msg instanceof StringReference s ? s.value() : null);
    try {
      for (StackFrame f : ee.thread().frames()) {
        Location loc = f.location();
        if (userClasses.contains(loc.declaringType().name())) {
          m.put("sourcePath", sourcePath(loc));
          m.put("line", loc.lineNumber());
          m.put("method", loc.method().name());
          break;
        }
      }
    } catch (IncompatibleThreadStateException ignored) {}
    exception = m;
  }

  /* ---------------- Snapshots ---------------- */

  private void record(LocatableEvent ev, String kind) throws Exception {
    record(ev, kind, null);
  }

  private void record(LocatableEvent ev, String kind, Value returned) throws Exception {
    Location loc = ev.location();
    ThreadReference thread = ev.thread();
    List<StackFrame> frames = thread.frames();
    StackFrame top = null;
    for (StackFrame f : frames) {
      if (userClasses.contains(f.location().declaringType().name()) && f.location().lineNumber() > 0) {
        top = f;
        break;
      }
    }
    if (top == null) return;
    if (!kind.equals("exception") && !userClasses.contains(loc.declaringType().name())) return;
    loc = top.location();

    Json.Writer w = new Json.Writer();
    ArrayDeque<ObjectReference> pending = new ArrayDeque<>();
    Set<Long> queued = new HashSet<>();

    w.raw("{\"kind\":").str(kind)
        .raw(",\"line\":").raw(String.valueOf(loc.lineNumber()))
        .raw(",\"sourcePath\":").str(sourcePath(loc))
        .raw(",\"cls\":").str(loc.declaringType().name())
        .raw(",\"method\":").str(loc.method().name());
    synchronized (stdout) {
      w.raw(",\"out\":").raw(String.valueOf(stdout.length()));
    }

    /* Every user-code frame, innermost first, with the id of the invocation it belongs to. */
    List<StackFrame> user = new ArrayList<>();
    for (StackFrame f : frames) if (userClasses.contains(f.location().declaringType().name())) user.add(f);
    long[] ids = frameIds(thread, user);
    w.raw(",\"stackDepth\":").raw(String.valueOf(user.size()));
    if (returned != null) {
      w.raw(",\"ret\":");
      if (returned instanceof VoidValue) w.raw("{\"t\":\"void\"}");
      else value(w, returned, pending, queued);
      w.raw(",\"retType\":").str(loc.method().returnTypeName());
    }

    w.raw(",\"stack\":[");
    for (int i = 0; i < user.size() && i < MAX_FRAMES; i++) {
      StackFrame f = user.get(i);
      Location fl = f.location();
      if (i > 0) w.raw(",");
      w.raw("{\"id\":").raw(String.valueOf(ids[i]))
          .raw(",\"depth\":").raw(String.valueOf(user.size() - 1 - i))
          .raw(",\"cls\":").str(fl.declaringType().name())
          .raw(",\"method\":").str(fl.method().name())
          .raw(",\"line\":").raw(String.valueOf(fl.lineNumber()));
      /* Parameter names, once per invocation: the frame header shows the call's own arguments. */
      if (announced.add(ids[i])) {
        w.raw(",\"args\":[");
        try {
          List<LocalVariable> params = fl.method().arguments();
          for (int k = 0; k < params.size(); k++) w.raw(k > 0 ? "," : "").str(params.get(k).name());
        } catch (AbsentInformationException ignored) {}
        w.raw("]");
      }
      w.raw(",\"locals\":{");
      boolean firstVar = true;
      Json.Writer types = new Json.Writer();
      types.raw("{");
      ObjectReference self = f.thisObject();
      if (self != null) {
        w.str("this").raw(":");
        value(w, self, pending, queued);
        types.str("this").raw(":").str(fl.declaringType().name());
        firstVar = false;
      }
      try {
        List<LocalVariable> vars = f.visibleVariables();
        Map<LocalVariable, Value> vals = f.getValues(vars);
        for (LocalVariable v : vars) {
          if (!firstVar) { w.raw(","); types.raw(","); }
          firstVar = false;
          w.str(v.name()).raw(":");
          value(w, vals.get(v), pending, queued);
          types.str(v.name()).raw(":").str(declaredType(v.typeName(), v.genericSignature()));
        }
      } catch (AbsentInformationException ignored) {}
      w.raw("}");
      /* Declared types only when they differ from what was last sent for this frame. */
      String table = types.raw("}").toString();
      if (!table.equals(lastTypes.get(ids[i]))) {
        w.raw(",\"types\":").raw(table);
        lastTypes.put(ids[i], table);
      }
      w.raw("}");
    }
    w.raw("]");

    /* Static fields of user classes, e.g. a shared graph. Constants are skipped. */
    w.raw(",\"statics\":{");
    boolean firstStatic = true;
    int statics = 0;
    for (ReferenceType type : preparedTypes) {
      for (Field f : type.fields()) {
        if (!f.isStatic() || f.isSynthetic() || statics >= 24) continue;
        if (f.isFinal() && (f.typeName().equals("java.lang.String") || !f.typeName().contains("."))) continue;
        Value v;
        try { v = type.getValue(f); } catch (Exception e) { continue; }
        if (!firstStatic) w.raw(",");
        firstStatic = false;
        w.str(type.name() + "." + f.name()).raw(":");
        value(w, v, pending, queued);
        statics++;
      }
    }
    w.raw("}");

    /* Heap: everything reachable from the stack and statics, bounded. Omitted when unchanged. */
    Json.Writer h = new Json.Writer();
    h.raw("{");
    int count = 0;
    boolean firstObj = true;
    while (!pending.isEmpty() && count < MAX_OBJECTS) {
      ObjectReference o = pending.poll();
      if (!firstObj) h.raw(",");
      firstObj = false;
      h.str(String.valueOf(o.uniqueID())).raw(":");
      object(h, o, pending, queued);
      count++;
    }
    h.raw("}");
    String heap = h.toString();
    if (heap.equals(lastHeap)) {
      w.raw(",\"heap\":null");
    } else {
      w.raw(",\"heap\":").raw(heap);
      lastHeap = heap;
    }
    if (count >= MAX_OBJECTS) w.raw(",\"heapTruncated\":true");
    w.raw("}");

    if (stepCount > 0) steps.raw(",");
    steps.raw(w.toString());
    stepCount++;
  }

  /* ---------------- Calls and returns ---------------- */

  /**
   * Matches the thread's user frames (innermost first) to invocation ids, bottom up. Frames that
   * are still the same method keep their id; the first mismatch and everything above it is new.
   * Returns are popped on their exit events, so a later call of the same method gets a new id.
   */
  private long[] frameIds(ThreadReference thread, List<StackFrame> userTopFirst) {
    List<Active> shadow = shadows.computeIfAbsent(thread.uniqueID(), k -> new ArrayList<>());
    int n = userTopFirst.size();
    int keep = 0;
    while (keep < shadow.size() && keep < n && shadow.get(keep).method().equals(userTopFirst.get(n - 1 - keep).location().method())) keep++;
    while (shadow.size() > keep) forget(shadow.remove(shadow.size() - 1));
    while (shadow.size() < n) shadow.add(new Active(nextFrameId++, userTopFirst.get(n - 1 - shadow.size()).location().method()));
    long[] ids = new long[n];
    for (int i = 0; i < n; i++) ids[i] = shadow.get(n - 1 - i).id();
    return ids;
  }

  private void forget(Active a) {
    lastTypes.remove(a.id());
  }

  /**
   * A user method is returning: record a "return" step with the real value while its frame is
   * still on the stack, then pop it. Constructors, static initializers, and compiler-generated
   * methods (lambda bodies, bridges) are popped without a step of their own.
   */
  private void onExit(MethodExitEvent me) throws Exception {
    Method m = me.method();
    if (!userClasses.contains(m.declaringType().name())) return;
    boolean visible = !m.isConstructor() && !m.isStaticInitializer() && !m.isSynthetic() && !m.isBridge();
    if (visible) {
      try {
        record(me, "return", me.returnValue());
      } catch (com.sun.jdi.VMDisconnectedException e) {
        throw e;
      } catch (Exception e) {
        /* A return that cannot be read is skipped rather than ending the whole recording. */
      }
    }
    List<Active> shadow = shadows.get(me.thread().uniqueID());
    if (shadow != null && !shadow.isEmpty() && shadow.get(shadow.size() - 1).method().equals(m)) forget(shadow.remove(shadow.size() - 1));
  }

  /** Declared field types of a user class, recorded once when the class is prepared. */
  private void describeClass(ReferenceType type) {
    Map<String, Object> fields = new LinkedHashMap<>();
    Map<String, Object> statics = new LinkedHashMap<>();
    for (Field f : type.fields()) {
      if (f.isSynthetic()) continue;
      (f.isStatic() ? statics : fields).put(f.name(), declaredType(f.typeName(), f.genericSignature()));
    }
    Map<String, Object> info = new LinkedHashMap<>();
    info.put("fields", fields);
    info.put("statics", statics);
    if (type instanceof ClassType ct && ct.superclass() != null && userClasses.contains(ct.superclass().name())) info.put("super", ct.superclass().name());
    classInfo.put(type.name(), info);
  }

  /**
   * A declared type in Java syntax, with generic arguments when the class file has them
   * (java.util.Map<java.lang.String, java.lang.Integer>, int[][]). Falls back to the erased type.
   */
  static String declaredType(String erased, String generic) {
    if (generic == null || generic.isEmpty()) return erased;
    try {
      int[] p = {0};
      String t = signature(generic, p);
      return p[0] == generic.length() ? t : erased;
    } catch (RuntimeException e) {
      return erased;
    }
  }

  private static String signature(String s, int[] p) {
    char c = s.charAt(p[0]++);
    switch (c) {
      case 'B': return "byte";
      case 'C': return "char";
      case 'D': return "double";
      case 'F': return "float";
      case 'I': return "int";
      case 'J': return "long";
      case 'S': return "short";
      case 'Z': return "boolean";
      case 'V': return "void";
      case '[': return signature(s, p) + "[]";
      case 'T': {
        int end = s.indexOf(';', p[0]);
        String name = s.substring(p[0], end);
        p[0] = end + 1;
        return name;
      }
      case 'L': {
        StringBuilder b = new StringBuilder();
        while (true) {
          char d = s.charAt(p[0]);
          if (d == ';') { p[0]++; return b.toString(); }
          if (d == '<') {
            p[0]++;
            b.append('<');
            for (boolean first = true; s.charAt(p[0]) != '>'; first = false) b.append(first ? "" : ", ").append(typeArgument(s, p));
            p[0]++;
            b.append('>');
          } else if (d == '.') { p[0]++; b.append('$'); }
          else { p[0]++; b.append(d == '/' ? '.' : d); }
        }
      }
      default: throw new IllegalArgumentException("Unexpected signature character " + c);
    }
  }

  private static String typeArgument(String s, int[] p) {
    char c = s.charAt(p[0]);
    if (c == '*') { p[0]++; return "?"; }
    if (c == '+') { p[0]++; return "? extends " + signature(s, p); }
    if (c == '-') { p[0]++; return "? super " + signature(s, p); }
    return signature(s, p);
  }

  private static String sourcePath(Location loc) {
    try { return loc.sourcePath(); } catch (AbsentInformationException e) { return null; }
  }

  private static final Set<String> BOXED = Set.of("java.lang.Integer", "java.lang.Long", "java.lang.Short",
      "java.lang.Byte", "java.lang.Double", "java.lang.Float", "java.lang.Boolean", "java.lang.Character");

  private void value(Json.Writer w, Value v, ArrayDeque<ObjectReference> pending, Set<Long> queued) {
    if (v == null) { w.raw("{\"t\":\"null\"}"); return; }
    if (v instanceof PrimitiveValue p) { primitive(w, p, p.type().name()); return; }
    if (v instanceof StringReference s) {
      String text = s.value();
      w.raw("{\"t\":\"String\",\"v\":").str(text.length() > MAX_STRING ? text.substring(0, MAX_STRING) + "…" : text).raw("}");
      return;
    }
    ObjectReference o = (ObjectReference) v;
    String type = o.referenceType().name();
    if (BOXED.contains(type)) {
      Value inner = readField(o, "value");
      if (inner instanceof PrimitiveValue p) { primitive(w, p, type.substring("java.lang.".length())); return; }
    }
    if (queued.add(o.uniqueID())) pending.add(o);
    w.raw("{\"t\":\"ref\",\"id\":").str(String.valueOf(o.uniqueID())).raw("}");
  }

  private static void primitive(Json.Writer w, PrimitiveValue p, String type) {
    w.raw("{\"t\":").str(type).raw(",\"v\":");
    if (p instanceof BooleanValue b) w.raw(String.valueOf(b.value()));
    else if (p instanceof CharValue c) w.str(String.valueOf(c.value()));
    else if (p instanceof DoubleValue d) w.raw(Double.isFinite(d.value()) ? String.valueOf(d.value()) : "null");
    else if (p instanceof FloatValue f) w.raw(Float.isFinite(f.value()) ? String.valueOf(f.value()) : "null");
    else if (p instanceof LongValue l) w.raw(String.valueOf(l.value()));
    else if (p instanceof IntegerValue i) w.raw(String.valueOf(i.value()));
    else w.raw(String.valueOf(p.longValue()));
    w.raw("}");
  }

  private static Value readField(ObjectReference o, String name) {
    Field f = o.referenceType().fieldByName(name);
    return f == null ? null : o.getValue(f);
  }

  private static int intField(ObjectReference o, String name) {
    return readField(o, name) instanceof PrimitiveValue p ? p.intValue() : 0;
  }

  /** Arrays, user objects, and the internals of common java.util collections. */
  private void object(Json.Writer w, ObjectReference o, ArrayDeque<ObjectReference> pending, Set<Long> queued) {
    String type = o.referenceType().name();
    if (o instanceof ArrayReference arr) {
      int len = arr.length();
      int n = Math.min(len, MAX_ITEMS);
      w.raw("{\"t\":\"array\",\"of\":").str(((ArrayType) arr.referenceType()).componentTypeName())
          .raw(",\"len\":").raw(String.valueOf(len)).raw(",\"items\":[");
      List<Value> vals = n == 0 ? List.of() : arr.getValues(0, n);
      for (int i = 0; i < vals.size(); i++) {
        if (i > 0) w.raw(",");
        value(w, vals.get(i), pending, queued);
      }
      w.raw("]}");
      return;
    }
    if (userClasses.contains(type)) {
      w.raw("{\"t\":\"object\",\"cls\":").str(type).raw(",\"fields\":{");
      boolean first = true;
      for (Field f : o.referenceType().allFields()) {
        if (f.isStatic() || f.isSynthetic()) continue;
        if (!first) w.raw(",");
        first = false;
        w.str(f.name()).raw(":");
        value(w, o.getValue(f), pending, queued);
      }
      w.raw("}}");
      return;
    }
    List<Value> items = new ArrayList<>();
    List<Value[]> entries = new ArrayList<>();
    List<Integer> buckets = new ArrayList<>();
    int[] capacity = {0};
    String shape = collection(o, type, items, entries, buckets, capacity);
    if (shape == null) {
      w.raw("{\"t\":\"opaque\",\"cls\":").str(type).raw("}");
      return;
    }
    w.raw("{\"t\":").str(shape).raw(",\"cls\":").str(type);
    if (!buckets.isEmpty()) {
      w.raw(",\"capacity\":" + capacity[0] + ",\"buckets\":[");
      for (int i = 0; i < buckets.size(); i++) w.raw((i > 0 ? "," : "") + buckets.get(i));
      w.raw("]");
    }
    if (shape.equals("map")) {
      w.raw(",\"entries\":[");
      for (int i = 0; i < entries.size(); i++) {
        if (i > 0) w.raw(",");
        w.raw("[");
        value(w, entries.get(i)[0], pending, queued);
        w.raw(",");
        value(w, entries.get(i)[1], pending, queued);
        w.raw("]");
      }
    } else {
      w.raw(",\"items\":[");
      for (int i = 0; i < items.size(); i++) {
        if (i > 0) w.raw(",");
        value(w, items.get(i), pending, queued);
      }
    }
    w.raw("]}");
  }

  /** Reads JDK collection internals directly, without running any code in the traced program. */
  private static String collection(ObjectReference o, String type, List<Value> items, List<Value[]> entries, List<Integer> buckets, int[] capacity) {
    switch (type) {
      case "java.util.ArrayList", "java.util.Vector", "java.util.Stack" -> {
        int size = intField(o, type.equals("java.util.ArrayList") ? "size" : "elementCount");
        if (readField(o, "elementData") instanceof ArrayReference a) {
          int n = Math.min(Math.min(size, a.length()), MAX_ITEMS);
          if (n > 0) items.addAll(a.getValues(0, n));
        }
        return type.equals("java.util.Stack") ? "stack" : "list";
      }
      case "java.util.Arrays$ArrayList" -> {
        if (readField(o, "a") instanceof ArrayReference a && a.length() > 0)
          items.addAll(a.getValues(0, Math.min(a.length(), MAX_ITEMS)));
        return "list";
      }
      case "java.util.LinkedList" -> {
        Value node = readField(o, "first");
        while (node instanceof ObjectReference n && items.size() < MAX_ITEMS) {
          items.add(readField(n, "item"));
          node = readField(n, "next");
        }
        return "list";
      }
      case "java.util.ArrayDeque" -> {
        if (readField(o, "elements") instanceof ArrayReference a && a.length() > 0) {
          int head = intField(o, "head");
          int tail = intField(o, "tail");
          for (int i = head; i != tail && items.size() < MAX_ITEMS; i = (i + 1) % a.length()) items.add(a.getValue(i));
        }
        return "deque";
      }
      case "java.util.PriorityQueue" -> {
        int size = intField(o, "size");
        if (readField(o, "queue") instanceof ArrayReference a && size > 0)
          items.addAll(a.getValues(0, Math.min(Math.min(size, a.length()), MAX_ITEMS)));
        return "heap";
      }
      case "java.util.HashMap", "java.util.LinkedHashMap" -> {
        mapEntries(o, type, entries, buckets, capacity);
        return "map";
      }
      case "java.util.HashSet", "java.util.LinkedHashSet" -> {
        if (readField(o, "map") instanceof ObjectReference m) {
          mapEntries(m, m.referenceType().name(), entries, buckets, capacity);
          for (Value[] e : entries) items.add(e[0]);
          entries.clear();
        }
        return "set";
      }
      case "java.util.TreeMap" -> {
        treeEntries(readField(o, "root"), entries);
        return "map";
      }
      case "java.util.TreeSet" -> {
        if (readField(o, "m") instanceof ObjectReference m && m.referenceType().name().equals("java.util.TreeMap")) {
          treeEntries(readField(m, "root"), entries);
          for (Value[] e : entries) items.add(e[0]);
          entries.clear();
        }
        return "set";
      }
      default -> {
        return null;
      }
    }
  }

  /**
   * Entries of a HashMap or LinkedHashMap, with each entry's real bucket: (capacity - 1) & hash,
   * exactly as HashMap indexes its table, using the hash stored on the node itself.
   */
  private static void mapEntries(ObjectReference map, String type, List<Value[]> entries, List<Integer> buckets, int[] capacity) {
    int cap = readField(map, "table") instanceof ArrayReference t ? t.length() : 0;
    capacity[0] = cap;
    if (type.equals("java.util.LinkedHashMap")) {
      Value e = readField(map, "head");
      while (e instanceof ObjectReference n && entries.size() < MAX_ITEMS) {
        entries.add(new Value[] {readField(n, "key"), readField(n, "value")});
        if (cap > 0) buckets.add((cap - 1) & intField(n, "hash"));
        e = readField(n, "after");
      }
      return;
    }
    if (!(readField(map, "table") instanceof ArrayReference table)) return;
    List<Value> slots = table.getValues();
    for (int i = 0; i < slots.size(); i++) {
      Value e = slots.get(i);
      while (e instanceof ObjectReference n && entries.size() < MAX_ITEMS) {
        entries.add(new Value[] {readField(n, "key"), readField(n, "value")});
        buckets.add(i);
        e = readField(n, "next");
      }
    }
  }

  private static void treeEntries(Value node, List<Value[]> entries) {
    if (!(node instanceof ObjectReference n) || entries.size() >= MAX_ITEMS) return;
    treeEntries(readField(n, "left"), entries);
    entries.add(new Value[] {readField(n, "key"), readField(n, "value")});
    treeEntries(readField(n, "right"), entries);
  }

  @SuppressWarnings("unused")
  private static boolean isClass(ReferenceType t) { return t instanceof ClassType; }
}
