package codeviz.runner;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Minimal JSON reader and writer, so the runner has no third-party dependencies. */
public final class Json {
  private Json() {}

  public static Object parse(String text) {
    Parser p = new Parser(text);
    p.ws();
    Object v = p.value();
    p.ws();
    if (p.i != text.length()) throw new IllegalArgumentException("Unexpected trailing characters in JSON");
    return v;
  }

  private static final class Parser {
    final String s;
    int i;
    int depth;

    Parser(String s) { this.s = s; }

    void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }

    Object value() {
      if (i >= s.length()) throw new IllegalArgumentException("Unexpected end of JSON");
      if (++depth > 64) throw new IllegalArgumentException("JSON nested too deeply");
      try {
        char c = s.charAt(i);
        if (c == '{') return object();
        if (c == '[') return array();
        if (c == '"') return string();
        if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
        if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
        if (s.startsWith("null", i)) { i += 4; return null; }
        return number();
      } finally { depth--; }
    }

    Map<String, Object> object() {
      Map<String, Object> m = new LinkedHashMap<>();
      i++; ws();
      if (peek() == '}') { i++; return m; }
      while (true) {
        ws();
        String k = string();
        ws(); expect(':'); ws();
        m.put(k, value());
        ws();
        if (peek() == ',') { i++; continue; }
        expect('}');
        return m;
      }
    }

    List<Object> array() {
      List<Object> a = new ArrayList<>();
      i++; ws();
      if (peek() == ']') { i++; return a; }
      while (true) {
        ws(); a.add(value()); ws();
        if (peek() == ',') { i++; continue; }
        expect(']');
        return a;
      }
    }

    String string() {
      expect('"');
      StringBuilder b = new StringBuilder();
      while (true) {
        if (i >= s.length()) throw new IllegalArgumentException("Unterminated string");
        char c = s.charAt(i++);
        if (c == '"') return b.toString();
        if (c == '\\') {
          char e = s.charAt(i++);
          switch (e) {
            case 'n' -> b.append('\n');
            case 't' -> b.append('\t');
            case 'r' -> b.append('\r');
            case 'b' -> b.append('\b');
            case 'f' -> b.append('\f');
            case 'u' -> { b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; }
            default -> b.append(e);
          }
        } else b.append(c);
      }
    }

    Object number() {
      int start = i;
      while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
      String n = s.substring(start, i);
      if (n.isEmpty()) throw new IllegalArgumentException("Invalid JSON value");
      if (n.contains(".") || n.contains("e") || n.contains("E")) return Double.parseDouble(n);
      return Long.parseLong(n);
    }

    char peek() { return i < s.length() ? s.charAt(i) : '\0'; }

    void expect(char c) {
      if (peek() != c) throw new IllegalArgumentException("Expected '" + c + "' in JSON");
      i++;
    }
  }

  /** Streaming writer with a hard size cap, so a runaway trace cannot exhaust memory. */
  public static final class Writer {
    private final StringBuilder b = new StringBuilder();
    private final long limit;

    public Writer() { this(Long.MAX_VALUE); }
    public Writer(long limit) { this.limit = limit; }

    public boolean full() { return b.length() > limit; }
    public int length() { return b.length(); }
    public Writer raw(String r) { b.append(r); return this; }

    public Writer str(String v) {
      if (v == null) { b.append("null"); return this; }
      b.append('"');
      for (int k = 0; k < v.length(); k++) {
        char c = v.charAt(k);
        switch (c) {
          case '"' -> b.append("\\\"");
          case '\\' -> b.append("\\\\");
          case '\n' -> b.append("\\n");
          case '\r' -> b.append("\\r");
          case '\t' -> b.append("\\t");
          default -> {
            if (c < 0x20 || c == 0x2028 || c == 0x2029) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
          }
        }
      }
      b.append('"');
      return this;
    }

    @Override public String toString() { return b.toString(); }
  }

  /** Serializes plain Java values: Map, List, String, Number, Boolean, null. */
  public static String write(Object v) {
    Writer w = new Writer();
    write(w, v);
    return w.toString();
  }

  public static void write(Writer w, Object v) {
    if (v == null) w.raw("null");
    else if (v instanceof String s) w.str(s);
    else if (v instanceof Boolean bo) w.raw(bo.toString());
    else if (v instanceof Double d) w.raw(d.isNaN() || d.isInfinite() ? "null" : d.toString());
    else if (v instanceof Float f) w.raw(f.isNaN() || f.isInfinite() ? "null" : f.toString());
    else if (v instanceof Number n) w.raw(n.toString());
    else if (v instanceof RawJson r) w.raw(r.json());
    else if (v instanceof Map<?, ?> m) {
      w.raw("{");
      boolean first = true;
      for (Map.Entry<?, ?> e : m.entrySet()) {
        if (!first) w.raw(",");
        first = false;
        w.str(String.valueOf(e.getKey())).raw(":");
        write(w, e.getValue());
      }
      w.raw("}");
    } else if (v instanceof Iterable<?> it) {
      w.raw("[");
      boolean first = true;
      for (Object o : it) {
        if (!first) w.raw(",");
        first = false;
        write(w, o);
      }
      w.raw("]");
    } else w.str(v.toString());
  }

  /** Pre-serialized JSON embedded as-is (used for traces). */
  public record RawJson(String json) {}
}
