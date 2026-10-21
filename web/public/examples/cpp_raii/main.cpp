// RAII: a resource tied to an object's lifetime.
// The constructor acquires, the destructor releases, and C++ runs destructors automatically when a
// scope ends, in reverse order of construction, even on early return.
#include <iostream>
#include <string>

class Resource {
    std::string name_;
public:
    explicit Resource(std::string name) : name_(std::move(name)) { std::cout << "acquire " << name_ << "\n"; }
    ~Resource() { std::cout << "release " << name_ << "\n"; }
};

int main() {
    Resource outer("outer");
    {
        Resource a("a");
        Resource b("b");
    }
    std::cout << "end of main\n";
    return 0;
}
