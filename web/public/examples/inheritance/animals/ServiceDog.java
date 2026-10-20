package examples.inheritance.animals;

/** A Dog that is also Trained: two levels below Animal. */
public class ServiceDog extends Dog implements Trained {
    private final String task;

    public ServiceDog(String name, String task) {
        super(name);
        this.task = task;
    }

    /** Adds to the inherited speak() instead of replacing it. */
    @Override
    public void speak() {
        super.speak();
        System.out.println(name + " is trained to " + task);
    }

    @Override
    public String command() {
        return name + ", " + task + "!";
    }
}
