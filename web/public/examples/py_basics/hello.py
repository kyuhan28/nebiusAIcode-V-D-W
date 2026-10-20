"""Python basics: variables, dynamic types, arithmetic, and f-strings.

Visualize it and watch each variable appear with its runtime type, and change type when it is
given a value of a different kind.
"""
greeting = "Hello"
count = 42
average = 91.75
found = True
nothing = None

print(f"{greeting}, world!")
print(count, type(count).__name__)
print(average * 2, count // 5, count % 5, 2 ** 10)

count = "forty-two"  # the same name, now a str
print(count, type(count).__name__, found, nothing)
