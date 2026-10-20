"""Reading input: input() returns one line of text; int() and float() convert it.

The Input tab feeds the program. Try changing it, or delete a line to see EOFError.
"""
name = input("What is your name? ")
age = int(input("How old are you? "))
print(f"Hello, {name}!")
print(f"Next year, you will be {age + 1}.")

a, b = map(int, input("Two numbers: ").split())
print(f"{a} + {b} = {a + b}")
