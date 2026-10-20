package examples.inheritance.animals;

public class Dog extends Animal {
    public Dog(String name) {
        super(name);
    }

    @Override
    protected String sound() {
        return "Woof";
    }
}
