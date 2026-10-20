package examples.inheritance.animals;

/** Every animal has a name and energy, and speaks with its own sound. */
public abstract class Animal {
    protected final String name;
    private int energy = 10;

    protected Animal(String name) {
        this.name = name;
    }

    /** Each kind of animal must say what its sound is. */
    protected abstract String sound();

    /** Shared by every animal unless a subclass overrides it. */
    public void speak() {
        System.out.println(name + " says " + sound());
    }

    /** Inherited by every subclass and never overridden. */
    public void eat(int amount) {
        energy += amount;
        System.out.println(name + " eats, energy is now " + energy);
    }

    public String describe() {
        return name + " is a " + getClass().getSimpleName() + " with energy " + energy;
    }
}
