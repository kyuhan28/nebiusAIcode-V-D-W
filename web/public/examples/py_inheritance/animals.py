"""Classes for main.py: Dog and Cat override sound(); ServiceDog extends Dog and uses super()."""


class Animal:
    def __init__(self, name):
        self.name = name

    def sound(self):
        return "..."

    def speak(self):
        return f"{self.name} says {self.sound()}"


class Dog(Animal):
    def sound(self):
        return "Woof"


class Cat(Animal):
    def sound(self):
        return "Meow"


class ServiceDog(Dog):
    def __init__(self, name, task):
        super().__init__(name)
        self.task = task

    def speak(self):
        return super().speak() + f", and is trained to {self.task}"
