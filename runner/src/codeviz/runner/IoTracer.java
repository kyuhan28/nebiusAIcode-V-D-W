package codeviz.runner;

import com.sun.jdi.ArrayReference;
import com.sun.jdi.Field;
import com.sun.jdi.Location;
import com.sun.jdi.Method;
import com.sun.jdi.ObjectReference;
import com.sun.jdi.PrimitiveValue;
import com.sun.jdi.ReferenceType;
import com.sun.jdi.StackFrame;
import com.sun.jdi.StringReference;
import com.sun.jdi.ThreadReference;
import com.sun.jdi.Value;
import com.sun.jdi.VirtualMachine;
import com.sun.jdi.event.BreakpointEvent;
import com.sun.jdi.event.ClassPrepareEvent;
import com.sun.jdi.event.Event;
import com.sun.jdi.event.ExceptionEvent;
import com.sun.jdi.event.MethodExitEvent;
import com.sun.jdi.request.BreakpointRequest;
import com.sun.jdi.request.ClassPrepareRequest;
import com.sun.jdi.request.EventRequest;
import com.sun.jdi.request.EventRequestManager;
import com.sun.jdi.request.ExceptionRequest;
import com.sun.jdi.request.MethodExitRequest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.IntSupplier;

/**
 * Records real input operations: Scanner reads, BufferedReader.readLine, StringTokenizer, and the
 * parse methods, each with its arguments and its actual return value or the exception that
 * escaped it. Only calls made directly by user code are recorded; the JDK's internal calls to the
 * same methods are ignored. Nothing is inferred from source text.
 */
final class IoTracer {
  private static final Map<String, Set<String>> WATCH = Map.of(
      "java.util.Scanner", Set.of("next", "nextLine", "nextInt", "nextLong", "nextDouble", "nextFloat", "nextBoolean", "nextShort", "nextByte",
          "hasNext", "hasNextInt", "hasNextLong", "hasNextDouble", "hasNextLine", "hasNextBoolean", "useDelimiter"),
      "java.io.BufferedReader", Set.of("readLine"),
      "java.util.StringTokenizer", Set.of("<init>", "nextToken", "hasMoreTokens", "countTokens"),
      "java.lang.Integer", Set.of("parseInt", "valueOf"),
      "java.lang.Long", Set.of("parseLong", "valueOf"),
      "java.lang.Double", Set.of("parseDouble", "valueOf"),
      "java.lang.Float", Set.of("parseFloat"),
      "java.lang.Boolean", Set.of("parseBoolean"));
  private static final int MAX_EVENTS = 2000;
  private static final int MAX_TEXT = 500;

  private final EventRequestManager erm;
  private final VirtualMachine vm;
  private final Set<String> userClasses;
  private final IntSupplier steps;
  private final List<Map<String, Object>> events = new ArrayList<>();
  private boolean truncated;

  /** The one watched call in progress; user code can only be inside one at a time per thread. */
  private Map<String, Object> pending;
  private Method pendingMethod;
  private int pendingDepth;
  private MethodExitRequest exitReq;
  private ExceptionRequest exReq;

  IoTracer(VirtualMachine vm, EventRequestManager erm, Set<String> userClasses, IntSupplier steps) {
    this.vm = vm;
    this.erm = erm;
    this.userClasses = userClasses;
    this.steps = steps;
  }

  void install() {
    for (String cls : WATCH.keySet()) {
      List<ReferenceType> loaded = vm.classesByName(cls);
      if (!loaded.isEmpty()) breakpoints(loaded.get(0));
      ClassPrepareRequest p = erm.createClassPrepareRequest();
      p.addClassFilter(cls);
      p.putProperty("io", Boolean.TRUE);
      p.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
      p.enable();
    }
  }

  private final Set<ReferenceType> armed = new java.util.HashSet<>();

  private void breakpoints(ReferenceType type) {
    if (!armed.add(type)) return;
    Set<String> names = WATCH.get(type.name());
    for (Method m : type.methods()) {
      if (!names.contains(m.name()) || m.isAbstract() || m.isNative() || m.location() == null) continue;
      /* Parse and valueOf methods only when they take a String: valueOf(int) is autoboxing. */
      if (type.name().startsWith("java.lang.") && !m.argumentTypeNames().isEmpty() && !m.argumentTypeNames().get(0).equals("java.lang.String")) continue;
      if (type.name().startsWith("java.lang.") && m.argumentTypeNames().isEmpty()) continue;
      BreakpointRequest bp = erm.createBreakpointRequest(m.location());
      bp.putProperty("io", Boolean.TRUE);
      bp.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
      bp.enable();
    }
  }

  /** Handles input-tracing events; returns false for everything else. */
  boolean handle(Event ev) throws Exception {
    if (ev instanceof ClassPrepareEvent cpe && cpe.request().getProperty("io") != null) {
      if (WATCH.containsKey(cpe.referenceType().name())) breakpoints(cpe.referenceType());
      return true;
    }
    if (ev instanceof BreakpointEvent be && be.request().getProperty("io") != null) {
      onEntry(be);
      return true;
    }
    if (ev instanceof MethodExitEvent me && me.request() == exitReq) {
      onExit(me);
      return true;
    }
    if (ev instanceof ExceptionEvent ee && ee.request() == exReq) {
      onException(ee);
      return true;
    }
    return false;
  }

  private void onEntry(BreakpointEvent be) throws Exception {
    if (pending != null || events.size() >= MAX_EVENTS) {
      if (events.size() >= MAX_EVENTS) truncated = true;
      return;
    }
    ThreadReference th = be.thread();
    if (th.frameCount() < 2) return;
    Location caller = th.frame(1).location();
    if (!userClasses.contains(caller.declaringType().name())) return;
    StackFrame f = th.frame(0);
    Method m = be.location().method();
    Map<String, Object> e = new LinkedHashMap<>();
    e.put("seq", events.size());
    e.put("cls", m.declaringType().name());
    e.put("op", m.name());
    ObjectReference self = m.isStatic() ? null : f.thisObject();
    e.put("receiver", self == null ? null : self.uniqueID());
    List<Object> args = new ArrayList<>();
    for (Value v : f.getArgumentValues()) args.add(text(v));
    e.put("args", args);
    e.put("file", safe(() -> caller.sourcePath()));
    e.put("line", caller.lineNumber());
    e.put("step", Math.max(0, steps.getAsInt() - 1));
    pending = e;
    pendingMethod = m;
    pendingDepth = th.frameCount();
    exitReq = erm.createMethodExitRequest();
    exitReq.addThreadFilter(th);
    exitReq.addClassFilter(m.declaringType());
    exitReq.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
    exitReq.enable();
    exReq = erm.createExceptionRequest(null, true, true);
    exReq.addThreadFilter(th);
    exReq.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
    exReq.enable();
  }

  private void onExit(MethodExitEvent me) throws Exception {
    if (pending == null || !me.method().equals(pendingMethod) || me.thread().frameCount() != pendingDepth) return;
    Value rv = me.returnValue();
    pending.put("ok", true);
    if (pendingMethod.isConstructor()) {
      /* A new StringTokenizer: record the text and delimiters it will split. */
      ObjectReference self = me.thread().frame(0).thisObject();
      pending.put("result", null);
      pending.put("type", "java.util.StringTokenizer");
      if (self != null) pending.put("text", text(field(self, "str")));
      if (self != null) pending.put("delimiters", text(field(self, "delimiters")));
    } else {
      pending.put("result", text(rv));
      pending.put("type", rv == null ? "null" : rv.type().name());
    }
    finish();
  }

  private void onException(ExceptionEvent ee) {
    if (pending == null) return;
    Location c = ee.catchLocation();
    /* Exceptions the JDK throws and catches internally (e.g. inside nextInt) don't count. */
    boolean escapes = c == null || userClasses.contains(c.declaringType().name());
    if (!escapes) return;
    ObjectReference ex = ee.exception();
    pending.put("ok", false);
    Map<String, Object> err = new LinkedHashMap<>();
    err.put("type", ex.referenceType().name());
    err.put("message", text(field(ex, "detailMessage")));
    pending.put("error", err);
    finish();
  }

  private void finish() {
    events.add(pending);
    pending = null;
    pendingMethod = null;
    if (exitReq != null) erm.deleteEventRequest(exitReq);
    if (exReq != null) erm.deleteEventRequest(exReq);
    exitReq = null;
    exReq = null;
  }

  /** A call still open when the program ended (for example, killed by an uncaught exception). */
  List<Map<String, Object>> events() {
    if (pending != null && !events.contains(pending)) {
      pending.put("ok", false);
      pending.put("unfinished", true);
      events.add(pending);
      pending = null;
    }
    return events;
  }

  boolean truncated() { return truncated; }

  private static Value field(ObjectReference o, String name) {
    Field f = o.referenceType().fieldByName(name);
    return f == null ? null : o.getValue(f);
  }

  private static Object text(Value v) {
    if (v == null) return null;
    if (v instanceof StringReference s) {
      String t = s.value();
      return t.length() > MAX_TEXT ? t.substring(0, MAX_TEXT) : t;
    }
    if (v instanceof PrimitiveValue p) return p.toString();
    if (v instanceof ObjectReference o && o.referenceType().name().equals("java.util.regex.Pattern")) return text(field(o, "pattern"));
    if (v instanceof ArrayReference) return "[array]";
    return v.type().name();
  }

  private interface Source { String get() throws Exception; }
  private static String safe(Source s) {
    try { return s.get(); } catch (Exception e) { return null; }
  }
}
