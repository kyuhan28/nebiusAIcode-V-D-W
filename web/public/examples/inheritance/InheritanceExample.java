package examples.inheritance;

import examples.inheritance.animals.Animal;
import examples.inheritance.animals.Cat;
import examples.inheritance.animals.Dog;
import examples.inheritance.animals.ServiceDog;

/**
 * Inheritance and polymorphism across files and packages.
 *
 * Animal is abstract. Dog and Cat extend it, and ServiceDog extends Dog, so a ServiceDog is a
 * Dog and an Animal too. A variable declared as Animal can hold any of them; which method runs
 * is decided by the object, not the variable. Open the Inheritance tab and step through.
 */
public class InheritanceExample {
    public static void main(String[] args) {
        Animal pet = new Dog("Rex");
        pet.speak();

        Animal[] animals = { pet, new Cat("Tom"), new ServiceDog("Max", "guide people") };
        for (Animal a : animals) {
            a.speak();
        }

        pet.eat(5);
        System.out.println(pet.describe());

        ServiceDog max = (ServiceDog) animals[2];
        System.out.println(max.command());
    }
}
