"""Inheritance across two files. Open the Inheritance tab and step through:
each speak() call runs the version the object's own class provides or inherits."""
from animals import Cat, Dog, ServiceDog

pets = [Dog("Rex"), Cat("Tom"), ServiceDog("Max", "guide people")]
for pet in pets:
    print(pet.speak())
