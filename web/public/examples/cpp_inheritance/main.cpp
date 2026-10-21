// Inheritance and polymorphism.
// A Dog object contains its Animal part. Calling speak() through an Animal pointer runs the
// version of the object's real type (virtual dispatch). unique_ptr deletes each pet when the
// vector goes away; the virtual destructor makes that delete run the right destructor.
#include <iostream>
#include <memory>
#include <string>
#include <vector>

class Animal {
protected:
    std::string name_;
public:
    explicit Animal(std::string name) : name_(std::move(name)) {}
    virtual ~Animal() = default;
    virtual std::string speak() const { return "..."; }
    const std::string& name() const { return name_; }
};

class Dog : public Animal {
public:
    explicit Dog(std::string name) : Animal(std::move(name)) {}
    std::string speak() const override { return "Woof"; }
};

class Cat : public Animal {
public:
    explicit Cat(std::string name) : Animal(std::move(name)) {}
    std::string speak() const override { return "Meow"; }
};

int main() {
    std::vector<std::unique_ptr<Animal>> pets;
    pets.push_back(std::make_unique<Dog>("Rex"));
    pets.push_back(std::make_unique<Cat>("Tom"));
    for (const auto& pet : pets) {
        std::cout << pet->name() << ": " << pet->speak() << "\n";
    }
    return 0;
}
