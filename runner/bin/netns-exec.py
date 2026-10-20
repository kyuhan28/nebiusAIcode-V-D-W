#!/usr/bin/env python3
"""Bring up loopback inside a fresh network namespace, then exec the given command.

Used by the runner so the Java debugger can attach to the traced program over 127.0.0.1
while the program itself has no route to any outside network.
"""
import fcntl
import os
import socket
import struct
import sys

SIOCGIFFLAGS = 0x8913
SIOCSIFFLAGS = 0x8914
IFF_UP = 0x1


def loopback_up():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        ifreq = struct.pack("16sh14s", b"lo", 0, b"\x00" * 14)
        flags = struct.unpack("16sh14s", fcntl.ioctl(s, SIOCGIFFLAGS, ifreq))[1]
        fcntl.ioctl(s, SIOCSIFFLAGS, struct.pack("16sh14s", b"lo", flags | IFF_UP, b"\x00" * 14))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: netns-exec.py command [args...]")
    loopback_up()
    os.execvp(sys.argv[1], sys.argv[1:])
