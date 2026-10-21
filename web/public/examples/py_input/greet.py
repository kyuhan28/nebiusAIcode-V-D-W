"""Reading input: input() returns one line of text; int() and float() convert it.

Press Run and type your answers in the terminal. For Visualize, put them in Given input
(Expected Output & Given Inputs tab); delete a line there to see EOFError.
"""
name = input("What is your name? ")
age = int(input("How old are you? "))
print(f"Hello, {name}!")
print(f"Next year, you will be {age + 1}.")

a, b = map(int, input("Two numbers: ").split())
print(f"{a} + {b} = {a + b}")
