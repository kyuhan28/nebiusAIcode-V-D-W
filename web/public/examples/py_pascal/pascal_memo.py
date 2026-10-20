"""Pascal's triangle, top-down with memoization: pascal(r, c) asks for the two values above it,
and every value it works out is kept in the memo dictionary, so asking again is a lookup.

Input: how many rows, 1 to 10 (6 if none is given).
"""
memo = {}
calls = 0
hits = 0


def pascal(r, c):
    global calls, hits
    calls += 1
    if c == 0 or c == r:
        return 1
    if (r, c) in memo:
        hits += 1
        return memo[(r, c)]
    value = pascal(r - 1, c - 1) + pascal(r - 1, c)
    memo[(r, c)] = value
    return value


try:
    n = int(input())
except (EOFError, ValueError):
    n = 6
if not 1 <= n <= 10:
    print("Choose between 1 and 10 rows; building 6.")
    n = 6

for r in range(n):
    print([pascal(r, c) for c in range(r + 1)])
print(f"{calls} calls, {hits} answered from the cache")
