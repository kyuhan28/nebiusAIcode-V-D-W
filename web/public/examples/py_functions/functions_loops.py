"""Functions, loops, and recursion. Each call of factorial is its own frame with its own n."""


def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)


def fizzbuzz(limit):
    words = []
    for i in range(1, limit + 1):
        if i % 15 == 0:
            words.append("FizzBuzz")
        elif i % 3 == 0:
            words.append("Fizz")
        elif i % 5 == 0:
            words.append("Buzz")
        else:
            words.append(str(i))
    return words


total = 0
k = 10
while k > 0:
    total += k
    k -= 3

print(factorial(5), total)
print(" ".join(fizzbuzz(15)))
