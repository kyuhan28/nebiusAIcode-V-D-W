"""Pascal's triangle by plain recursion, with no cache: the same values are computed again and
again. Compare the call count with pascal_memo.py. Input: rows, 1 to 7 (6 if none is given)."""
calls = 0


def pascal(r, c):
    global calls
    calls += 1
    if c == 0 or c == r:
        return 1
    return pascal(r - 1, c - 1) + pascal(r - 1, c)


try:
    n = int(input())
except (EOFError, ValueError):
    n = 6
if not 1 <= n <= 7:
    print("Choose between 1 and 7 rows; building 6.")
    n = 6

for r in range(n):
    print([pascal(r, c) for c in range(r + 1)])
print(f"{calls} calls without a cache")
