"""Pascal's triangle, bottom-up (tabulation): each row is built from the row above it.
The first and last values of a row are 1; every value inside is the sum of the two above it.

Input: how many rows, 1 to 12 (6 if none is given). Open the Dynamic programming tab.
"""
try:
    n = int(input())
except (EOFError, ValueError):
    n = 6
if not 1 <= n <= 12:
    print("Choose between 1 and 12 rows; building 6.")
    n = 6

triangle = [[0] * (r + 1) for r in range(n)]
for r in range(n):
    triangle[r][0] = 1
    triangle[r][r] = 1
    for c in range(1, r):
        triangle[r][c] = triangle[r - 1][c - 1] + triangle[r - 1][c]

for row in triangle:
    print(row)
