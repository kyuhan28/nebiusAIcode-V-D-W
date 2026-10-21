// Constructors and destructors: the order things are built and destroyed.
// A Car is a Vehicle with an Engine member. Its constructor first builds the Vehicle part, then the
// engine, then runs its own body. Destruction runs in exactly the reverse order.
#include <iostream>

struct Engine {
    Engine() { std::cout << "Engine built\n"; }
    ~Engine() { std::cout << "Engine destroyed\n"; }
};

struct Vehicle {
    Vehicle() { std::cout << "Vehicle built\n"; }
    virtual ~Vehicle() { std::cout << "Vehicle destroyed\n"; }
};

struct Car : Vehicle {
    Engine engine;
    Car() { std::cout << "Car built\n"; }
    ~Car() override { std::cout << "Car destroyed\n"; }
};

int main() {
    Car car;
    std::cout << "driving\n";
    return 0;
}
