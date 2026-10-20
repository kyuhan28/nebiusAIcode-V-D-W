package examples.inheritance.animals;

public class Cat extends Animal {
    public Cat(String name) {
        super(name);
    }

    @Override
    protected String sound() {
        return "Meow";
    }
}
