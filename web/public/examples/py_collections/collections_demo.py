"""Lists, dictionaries, sets, tuples, slicing, and comprehensions."""
scores = [72, 95, 88]
scores.append(64)
scores.sort()
top = scores[-2:]

ages = {"ann": 31, "bo": 22}
ages["cy"] = 27
oldest = max(ages, key=ages.get)

seen = {3, 1, 4}
seen.add(1)
point = (3, 4)
squares = [n * n for n in range(5)]
evens = {n for n in squares if n % 2 == 0}

print(scores, top, ages, oldest)
print(sorted(seen), point, squares, sorted(evens))
