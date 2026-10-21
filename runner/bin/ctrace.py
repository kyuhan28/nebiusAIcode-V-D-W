#!/usr/bin/env python3
"""
ctrace: records a C or C++ program step by step, for the visualizer.

  ctrace.py PROGRAM SRC REQUEST RESULT

PROGRAM was built by the runner with -g -gdwarf-4 -O0 -fno-omit-frame-pointer -no-pie and the
allocation log (cvmem.c / cvmem.cpp) linked in. This is a small debugger: it starts PROGRAM under
ptrace, puts a breakpoint on every source line the compiler's line table lists for the project's
files, and at each stop reads registers and memory of the stopped process. Variables are found
through their DWARF locations and decoded by their DWARF types; the call stack comes from the
frame-pointer chain; heap blocks come from the allocation log the program itself keeps. The
recorder only reads the stopped program's memory: nothing is ever dereferenced on its behalf.

The result uses the same trace format as the Java and Python recorders (steps with frames, locals,
globals, and a heap of objects), plus a "memory" section per step with addresses, blocks, and
pointer targets for the memory view.
"""
import ctypes
import json
import os
import select
import signal
import struct
import sys
import threading
import time

MAX_ARRAY = 64          # elements decoded per array or block
MAX_BLOCK_BYTES = 4096  # bytes of a heap block read per step
MAX_BLOCKS = 96
MAX_DEPTH = 4           # nesting of structs inside structs
MAX_FRAMES = 16
UNINIT = 0xBE           # the allocation log fills malloc'd memory with this byte (see cvmem.c)


# ============================================================== ELF and DWARF

def uleb(b, i):
    r = s = 0
    while True:
        x = b[i]; i += 1
        r |= (x & 0x7F) << s; s += 7
        if x < 0x80:
            return r, i


def sleb(b, i):
    r = s = 0
    while True:
        x = b[i]; i += 1
        r |= (x & 0x7F) << s; s += 7
        if x < 0x80:
            if x & 0x40:
                r -= 1 << s
            return r, i


def cstr(b, i):
    j = b.index(b"\0", i)
    return b[i:j].decode("utf-8", "replace"), j + 1


class ELF:
    def __init__(self, path):
        d = open(path, "rb").read()
        if d[:4] != b"\x7fELF" or d[4] != 2:
            raise ValueError("not a 64-bit ELF program")
        self.d = d
        shoff, = struct.unpack_from("<Q", d, 0x28)
        shentsize, shnum, shstrndx = struct.unpack_from("<HHH", d, 0x3A)
        secs = [struct.unpack_from("<IIQQQQIIQQ", d, shoff + k * shentsize) for k in range(shnum)]
        strsec = secs[shstrndx]
        self.sec = {}
        for s in secs:
            name, _ = cstr(d, strsec[4] + s[0])
            self.sec[name] = s
        self.symbols = {}
        sym, strt = self.sec.get(".symtab"), None
        if sym:
            strt = secs[sym[6]]
            for k in range(sym[5] // 24):
                st_name, st_info, _, _, st_value, st_size = struct.unpack_from("<IBBHQQ", d, sym[4] + k * 24)
                if st_name:
                    n, _ = cstr(d, strt[4] + st_name)
                    self.symbols[n] = (st_value, st_size)

    def data(self, name):
        s = self.sec.get(name)
        return self.d[s[4]:s[4] + s[5]] if s else b""


# DWARF constants (only those used)
T_ARRAY, T_CLASS, T_ENUM, T_PARAM, T_LEXBLOCK, T_MEMBER, T_POINTER, T_REF, T_CU, T_STRUCT, T_SUBROUTINE, T_TYPEDEF, T_UNION, T_INHERIT, \
    T_SUBRANGE, T_BASE, T_CONST, T_ENUMERATOR, T_SUBPROGRAM, T_VARIABLE, T_VOLATILE, T_RESTRICT, T_NAMESPACE, T_RVREF, T_UNSPEC = \
    0x01, 0x02, 0x04, 0x05, 0x0B, 0x0D, 0x0F, 0x10, 0x11, 0x13, 0x15, 0x16, 0x17, 0x1C, 0x21, 0x24, 0x26, 0x28, 0x2E, 0x34, 0x35, 0x37, 0x39, 0x42, 0x3B
A_LOCATION, A_NAME, A_BYTE_SIZE, A_STMT_LIST, A_LOW_PC, A_HIGH_PC, A_COMP_DIR, A_CONST_VALUE, A_UPPER_BOUND, A_ABSTRACT_ORIGIN, A_COUNT, \
    A_DATA_MEMBER_LOCATION, A_DECL_FILE, A_DECL_LINE, A_DECLARATION, A_ENCODING, A_EXTERNAL, A_FRAME_BASE, A_SPECIFICATION, A_TYPE, A_ARTIFICIAL, A_LINKAGE_NAME = \
    0x02, 0x03, 0x0B, 0x10, 0x11, 0x12, 0x1B, 0x1C, 0x2F, 0x31, 0x37, 0x38, 0x3A, 0x3B, 0x3C, 0x3E, 0x3F, 0x40, 0x47, 0x49, 0x34, 0x6E


class Die:
    __slots__ = ("off", "tag", "attrs", "children", "parent", "cu")

    def __init__(self, off, tag, cu):
        self.off, self.tag, self.attrs, self.children, self.parent, self.cu = off, tag, {}, [], None, cu

    def get(self, a, default=None):
        return self.attrs.get(a, default)


class Dwarf:
    """Enough of DWARF 4 to find functions, variables, types, and lines (what gcc -gdwarf-4 -O0 emits)."""

    def __init__(self, elf):
        self.info, self.abbrev, self.strs, self.line = elf.data(".debug_info"), elf.data(".debug_abbrev"), elf.data(".debug_str"), elf.data(".debug_line")
        self.ranges_data = elf.data(".debug_ranges")
        self.dies, self.cus = {}, []
        self._parse()

    def _abbrevs(self, off):
        out, b = {}, self.abbrev
        while True:
            code, off = uleb(b, off)
            if code == 0:
                return out
            tag, off = uleb(b, off)
            children = b[off]; off += 1
            specs = []
            while True:
                a, off = uleb(b, off)
                f, off = uleb(b, off)
                ic = None
                if f == 0x21:
                    ic, off = sleb(b, off)
                if a == 0 and f == 0:
                    break
                specs.append((a, f, ic))
            out[code] = (tag, children, specs)

    def _form(self, f, b, i, cu_off, ic):
        if f == 0x01: return struct.unpack_from("<Q", b, i)[0], i + 8
        if f == 0x0B: return b[i], i + 1
        if f == 0x05: return struct.unpack_from("<H", b, i)[0], i + 2
        if f == 0x06: return struct.unpack_from("<I", b, i)[0], i + 4
        if f == 0x07: return struct.unpack_from("<Q", b, i)[0], i + 8
        if f == 0x0D: return sleb(b, i)
        if f == 0x0F: return uleb(b, i)
        if f == 0x08: return cstr(b, i)
        if f == 0x0E:
            o = struct.unpack_from("<I", b, i)[0]
            return cstr(self.strs, o)[0], i + 4
        if f in (0x11,): return ("ref", cu_off + b[i]), i + 1
        if f in (0x12,): return ("ref", cu_off + struct.unpack_from("<H", b, i)[0]), i + 2
        if f in (0x13,): return ("ref", cu_off + struct.unpack_from("<I", b, i)[0]), i + 4
        if f in (0x14,): return ("ref", cu_off + struct.unpack_from("<Q", b, i)[0]), i + 8
        if f == 0x15:
            v, i = uleb(b, i)
            return ("ref", cu_off + v), i
        if f == 0x10: return ("ref", struct.unpack_from("<I", b, i)[0]), i + 4
        if f == 0x17: return struct.unpack_from("<I", b, i)[0], i + 4
        if f == 0x18 or f == 0x09:
            n, i = uleb(b, i)
            return ("expr", b[i:i + n]), i + n
        if f == 0x0A:
            n = b[i]
            return ("expr", b[i + 1:i + 1 + n]), i + 1 + n
        if f == 0x03:
            n = struct.unpack_from("<H", b, i)[0]
            return ("expr", b[i + 2:i + 2 + n]), i + 2 + n
        if f == 0x04:
            n = struct.unpack_from("<I", b, i)[0]
            return ("expr", b[i + 4:i + 4 + n]), i + 4 + n
        if f == 0x0C: return bool(b[i]), i + 1
        if f == 0x19: return True, i
        if f == 0x20: return ("sig", struct.unpack_from("<Q", b, i)[0]), i + 8
        if f == 0x21: return ic, i
        if f == 0x1E: return b[i:i + 16], i + 16
        if f == 0x16:
            real, i = uleb(b, i)
            return self._form(real, b, i, cu_off, ic)
        raise ValueError(f"unsupported DWARF form 0x{f:x}")

    def _parse(self):
        b, off = self.info, 0
        while off < len(b):
            length, = struct.unpack_from("<I", b, off)
            if length == 0xFFFFFFFF:
                raise ValueError("64-bit DWARF is not supported")
            version, = struct.unpack_from("<H", b, off + 4)
            if version == 5:
                abbr_off, = struct.unpack_from("<I", b, off + 8)
                i = off + 12
            else:
                abbr_off, = struct.unpack_from("<I", b, off + 6)
                i = off + 11
            end = off + 4 + length
            abbrevs = self._abbrevs(abbr_off)
            stack, cu = [], None
            while i < end:
                doff = i
                code, i = uleb(b, i)
                if code == 0:
                    if stack: stack.pop()
                    continue
                tag, children, specs = abbrevs[code]
                die = Die(doff, tag, cu)
                for a, f, ic in specs:
                    v, i = self._form(f, b, i, off, ic)
                    die.attrs[a] = v
                if cu is None:
                    cu = die
                    die.cu = die
                    self.cus.append(die)
                if stack:
                    die.parent = stack[-1]
                    stack[-1].children.append(die)
                self.dies[doff] = die
                if children:
                    stack.append(die)
            off = end

    def ranges(self, offset, base):
        """A DWARF 4 range list: (start, end) pairs, relative to the compile unit's base address."""
        out, b, i = [], self.ranges_data, offset
        while i + 16 <= len(b):
            lo, hi = struct.unpack_from("<QQ", b, i)
            i += 16
            if lo == 0 and hi == 0:
                break
            if lo == 0xFFFFFFFFFFFFFFFF:
                base = hi
                continue
            out.append((base + lo, base + hi))
        return out

    def ref(self, die, a):
        v = die.get(a)
        return self.dies.get(v[1]) if isinstance(v, tuple) and v[0] == "ref" else None

    def lines(self, offset, comp_dir):
        """The line table of one compile unit: rows (address, file path, line, is_stmt, end_sequence)."""
        b, i = self.line, offset
        length, = struct.unpack_from("<I", b, i); end = i + 4 + length
        version, = struct.unpack_from("<H", b, i + 4)
        if version >= 5:
            raise ValueError("DWARF 5 line tables are not supported; build with -gdwarf-4")
        hlen, = struct.unpack_from("<I", b, i + 6)
        p = i + 10
        min_inst = b[p]; p += 1
        if version >= 4: p += 1
        default_stmt = b[p]; p += 1
        line_base = struct.unpack_from("<b", b, p)[0]; p += 1
        line_range = b[p]; p += 1
        opcode_base = b[p]; p += 1
        lens = list(b[p:p + opcode_base - 1]); p += opcode_base - 1
        dirs = [comp_dir]
        while b[p]:
            s, p = cstr(b, p); dirs.append(s if s.startswith("/") else os.path.join(comp_dir, s))
        p += 1
        files = [None]
        while b[p]:
            name, p = cstr(b, p)
            d, p = uleb(b, p); _, p = uleb(b, p); _, p = uleb(b, p)
            files.append(os.path.normpath(name if name.startswith("/") else os.path.join(dirs[d] if d < len(dirs) else comp_dir, name)))
        p = i + 10 + hlen
        rows = []
        addr, fidx, line, stmt = 0, 1, 1, default_stmt
        while p < end:
            op = b[p]; p += 1
            if op >= opcode_base:
                adj = op - opcode_base
                addr += (adj // line_range) * min_inst
                line += line_base + adj % line_range
                rows.append((addr, files[fidx] if fidx < len(files) else None, line, stmt))
            elif op == 0:
                n, p = uleb(b, p)
                sub = b[p]
                if sub == 1:
                    rows.append((addr, None, line, False))
                    addr, fidx, line, stmt = 0, 1, 1, default_stmt
                elif sub == 2:
                    addr, = struct.unpack_from("<Q", b, p + 1)
                p += n
            elif op == 1:
                rows.append((addr, files[fidx] if fidx < len(files) else None, line, stmt))
            elif op == 2:
                v, p = uleb(b, p); addr += v * min_inst
            elif op == 3:
                v, p = sleb(b, p); line += v
            elif op == 4:
                fidx, p = uleb(b, p)
            elif op == 5:
                _, p = uleb(b, p)
            elif op == 6:
                stmt = not stmt
            elif op == 8:
                addr += ((255 - opcode_base) // line_range) * min_inst
            elif op == 9:
                addr += struct.unpack_from("<H", b, p)[0]; p += 2
            elif op in (7, 10, 11):
                pass
            elif op == 12:
                _, p = uleb(b, p)
            else:
                for _ in range(lens[op - 1]):
                    _, p = uleb(b, p)
        return rows


# ============================================================== types and values

class Types:
    def __init__(self, dw, cpp):
        self.dw, self.cpp = dw, cpp

    def strip(self, die):
        """The type underneath typedefs and qualifiers."""
        while die is not None and die.tag in (T_TYPEDEF, T_CONST, T_VOLATILE, T_RESTRICT):
            die = self.dw.ref(die, A_TYPE)
        return die

    def name(self, die):
        if die is None:
            return "void"
        t = die.tag
        if t in (T_BASE, T_TYPEDEF, T_UNSPEC):
            return die.get(A_NAME, "?")
        if t == T_CONST:
            return "const " + self.name(self.dw.ref(die, A_TYPE))
        if t in (T_VOLATILE, T_RESTRICT):
            return self.name(self.dw.ref(die, A_TYPE))
        if t == T_POINTER:
            return self.name(self.dw.ref(die, A_TYPE)) + "*"
        if t == T_REF:
            return self.name(self.dw.ref(die, A_TYPE)) + "&"
        if t == T_RVREF:
            return self.name(self.dw.ref(die, A_TYPE)) + "&&"
        if t in (T_STRUCT, T_CLASS, T_UNION, T_ENUM):
            n = die.get(A_NAME, "(anonymous)")
            if self.cpp:
                return n
            return {T_STRUCT: "struct ", T_UNION: "union ", T_ENUM: "enum "}.get(t, "") + n
        if t == T_ARRAY:
            return self.name(self.dw.ref(die, A_TYPE)) + "".join(f"[{n}]" for n in self.dims(die))
        if t == T_SUBROUTINE:
            return "function pointer"
        return "?"

    def dims(self, die):
        out = []
        for c in die.children:
            if c.tag == T_SUBRANGE:
                if A_COUNT in c.attrs and isinstance(c.get(A_COUNT), int): out.append(c.get(A_COUNT))
                elif A_UPPER_BOUND in c.attrs and isinstance(c.get(A_UPPER_BOUND), int): out.append(c.get(A_UPPER_BOUND) + 1)
                else: out.append(0)
        return out

    def size(self, die):
        die = self.strip(die)
        if die is None:
            return 1
        if A_BYTE_SIZE in die.attrs:
            return die.get(A_BYTE_SIZE)
        if die.tag in (T_POINTER, T_REF, T_RVREF):
            return 8
        if die.tag == T_ARRAY:
            n = 1
            for d in self.dims(die): n *= d
            return n * self.size(self.dw.ref(die, A_TYPE))
        return 0

    def members(self, die):
        out = []
        for c in die.children:
            if c.tag in (T_MEMBER, T_INHERIT) and A_DATA_MEMBER_LOCATION in c.attrs and not c.get(A_DECLARATION):
                loc = c.get(A_DATA_MEMBER_LOCATION)
                if isinstance(loc, tuple):
                    expr = loc[1]
                    loc = uleb(expr, 1)[0] if expr and expr[0] == 0x23 else 0
                out.append((c.get(A_NAME, "(base)") if c.tag == T_MEMBER else "(base " + self.name(self.dw.ref(c, A_TYPE)) + ")", loc, self.dw.ref(c, A_TYPE)))
        return out


# ============================================================== ptrace

libc = ctypes.CDLL(None, use_errno=True)
libc.ptrace.restype = ctypes.c_long
libc.ptrace.argtypes = [ctypes.c_long, ctypes.c_long, ctypes.c_void_p, ctypes.c_void_p]
PTRACE_TRACEME, PTRACE_CONT, PTRACE_KILL, PTRACE_SINGLESTEP, PTRACE_GETREGS, PTRACE_SETREGS, PTRACE_GETFPREGS, PTRACE_SETOPTIONS = 0, 7, 8, 9, 12, 13, 14, 0x4200
PTRACE_O_EXITKILL = 0x100000


class Regs(ctypes.Structure):
    _fields_ = [(n, ctypes.c_ulonglong) for n in
                "r15 r14 r13 r12 rbp rbx r11 r10 r9 r8 rax rcx rdx rsi rdi orig_rax rip cs eflags rsp ss fs_base gs_base ds es fs gs".split()]


class iovec(ctypes.Structure):
    _fields_ = [("iov_base", ctypes.c_void_p), ("iov_len", ctypes.c_size_t)]


libc.process_vm_readv.argtypes = [ctypes.c_int, ctypes.POINTER(iovec), ctypes.c_ulong, ctypes.POINTER(iovec), ctypes.c_ulong, ctypes.c_ulong]
libc.process_vm_readv.restype = ctypes.c_ssize_t
PTRACE_PEEKTEXT, PTRACE_POKETEXT = 1, 4


class Memory:
    """Reads the stopped program's memory by process id. process_vm_readv and ptrace understand the sandbox's
    process namespace (/proc may still show the host's numbering), so they come first."""
    def __init__(self, pid):
        self.pid = pid
        self.mode = "vm"
        try:
            self.fd = os.open(f"/proc/{pid}/mem", os.O_RDONLY)
        except OSError:
            self.fd = None

    def read(self, addr, n):
        if addr <= 0 or n <= 0:
            return None
        if self.mode == "vm":
            buf = ctypes.create_string_buffer(n)
            local = iovec(ctypes.cast(buf, ctypes.c_void_p), n)
            remote = iovec(ctypes.c_void_p(addr), n)
            got = libc.process_vm_readv(self.pid, ctypes.byref(local), 1, ctypes.byref(remote), 1, 0)
            if got == n:
                return buf.raw
            if got == -1 and ctypes.get_errno() in (1, 38):  # EPERM, ENOSYS: fall back
                self.mode = "proc" if self.fd is not None else "peek"
            else:
                return None
        if self.mode == "proc":
            try:
                data = os.pread(self.fd, n, addr)
                return data if len(data) == n else None
            except OSError:
                self.mode = "peek"
        out = bytearray()
        base = addr & ~7
        while len(out) < (addr - base) + n:
            w = self.peek(base + len(out))
            if w is None:
                return None
            out += struct.pack("<Q", w)
        return bytes(out[addr - base:addr - base + n])

    def peek(self, addr):
        ctypes.set_errno(0)
        v = libc.ptrace(PTRACE_PEEKTEXT, self.pid, ctypes.c_void_p(addr), None)
        if v == -1 and ctypes.get_errno():
            return None
        return v & 0xFFFFFFFFFFFFFFFF

    def write(self, addr, data):
        """Patches code bytes (breakpoints) with PTRACE_POKETEXT, one aligned word at a time."""
        for k, byte in enumerate(data):
            a = addr + k
            base = a & ~7
            w = self.peek(base)
            if w is None:
                raise OSError("cannot read code at " + hex(a))
            word = bytearray(struct.pack("<Q", w))
            word[a - base] = byte
            ptrace(PTRACE_POKETEXT, self.pid, base, struct.unpack("<Q", bytes(word))[0])


def ptrace(req, pid, addr=0, data=0):
    r = libc.ptrace(req, pid, ctypes.c_void_p(addr), ctypes.c_void_p(data))
    if r == -1 and ctypes.get_errno():
        raise OSError(ctypes.get_errno(), f"ptrace {req} failed")
    return r


def regs(pid):
    r = Regs()
    ptrace(PTRACE_GETREGS, pid, 0, ctypes.addressof(r))
    return r


def set_regs(pid, r):
    ptrace(PTRACE_SETREGS, pid, 0, ctypes.addressof(r))


def xmm0(pid):
    buf = ctypes.create_string_buffer(512)
    ptrace(PTRACE_GETFPREGS, pid, 0, ctypes.addressof(buf))
    return buf.raw[160:176]


# ============================================================== the program's structure

class Program:
    def __init__(self, path, src, cpp):
        self.elf = ELF(path)
        self.dw = Dwarf(self.elf)
        self.types = Types(self.dw, cpp)
        self.src = os.path.realpath(src)
        self.cpp = cpp
        self.funcs = []        # (low, high, die, name, file)
        self.globals = []      # (name, addr, type_die, file)
        self.rows = []         # (addr, file, line, is_stmt), project files only
        self.fileset = set()
        for cu in self.dw.cus:
            comp = cu.get(A_COMP_DIR, "")
            if A_STMT_LIST in cu.attrs:
                for addr, f, line, stmt in self.dw.lines(cu.get(A_STMT_LIST), comp):
                    rel = self.project(f)
                    if rel:
                        self.rows.append((addr, rel, line, stmt))
            self._walk(cu, comp)
        self.rows.sort()
        self.row_addrs = [r[0] for r in self.rows]
        # Functions written in the project (library templates compiled into it have rows only in headers).
        import bisect
        self.own = set()
        for lo, hi, die, name, decl in self.funcs:
            k = bisect.bisect_left(self.row_addrs, lo)
            if k < len(self.row_addrs) and self.row_addrs[k] < hi:
                self.own.add(lo)
        # Breakpoints: statement starts in project code, except a function's first instruction (its frame is not set up yet).
        lows = {f[0] for f in self.funcs}
        self.breaks = sorted({a for a, f, l, s in self.rows if s and a not in lows and any(lo <= a < hi for lo, hi, *_ in self.funcs)})
        # A function's last line (its closing brace) is where it is about to return.
        self.exits = {}
        for lo, hi, die, name, f in self.funcs:
            inside = [r for r in self.rows if lo <= r[0] < hi and r[3]]
            if inside:
                last = max(inside)
                self.exits[last[0]] = die

    def project(self, path):
        if not path:
            return None
        p = os.path.realpath(path)
        if not p.startswith(self.src + os.sep):
            return None
        rel = os.path.relpath(p, self.src).replace(os.sep, "/")
        return None if "/codeviz/" in "/" + rel or rel.startswith("cvmem") else rel

    def _walk(self, die, comp):
        for c in die.children:
            if c.tag == T_SUBPROGRAM and A_LOW_PC in c.attrs and not c.get(A_DECLARATION):
                low = c.get(A_LOW_PC)
                high = c.get(A_HIGH_PC)
                high = low + high if isinstance(high, int) and high < low else high
                # A constructor's code points to its abstract definition, which points to the declaration in
                # the class: follow the chain for the name and the class it belongs to.
                decl, name = c, c.get(A_NAME)
                for _ in range(4):
                    nxt = self.dw.ref(decl, A_SPECIFICATION) or self.dw.ref(decl, A_ABSTRACT_ORIGIN)
                    if nxt is None:
                        break
                    decl = nxt
                    name = name or decl.get(A_NAME)
                name = name or "?"
                if decl is not None and decl.parent is not None and decl.parent.tag in (T_STRUCT, T_CLASS):
                    name = f"{decl.parent.get(A_NAME, '?')}::{name}"
                self.funcs.append((low, high, c, name, decl))
            elif c.tag == T_VARIABLE and A_LOCATION in c.attrs and c.parent is not None and c.parent.tag in (T_CU, T_NAMESPACE):
                loc = c.get(A_LOCATION)
                if isinstance(loc, tuple) and loc[1][:1] == b"\x03" and len(loc[1]) == 9:
                    spec = self.dw.ref(c, A_SPECIFICATION)
                    name = c.get(A_NAME) or (spec.get(A_NAME) if spec else None)
                    tdie = self.dw.ref(c, A_TYPE) or (self.dw.ref(spec, A_TYPE) if spec else None)
                    if name and not name.startswith("__cv_"):
                        self.globals.append((name, struct.unpack_from("<Q", loc[1], 1)[0], tdie, self.dw.ref(c, A_DECL_FILE)))
            elif c.tag == T_NAMESPACE:
                self._walk(c, comp)

    def func_at(self, pc):
        for lo, hi, die, name, f in self.funcs:
            if lo <= pc < hi:
                return die, name
        return None, None

    def own_func(self, pc):
        for lo, hi, die, name, decl in self.funcs:
            if lo <= pc < hi:
                return lo in self.own
        return False

    def decl_of(self, pc):
        for lo, hi, die, name, decl in self.funcs:
            if lo <= pc < hi:
                return decl
        return None

    def line_at(self, pc):
        import bisect
        k = bisect.bisect_right(self.row_addrs, pc) - 1
        if k < 0:
            return None, None
        _, f, line, _ = self.rows[k]
        return f, line

    def variables(self, fdie, pc):
        """Parameters and the locals of every lexical block that contains pc, with their DWARF frame offsets."""
        out = []
        def visit(d):
            for c in d.children:
                if c.tag in (T_PARAM, T_VARIABLE):
                    origin = self.dw.ref(c, A_ABSTRACT_ORIGIN)
                    name = c.get(A_NAME) or (origin.get(A_NAME) if origin else None)
                    loc = c.get(A_LOCATION)
                    if name and isinstance(loc, tuple) and loc[1][:1] == b"\x91":
                        off, _ = sleb(loc[1], 1)
                        # A concrete copy (a constructor's code, an inlined body) keeps type and flags on its origin.
                        tdie = self.dw.ref(c, A_TYPE) or (self.dw.ref(origin, A_TYPE) if origin else None)
                        artificial = bool(c.get(A_ARTIFICIAL) or (origin.get(A_ARTIFICIAL) if origin else False))
                        decl_line = c.get(A_DECL_LINE) or (origin.get(A_DECL_LINE, 0) if origin else 0)
                        out.append((name, off, tdie, c.tag == T_PARAM, decl_line, artificial))
                elif c.tag == T_LEXBLOCK:
                    lo, hi = c.get(A_LOW_PC), c.get(A_HIGH_PC)
                    if isinstance(lo, int) and isinstance(hi, int):
                        hi = lo + hi if hi < lo else hi
                        if lo <= pc < hi:
                            visit(c)
                    elif isinstance(c.get(0x55), int):  # DW_AT_ranges: a block split in pieces (C++ cleanups)
                        base = c.cu.get(A_LOW_PC, 0) if c.cu is not None else 0
                        if any(a <= pc < b for a, b in self.dw.ranges(c.get(0x55), base if isinstance(base, int) else 0)):
                            visit(c)
        visit(fdie)
        return out


# ============================================================== recording

class Recorder:
    def __init__(self, prog, req, cpp):
        self.prog, self.req, self.cpp = prog, req, cpp
        self.max_steps = int(req.get("maxSteps", 2000))
        self.deadline = time.monotonic() + int(req.get("timeoutMs", 20000)) / 1000.0
        self.steps = []
        self.blocks = {}       # addr -> block (live)
        self.all_blocks = []   # every block ever, in order
        self.events_seen = 0
        self.frame_ids = {}    # (cfa, function) -> id
        self.next_frame = 1
        self.announced = set()
        self.last_types = {}
        self.peak = 0
        self.dropped = 0
        cv = prog.elf.symbols
        self.objects, self.object_list = {}, []
        self.visited = {}  # lines each live frame has already executed
        self.ev_addr = cv.get("__cv_events", (0, 0))[0]
        self.count_addr = cv.get("__cv_count", (0, 0))[0]
        self.dropped_addr = cv.get("__cv_dropped", (0, 0))[0]

    # -- allocation log
    def sync_heap(self, mem, step):
        if not self.count_addr:
            return []
        raw = mem.read(self.count_addr, 8)
        count = struct.unpack("<Q", raw)[0] if raw else self.events_seen
        events = []
        while self.events_seen < count:
            data = mem.read(self.ev_addr + self.events_seen * 88, 88)
            self.events_seen += 1
            if not data:
                continue
            kind, addr, old, size, n, *callers = struct.unpack("<5Q6Q", data)
            line_file, line = None, None
            for c in callers:
                f, l = self.prog.line_at(c - 1) if c else (None, None)
                fd, _ = self.prog.func_at(c - 1) if c else (None, None)
                if f and fd is not None:
                    line_file, line = f, l
                    break
            names = {1: "malloc", 2: "calloc", 3: "realloc", 4: "free", 5: "new", 6: "new[]", 7: "delete", 8: "delete[]"}
            op = names.get(kind, "?")
            ev = {"op": op, "size": size, "file": line_file, "line": line, "step": step}
            if op in ("malloc", "calloc", "new", "new[]") or (op == "realloc" and not old):
                if addr:
                    b = self._new_block(addr, size, op, line_file, line, step, count=n if op == "calloc" else None)
                    ev["block"] = b["id"]
                else:
                    ev["failed"] = True
            elif op == "realloc":
                ob = self.blocks.get(old)
                if not addr and size:
                    ev["failed"] = True  # the old block is untouched, as C requires
                    if ob: ev["block"] = ob["id"]
                elif ob is not None:
                    ev["from"] = ob["id"]
                    if not addr:  # realloc(p, 0) freed it
                        self._free(ob, line_file, line, step, "realloc")
                    else:
                        moved = addr != old
                        self._free(ob, line_file, line, step, "realloc", moved_to=addr if moved else None, keep=not moved)
                        if moved:
                            nb = self._new_block(addr, size, "realloc", line_file, line, step)
                            nb["from"] = ob["id"]
                            ev["block"], ev["moved"] = nb["id"], True
                        else:
                            ob["size"] = size
                            ev["block"], ev["moved"] = ob["id"], False
            else:  # free, delete, delete[]
                if not addr:
                    ev["null"] = True
                else:
                    b = self.blocks.get(addr)
                    if b is None:
                        ev["invalid"] = True
                    else:
                        ev["block"] = b["id"]
                        self._free(b, line_file, line, step, op)
            events.append(ev)
        live = sum(b["size"] for b in self.blocks.values())
        self.peak = max(self.peak, live)
        return events

    def _new_block(self, addr, size, op, f, line, step, count=None):
        b = {"id": len(self.all_blocks) + 1, "addr": addr, "size": size, "op": op, "state": "live", "file": f, "line": line,
             "step": step, "zeroed": op == "calloc", "count": count}
        self.blocks[addr] = b
        self.all_blocks.append(b)
        return b

    def _free(self, b, f, line, step, op, moved_to=None, keep=False):
        if keep:
            return
        self.blocks.pop(b["addr"], None)
        b.update(state="freed", freedFile=f, freedLine=line, freedStep=step, freedBy=op)
        if moved_to:
            b["movedTo"] = moved_to

    def owner_of(self, addr):
        """The live or freed block containing addr (freed blocks are kept to recognize dangling pointers)."""
        for b in self.blocks.values():
            if b["addr"] <= addr < b["addr"] + max(b["size"], 1):
                return b
        for b in reversed(self.all_blocks):
            if b["state"] == "freed" and b["addr"] <= addr < b["addr"] + max(b["size"], 1):
                return b
        # One past the end is a valid pointer to form in C (not to dereference): it belongs to that block.
        for b in list(self.blocks.values()) + list(reversed(self.all_blocks)):
            if addr == b["addr"] + b["size"] and b["size"] > 0:
                return b
        return None

    # -- C++ object lifetime
    def lifetime(self, mem, layouts, events, step, rsp, chain):
        """Construction, copy and move, assignment, and destruction, seen as their functions start running."""
        T = self.prog.types
        stack_top = chain[-1][1] + 16 if chain else rsp
        for fpc, ident, fdie, fname, f, line, vs in layouts:
            key = (ident, fname)
            if key in self.frame_ids or not fname or "::" not in fname:
                continue  # an existing frame, or not a member function
            cls, method = fname.rsplit("::", 1)
            simple = cls.split("<")[0].split("::")[-1]
            slot = next((a for n, a, t, p, art in vs if n == "this"), None)
            if slot is None:
                continue
            raw = mem.read(slot, 8)
            data = mem_read_ptr(mem, struct.unpack("<Q", raw)[0] if raw else None)
            if data is None:
                continue
            params = [(n, T.name(t)) for n, a, t, p, art in vs if p and n != "this"]
            if method == simple:
                kind = "constructor"
                if len(params) == 1 and params[0][1].replace(" ", "") in (f"const{simple}&", f"{simple}const&", f"{simple}&"):
                    kind = "copy constructor"
                elif len(params) == 1 and params[0][1].replace(" ", "") == f"{simple}&&":
                    kind = "move constructor"
                elif not params:
                    kind = "default constructor"
                op = "construct"
            elif method == "~" + simple:
                op, kind = "destroy", "destructor"
            elif method == "operator=" and len(params) == 1:
                kind = "move assignment" if params[0][1].replace(" ", "").endswith("&&") else "copy assignment"
                op = "assign"
            else:
                continue
            b = self.owner_of(data)
            storage = "heap" if b is not None else ("stack" if rsp <= data < stack_top else "static")
            obj = self.objects.get(data)
            if op == "construct" or obj is None:
                obj = {"id": len(self.object_list) + 1, "cls": simple, "addr": hex(data), "storage": storage, "block": b["id"] if b else None,
                       "state": "alive", "how": kind, "line": line, "file": f, "step": step}
                self.objects[data] = obj
                self.object_list.append(obj)
            if op == "destroy":
                obj.update(state="destroyed", destroyedLine=line, destroyedStep=step)
                self.objects.pop(data, None)
            events.append({"op": op, "kind": kind, "cls": simple, "object": obj["id"], "addr": hex(data), "storage": storage, "block": b["id"] if b else None,
                           "file": f, "line": line, "step": step, "param": params[0][0] if params else None})

    # -- values
    def decode(self, mem, tdie, addr, raw, ctx, depth=0):
        """A value as the trace format's Val; arrays and structs become heap objects (ctx["heap"])."""
        T = self.prog.types
        t = T.strip(tdie)
        if t is None:
            return {"t": "opaque"}
        if t.tag == T_BASE:
            enc, size = t.get(A_ENCODING), t.get(A_BYTE_SIZE, 0)
            if raw is None or len(raw) < size:
                return {"t": "unknown"}
            if ctx.get("uninit") and all(x == UNINIT for x in raw[:size]):
                return {"t": "uninit"}
            if enc == 0x04:
                v = struct.unpack("<f" if size == 4 else "<d", raw[:size])[0] if size in (4, 8) else None
                return {"t": "double" if size == 8 else "float", "v": v if v == v and v not in (float("inf"), float("-inf")) else None}
            if enc == 0x02:
                return {"t": "boolean", "v": bool(raw[0])}
            signed = enc in (0x05, 0x06)
            v = int.from_bytes(raw[:size], "little", signed=signed)
            if size == 1 and enc in (0x06, 0x08):
                return {"t": "char", "v": chr(v & 0xFF) if 32 <= (v & 0xFF) < 127 else f"\\x{v & 0xFF:02x}", "code": v}
            return {"t": "int" if size <= 4 else "long", "v": v if -(2 ** 53) < v < 2 ** 53 else str(v)}
        if t.tag == T_ENUM:
            size = t.get(A_BYTE_SIZE, 4)
            if raw is None: return {"t": "unknown"}
            v = int.from_bytes(raw[:size], "little", signed=True)
            for c in t.children:
                if c.tag == T_ENUMERATOR and c.get(A_CONST_VALUE) == v:
                    return {"t": "enum", "v": c.get(A_NAME), "code": v}
            return {"t": "enum", "v": v}
        if t.tag in (T_POINTER, T_REF, T_RVREF):
            if raw is None: return {"t": "unknown"}
            if ctx.get("uninit") and all(x == UNINIT for x in raw[:8]):
                return {"t": "uninit"}
            p = struct.unpack("<Q", raw[:8])[0]
            return self.pointer(mem, p, self.prog.dw.ref(t, A_TYPE), ctx, ref=t.tag != T_POINTER)
        if t.tag == T_ARRAY:
            et = self.prog.dw.ref(t, A_TYPE)
            esize = T.size(et)
            dims = T.dims(t)
            n = dims[0] if dims else 0
            sub = esize * (T.size(t) // max(n, 1) // max(esize, 1)) if len(dims) > 1 else esize
            oid = ctx.get("id") or f"s{addr:x}"
            items = []
            for k in range(min(n, MAX_ARRAY)):
                piece = raw[k * sub:(k + 1) * sub] if raw else None
                if len(dims) > 1:
                    inner = {"t": "array", "of": T.name(et) + "".join(f"[{d}]" for d in dims[2:]), "len": dims[1], "items": []}
                    sub_ctx = dict(ctx, id=f"{oid}.{k}")
                    rowv = self._array_items(mem, et, esize, dims[1], addr + k * sub, piece, sub_ctx, depth)
                    inner["items"] = rowv
                    ctx["heap"][f"{oid}.{k}"] = inner
                    items.append({"t": "ref", "id": f"{oid}.{k}"})
                else:
                    items.append(self.decode(mem, et, addr + k * esize if addr else 0, piece, dict(ctx, id=None), depth + 1))
            ctx["heap"][oid] = {"t": "array", "of": T.name(et), "len": n, "items": items, "addr": addr}
            return {"t": "ref", "id": oid}
        if t.tag in (T_STRUCT, T_CLASS, T_UNION) and self.cpp:
            special = self.std_value(mem, t, addr, raw, ctx, depth)
            if special is not None:
                return special
        if t.tag in (T_STRUCT, T_CLASS, T_UNION):
            oid = ctx.get("id") or f"s{addr:x}"
            if depth > MAX_DEPTH or oid in ctx["heap"]:
                return {"t": "ref", "id": oid}
            ctx["heap"][oid] = {"t": "object", "cls": T.name(t), "fields": {}, "addr": addr}
            fields = {}
            for name, off, mt in T.members(t):
                size = T.size(mt)
                piece = raw[off:off + size] if raw is not None else None
                fields[name] = self.decode(mem, mt, addr + off if addr else 0, piece, dict(ctx, id=f"{oid}.{name}" if T.strip(mt) is not None and T.strip(mt).tag in (T_STRUCT, T_CLASS, T_UNION, T_ARRAY) else None), depth + 1)
            ctx["heap"][oid]["fields"] = fields
            return {"t": "ref", "id": oid}
        if t.tag == T_SUBROUTINE:
            return {"t": "opaque", "cls": "function"}
        return {"t": "opaque"}

    def member_path(self, t, want, base=0, depth=0):
        """(offset, type) of the first member named want (or any pointer member when want is None), searching bases and nested members."""
        T = self.prog.types
        if t is None or depth > 6:
            return None
        for name, off, mt in T.members(t):
            st = T.strip(mt)
            if (want is None and st is not None and st.tag == T_POINTER) or name == want:
                return base + off, mt
            if st is not None and st.tag in (T_STRUCT, T_CLASS, T_UNION):
                found = self.member_path(st, want, base + off, depth + 1)
                if found:
                    return found
        return None

    def read_ptr_at(self, mem, raw, off):
        return struct.unpack_from("<Q", raw, off)[0] if raw is not None and len(raw) >= off + 8 else None

    def std_value(self, mem, t, addr, raw, ctx, depth):
        """libstdc++ types by what they mean (their documented layout), not by their internals."""
        T = self.prog.types
        name = t.get(A_NAME, "")
        if raw is None:
            return None
        if name.startswith("unique_ptr<"):
            found = self.member_path(t, None)
            if not found: return None
            off, pt = found
            p = self.read_ptr_at(mem, raw, off)
            target = self.pointer(mem, p, self.prog.dw.ref(T.strip(pt), A_TYPE), ctx) if p is not None else {"t": "unknown"}
            return {"t": "smart", "kind": "unique_ptr", "target": target, "type": "std::" + name}
        if name.startswith("shared_ptr<") or name.startswith("weak_ptr<"):
            fp, fc = self.member_path(t, "_M_ptr"), self.member_path(t, "_M_pi")
            if not fp or not fc: return None
            p, pi = self.read_ptr_at(mem, raw, fp[0]), self.read_ptr_at(mem, raw, fc[0])
            target = self.pointer(mem, p, self.prog.dw.ref(T.strip(fp[1]), A_TYPE), ctx) if p is not None else {"t": "unknown"}
            use = weak = 0
            if pi:
                counts = mem.read(pi + 8, 8)
                if counts:
                    use, weak_raw = struct.unpack("<ii", counts)
                    weak = weak_raw - (1 if use > 0 else 0)  # libstdc++ keeps one extra weak count while owners exist
            kind = "shared_ptr" if name.startswith("shared_ptr<") else "weak_ptr"
            if target.get("block") is not None and target.get("offset"):
                # make_shared allocates the control block and the object together: the object is at this offset.
                ctx.setdefault("inplace", {})[target["block"]] = (target["offset"], self.prog.dw.ref(T.strip(fp[1]), A_TYPE))
                ctx["pointees"].pop(target["block"], None)
                target = dict(target, index=None, inplace=True)
            return {"t": "smart", "kind": kind, "target": target, "useCount": use, "weakCount": weak, "expired": kind == "weak_ptr" and use == 0, "type": "std::" + name}
        if name.startswith("vector<") and not name.startswith("vector<bool"):
            fs, ff, fe = self.member_path(t, "_M_start"), self.member_path(t, "_M_finish"), self.member_path(t, "_M_end_of_storage")
            if not (fs and ff and fe): return None
            start, finish, end = (self.read_ptr_at(mem, raw, x[0]) for x in (fs, ff, fe))
            et = self.prog.dw.ref(T.strip(fs[1]), A_TYPE)
            esize = T.size(et) or 1
            if start is None or finish is None or end is None or not (start <= finish <= end) or end - start > (1 << 31) or (start and self.owner_of(start) is None):
                return {"t": "uninit", "type": "std::" + name}  # not constructed yet (or already destroyed): its bytes mean nothing
            size = (finish - start) // esize if start and finish and finish >= start else 0
            cap = (end - start) // esize if start and end and end >= start else 0
            oid = ctx.get("id") or f"s{addr:x}"
            data = mem.read(start, min(size, MAX_ARRAY) * esize) if start and size else b""
            items = [self.decode(mem, et, start + k * esize, data[k * esize:(k + 1) * esize] if data else None, dict(ctx, id=f"{oid}[{k}]"), depth + 1) for k in range(min(size, MAX_ARRAY))]
            b = self.owner_of(start) if start else None
            if b is not None:
                ctx["pointees"].setdefault(b["id"], et)
            ctx["heap"][oid] = {"t": "array", "of": T.name(T.strip(et) or et), "len": size, "capacity": cap, "items": items, "addr": addr, "cls": "std::vector<" + T.name(T.strip(et) or et) + ">", "buffer": b["id"] if b else None}
            return {"t": "ref", "id": oid}
        if name.startswith("basic_string<char"):
            fp, fl = self.member_path(t, "_M_p"), self.member_path(t, "_M_string_length")
            if not fp or not fl: return None
            p = self.read_ptr_at(mem, raw, fp[0])
            n = self.read_ptr_at(mem, raw, fl[0]) or 0
            text = mem.read(p, min(n, 200)) if p and n else b""
            return {"t": "String", "v": (text or b"").decode("utf-8", "replace"), "len": n, "type": "std::string"}
        if name.startswith("array<"):
            fm = self.member_path(t, "_M_elems")
            if fm:
                return self.decode(mem, fm[1], addr + fm[0], raw[fm[0]:fm[0] + T.size(fm[1])], ctx, depth + 1)
        for prefix, field in (("map<", "_M_node_count"), ("set<", "_M_node_count"), ("multimap<", "_M_node_count"), ("multiset<", "_M_node_count"),
                              ("list<", "_M_size"), ("unordered_map<", "_M_element_count"), ("unordered_set<", "_M_element_count")):
            if name.startswith(prefix):
                fs = self.member_path(t, field)
                n = None
                if fs:
                    piece = raw[fs[0]:fs[0] + 8]
                    n = int.from_bytes(piece, "little") if len(piece) == 8 else None
                return {"t": "container", "cls": "std::" + name.split("<")[0], "size": n, "type": "std::" + name}
        if name.startswith("deque<"):
            return {"t": "container", "cls": "std::deque", "size": None, "type": "std::" + name}
        return None

    def _array_items(self, mem, et, esize, n, base, raw, ctx, depth):
        return [self.decode(mem, et, base + k * esize, raw[k * esize:(k + 1) * esize] if raw else None, dict(ctx, id=None), depth + 1) for k in range(min(n, MAX_ARRAY))]

    def pointer(self, mem, p, target, ctx, ref=False):
        """A pointer as a Val: null, into a heap block (live or freed), onto a stack or global variable, or unknown."""
        T = self.prog.types
        tname = T.name(target) + ("&" if ref else "*")
        if p == 0:
            return {"t": "null", "ptr": True, "type": tname}
        b = self.owner_of(p)
        if b is not None:
            off = p - b["addr"]
            if b["state"] == "freed":
                return {"t": "ptr", "v": hex(p), "state": "dangling", "block": b["id"], "offset": off, "type": tname}
            ctx["pointees"].setdefault(b["id"], target)
            esize = T.size(target) or 1
            val = {"t": "ref", "id": f"b{b['id']}", "ptr": True, "addr": hex(p), "block": b["id"], "offset": off, "index": off // esize if off % esize == 0 else None,
                   "state": "past-end" if off >= b["size"] else "live", "type": tname}
            return val
        for name, base, size, sid in ctx["stackvars"]:
            if base <= p < base + max(size, 1):
                return {"t": "ptr", "v": hex(p), "state": "stack", "var": name, "frameVar": sid, "offset": p - base, "type": tname}
        for name, base, size, gid in ctx["globalvars"]:
            if base <= p < base + max(size, 1):
                return {"t": "ptr", "v": hex(p), "state": "global", "var": name, "offset": p - base, "type": tname}
        tt = T.strip(target)
        if tt is not None and tt.tag == T_BASE and tt.get(A_BYTE_SIZE) == 1:
            text = mem.read(p, 64)
            if text and b"\0" in text:
                s = text[:text.index(b"\0")]
                if all(32 <= c < 127 or c in (9, 10) for c in s):
                    return {"t": "ptr", "v": hex(p), "state": "static", "string": s.decode(), "type": tname}
        return {"t": "ptr", "v": hex(p), "state": "unknown", "type": tname}

    def block_value(self, mem, b, target, ctx):
        """A heap block decoded by the type of the pointers into it; uninitialized bytes stay 'uninit'."""
        T = self.prog.types
        size = min(b["size"], MAX_BLOCK_BYTES)
        raw = mem.read(b["addr"], size) if size else b""
        esize = T.size(target) if target is not None else 0
        sub = dict(ctx, uninit=b["op"] in ("malloc", "new", "new[]", "realloc"))
        if not esize or raw is None:
            # No pointer says what it holds: its bytes, as characters where printable, ? where never written.
            def byte(x):
                if sub["uninit"] and x == UNINIT: return {"t": "uninit"}
                if 32 <= x < 127: return {"t": "char", "v": chr(x), "code": x}
                return {"t": "int", "v": x}
            return {"t": "array", "of": "unsigned char", "len": b["size"], "items": [byte(x) for x in (raw or b"")[:MAX_ARRAY]], "addr": b["addr"], "block": b["id"]}
        n = b["size"] // esize
        tt = T.strip(target)
        if n == 1 and tt is not None and tt.tag in (T_STRUCT, T_CLASS, T_UNION):
            v = self.decode(mem, target, b["addr"], raw[:esize], dict(sub, id=f"b{b['id']}"))
            obj = ctx["heap"].get(f"b{b['id']}")
            if obj is not None:
                obj["block"] = b["id"]
            return obj
        items = []
        for k in range(min(n, MAX_ARRAY)):
            items.append(self.decode(mem, target, b["addr"] + k * esize, raw[k * esize:(k + 1) * esize], dict(sub, id=f"b{b['id']}[{k}]")))
        return {"t": "array", "of": T.name(target), "len": n, "items": items, "addr": b["addr"], "block": b["id"]}

    # -- one step
    def record(self, pid, mem, pc, kind, ret=None):
        if len(self.steps) >= self.max_steps:
            raise StopIteration("steps")
        if time.monotonic() > self.deadline:
            raise StopIteration("timeout")
        P, T = self.prog, self.prog.types
        events = self.sync_heap(mem, len(self.steps))
        r = regs(pid)
        # Frames from the frame-pointer chain: (pc, rbp) for each project function.
        chain, rbp, cur = [], r.rbp, pc
        for _ in range(64):
            fdie, fname = P.func_at(cur)
            if fdie is None:
                break
            saved = mem.read(rbp, 16)
            ret_addr = struct.unpack("<QQ", saved)[1] if saved else 0
            if P.own_func(cur):  # standard-library templates compiled into the program are walked through, not shown
                chain.append((cur, rbp, fdie, fname, ret_addr))
            if fname == "main" or not saved:
                break
            rbp = struct.unpack("<QQ", saved)[0]
            cur = ret_addr - 1
        ctx = {"heap": {}, "pointees": {}, "stackvars": [], "globalvars": []}
        layouts = []
        for k, (fpc, fbp, fdie, fname, fret) in enumerate(chain[:MAX_FRAMES]):
            cfa = fbp + 16
            f, line = P.line_at(fpc)
            vs = []
            visited = self.visited.get(((fbp, fret), fname), set())
            for name, off, tdie, is_param, decl_line, artificial in P.variables(fdie, fpc):
                if not is_param and decl_line and line is not None and (decl_line > line or (decl_line == line and line not in visited)):
                    continue  # not declared yet, or its declaration is about to run for the first time
                vs.append((name, cfa + off, tdie, is_param, artificial))
            layouts.append((fpc, (fbp, fret), fdie, fname, f, line, vs))
            for name, addr, tdie, *_ in vs:
                ctx["stackvars"].append((name, addr, T.size(tdie), f"{k}:{name}"))
        for name, addr, tdie, _ in P.globals:
            ctx["globalvars"].append((name, addr, T.size(tdie), name))
        if self.cpp:
            self.lifetime(mem, layouts, events, len(self.steps), r.rsp, chain)
        frames, memframes, ids_now = [], [], set()
        for k, (fpc, ident, fdie, fname, f, line, vs) in enumerate(layouts):
            fbp = ident[0]
            key = (ident, fname)  # the same function at the same depth, called again, is a new frame
            if key not in self.frame_ids:
                self.frame_ids[key] = self.next_frame
                self.next_frame += 1
            fid = self.frame_ids[key]
            ids_now.add(key)
            locs, types, mvars = {}, {}, []
            for name, addr, tdie, is_param, artificial in vs:
                size = T.size(tdie)
                raw = mem.read(addr, min(size, 1 << 16)) if size else None
                locs[name] = self.decode(mem, tdie, addr, raw, ctx)
                types[name] = T.name(tdie)
                mvars.append({"name": name, "type": T.name(tdie), "addr": hex(addr), "size": size, "param": is_param})
            entry = {"id": fid, "depth": len(layouts) - 1 - k, "cls": "", "method": fname, "line": line, "locals": locs}
            if fid not in self.announced:
                self.announced.add(fid)
                entry["args"] = [n for n, a, t, p, art in vs if p and not art]
            if types != self.last_types.get(fid):
                entry["types"] = types
                self.last_types[fid] = types
            frames.append(entry)
            memframes.append({"id": fid, "function": fname, "file": f, "line": line, "vars": mvars, "cfa": hex(fbp + 16)})
        for key in list(self.frame_ids):
            if key not in ids_now:
                del self.frame_ids[key]
                self.visited.pop(key, None)
        for fpc, ident, fdie, fname, f, line, vs in layouts:
            self.visited.setdefault((ident, fname), set()).add(line)
        statics, mglobals = {}, []
        for name, addr, tdie, _ in P.globals[:32]:
            size = T.size(tdie)
            raw = mem.read(addr, min(size, 1 << 16)) if size else None
            statics[f"globals.{name}"] = self.decode(mem, tdie, addr, raw, ctx)
            mglobals.append({"name": name, "type": T.name(tdie), "addr": hex(addr), "size": size})
        # Heap blocks, decoded by the type of the pointers that refer to them.
        # A block's type is learned from the pointers into it, which may sit in other blocks (node->next):
        # decode in rounds until no new block types turn up.
        decoded = set()
        for bid, (off, ot) in ctx.get("inplace", {}).items():
            b = next((x for x in self.all_blocks if x["id"] == bid and x["state"] == "live"), None)
            if b is None:
                continue
            size = T.size(ot)
            val = self.decode(mem, ot, b["addr"] + off, mem.read(b["addr"] + off, size) if size else None, dict(ctx, id=f"b{bid}"))
            obj = ctx["heap"].get(f"b{bid}")
            if obj is None:  # make_shared<int> and the like: the managed value is not a class
                obj = ctx["heap"][f"b{bid}"] = {"t": "object", "cls": T.name(T.strip(ot) or ot), "fields": {"value": val}}
            if obj is not None:
                obj.update(block=bid, inplace=off, note="make_shared: the control block (owner counts) and the object in one allocation")
            decoded.add(bid)
        for _ in range(8):
            progress = False
            for b in self.all_blocks:
                if b["state"] == "live" and b["id"] not in decoded and ctx["pointees"].get(b["id"]) is not None:
                    obj = self.block_value(mem, b, ctx["pointees"][b["id"]], ctx)
                    if obj is not None:
                        ctx["heap"][f"b{b['id']}"] = obj
                    decoded.add(b["id"])
                    progress = True
            if not progress:
                break
        mblocks = []
        for b in self.all_blocks[-MAX_BLOCKS:]:
            entry = {k: b[k] for k in ("id", "size", "op", "state", "file", "line", "step") if k in b}
            entry["addr"] = hex(b["addr"])
            for k in ("freedLine", "freedFile", "freedStep", "freedBy", "from", "count", "zeroed"):
                if b.get(k) is not None: entry[k] = b[k]
            if "movedTo" in b: entry["movedTo"] = hex(b["movedTo"])
            target = ctx["pointees"].get(b["id"])
            if target is not None:
                entry["elemType"] = T.name(T.strip(target) or target)
            if b["id"] in ctx.get("inplace", {}):
                off, ot = ctx["inplace"][b["id"]]
                entry["inplace"] = {"offset": off, "type": T.name(T.strip(ot) or ot)}
                entry["elemSize"] = T.size(target)
            if b["state"] == "live" and b["id"] not in decoded:
                obj = self.block_value(mem, b, None, ctx)  # no pointer says what it holds: shown as bytes
                if obj is not None:
                    ctx["heap"][f"b{b['id']}"] = obj
            mblocks.append(entry)
        f, line = P.line_at(pc)
        top = frames[0] if frames else {"method": "?", "cls": ""}
        live = [b for b in self.all_blocks if b["state"] == "live"]
        step = {
            "kind": kind, "line": line, "sourcePath": f, "cls": "", "method": top["method"], "out": OUT.size(),
            "stackDepth": len(layouts), "stack": frames, "statics": statics, "heap": ctx["heap"],
            "memory": {
                "frames": memframes, "globals": mglobals, "blocks": mblocks, "events": events,
                "objects": [dict(o) for o in self.object_list[-64:]] if self.cpp else [],
                "stats": {"live": len(live), "liveBytes": sum(b["size"] for b in live), "freed": sum(1 for b in self.all_blocks if b["state"] == "freed"),
                          "allocations": len(self.all_blocks), "requestedBytes": sum(b["size"] for b in self.all_blocks), "peakBytes": self.peak},
            },
        }
        if ret is not None:
            step["ret"], step["retType"] = ret
        self.steps.append(step)


def mem_read_ptr(mem, value):
    """this is already an address (the frame's this parameter was decoded as a pointer value)."""
    return value if isinstance(value, int) and value > 0 else None


class Output:
    """Collects a pipe's bytes on a thread, so a chatty program never blocks on a full pipe."""
    def __init__(self, fd, limit):
        self.fd, self.limit, self.buf, self.truncated, self.lock = fd, limit, bytearray(), False, threading.Lock()
        self.t = threading.Thread(target=self.run, daemon=True)
        self.t.start()

    def run(self):
        while True:
            try:
                chunk = os.read(self.fd, 65536)
            except OSError:
                return
            if not chunk:
                return
            with self.lock:
                room = self.limit - len(self.buf)
                if room > 0:
                    self.buf += chunk[:room]
                if len(chunk) > room:
                    self.truncated = True

    def drain(self):
        """Takes whatever the program wrote up to now (it is stopped, so the pipe holds all of it)."""
        while True:
            r, _, _ = select.select([self.fd], [], [], 0)
            if not r:
                return
            time.sleep(0.001)
            with self.lock:
                pass
            if not select.select([self.fd], [], [], 0)[0]:
                return

    def size(self):
        self.drain()
        with self.lock:
            return len(self.buf.decode("utf-8", "replace"))

    def text(self):
        with self.lock:
            return self.buf.decode("utf-8", "replace")


OUT = None


def return_value(pid, prog, fdie):
    """At a function's closing brace the return value is in rax (integers, pointers) or xmm0 (floating point)."""
    T = prog.types
    rt = prog.dw.ref(fdie, A_TYPE)
    if rt is None:
        return ({"t": "void"}, "void")
    t = T.strip(rt)
    r = regs(pid)
    if t is not None and t.tag == T_BASE and t.get(A_ENCODING) == 0x04:
        raw = xmm0(pid)
        size = t.get(A_BYTE_SIZE, 8)
        return ({"t": "double" if size == 8 else "float", "v": struct.unpack("<d" if size == 8 else "<f", raw[:size])[0]}, T.name(rt))
    if t is not None and (t.tag in (T_BASE, T_ENUM, T_POINTER) or T.size(rt) <= 8):
        size = max(T.size(rt), 1)
        v = r.rax & ((1 << (8 * size)) - 1)
        if t.tag == T_BASE and t.get(A_ENCODING) in (0x05, 0x06) and v >= 1 << (8 * size - 1):
            v -= 1 << (8 * size)
        if t.tag == T_POINTER:
            return ({"t": "ptr", "v": hex(v)} if v else {"t": "null"}, T.name(rt))
        if t.tag == T_BASE and t.get(A_ENCODING) == 0x02:
            return ({"t": "boolean", "v": bool(v)}, T.name(rt))
        return ({"t": "int", "v": v}, T.name(rt))
    return None


def main(argv):
    global OUT
    program, src, req_path, result_path = argv[1:5]
    req = json.load(open(req_path, encoding="utf-8"))
    cpp = req.get("language") == "cpp"
    result = {"steps": [], "stepCount": 0, "truncated": False, "stopReason": None, "stdout": "", "stderr": "", "exitCode": None,
              "io": [], "ioTruncated": False, "stdin": req.get("stdin") or "", "classes": {}}
    try:
        prog = Program(program, src, cpp)
    except Exception as e:
        result["error"] = f"Could not read the program's debug information: {e}"
        json.dump(result, open(result_path, "w"))
        return
    in_r, in_w = os.pipe()
    out_r, out_w = os.pipe()
    err_r, err_w = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.dup2(in_r, 0); os.dup2(out_w, 1); os.dup2(err_w, 2)
        for fd in (in_r, in_w, out_r, out_w, err_r, err_w):
            os.close(fd)
        libc.ptrace(PTRACE_TRACEME, 0, None, None)
        os.execv(program, [program])
    os.close(in_r); os.close(out_w); os.close(err_w)
    OUT = Output(out_r, int(req.get("maxOutput", 65536)))
    err = Output(err_r, int(req.get("maxOutput", 65536)))
    def feed():
        try:
            os.write(in_w, (req.get("stdin") or "").encode())
        except OSError:
            pass
        os.close(in_w)
    threading.Thread(target=feed, daemon=True).start()
    rec = Recorder(prog, req, cpp)
    _, status = os.waitpid(pid, 0)
    try:
        ptrace(PTRACE_SETOPTIONS, pid, 0, PTRACE_O_EXITKILL)
    except OSError:
        pass
    mem = Memory(pid)
    original = {}
    for a in prog.breaks:
        b = mem.read(a, 1)
        if b:
            original[a] = b
            mem.write(a, b"\xcc")
    stop, exit_code, exception = None, None, None
    try:
        sig = 0
        while True:
            ptrace(PTRACE_CONT, pid, 0, sig)
            sig = 0
            _, status = os.waitpid(pid, 0)
            if os.WIFEXITED(status):
                exit_code = os.WEXITSTATUS(status)
                break
            if os.WIFSIGNALED(status):
                exit_code = 128 + os.WTERMSIG(status)
                break
            s = os.WSTOPSIG(status)
            r = regs(pid)
            if s == signal.SIGTRAP and (r.rip - 1) in original:
                bp = r.rip - 1
                r.rip = bp
                set_regs(pid, r)
                fdie = prog.exits.get(bp)
                ret = return_value(pid, prog, fdie) if fdie is not None else None
                rec.record(pid, mem, bp, "return" if fdie is not None and prog.func_at(bp)[1] != "main" else "line", ret if fdie is not None and prog.func_at(bp)[1] != "main" else None)
                mem.write(bp, original[bp])
                ptrace(PTRACE_SINGLESTEP, pid, 0, 0)
                _, status = os.waitpid(pid, 0)
                if os.WIFEXITED(status) or os.WIFSIGNALED(status):
                    exit_code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status)
                    break
                mem.write(bp, b"\xcc")
                continue
            if s == signal.SIGTRAP:
                continue
            # A real signal (segfault, abort, ...): record where it happened, then let it take effect.
            if s in (signal.SIGSEGV, signal.SIGBUS, signal.SIGFPE, signal.SIGABRT, signal.SIGILL):
                fdie, fname = prog.func_at(r.rip)
                names = {signal.SIGSEGV: "SIGSEGV", signal.SIGBUS: "SIGBUS", signal.SIGFPE: "SIGFPE", signal.SIGABRT: "SIGABRT", signal.SIGILL: "SIGILL"}
                exception = {"type": names[s], "message": "Stopped by " + names[s]}
                if fdie is not None:
                    f, line = prog.line_at(r.rip)
                    exception.update(sourcePath=f, line=line, method=fname)
                    try:
                        rec.max_steps += 1
                        rec.record(pid, mem, r.rip, "exception")
                    except StopIteration:
                        pass
            sig = s
    except StopIteration as e:
        stop = str(e)
        try:
            os.kill(pid, signal.SIGKILL); os.waitpid(pid, 0)
        except OSError:
            pass
    OUT.t.join(timeout=2); err.t.join(timeout=2)
    leaked = [b for b in rec.all_blocks if b["state"] == "live"]
    result.update(steps=rec.steps, stepCount=len(rec.steps), truncated=stop is not None, stopReason=stop, stdout=OUT.text(), stderr=err.text(),
                  stdoutTruncated=OUT.truncated, stderrTruncated=err.truncated, exitCode=None if stop else exit_code)
    if exception:
        result["exception"] = exception
    result["memorySummary"] = {
        "allocations": len(rec.all_blocks), "freed": sum(1 for b in rec.all_blocks if b["state"] == "freed"),
        "requestedBytes": sum(b["size"] for b in rec.all_blocks), "peakBytes": rec.peak,
        "leakedAtExit": [{"id": b["id"], "size": b["size"], "file": b["file"], "line": b["line"]} for b in leaked] if stop is None else None,
        "logDropped": rec.dropped,
    }
    def safe(v):
        if isinstance(v, bool) or v is None: return v
        if isinstance(v, int): return v if -(1 << 63) <= v < (1 << 63) else str(v)
        if isinstance(v, float): return v if v == v and v not in (float("inf"), float("-inf")) else None
        if isinstance(v, dict): return {k: safe(x) for k, x in v.items()}
        if isinstance(v, list): return [safe(x) for x in v]
        return v
    json.dump(safe(result), open(result_path, "w", encoding="utf-8"))


if __name__ == "__main__":
    main(sys.argv)
