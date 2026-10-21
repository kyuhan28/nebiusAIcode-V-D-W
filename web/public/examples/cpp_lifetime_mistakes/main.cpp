// Safe demonstrations of C++ lifetime mistakes.
// By default only the safe path runs. Change the Input and press Run:
//   dangling  uses a reference to a local that no longer exists (the sanitizers stop it),
//   moved     reads a moved-from string (valid but unspecified; with this library it is empty),
//   weak      shows a weak_ptr expiring instead of dangling.
#include <iostream>
#include <memory>
#include <string>

const int& broken() {
    int local = 42;
    return local;    // the reference outlives local: using it is undefined behavior
}

int main() {
    std::string mode;
    if (!(std::cin >> mode)) mode = "safe";
    if (mode == "dangling") {
        const int& r = broken();
        std::cout << r << "\n";
    } else if (mode == "moved") {
        std::string a = "text";
        std::string b = std::move(a);
        std::cout << "b=" << b << " a has " << a.size() << " characters\n";
    } else if (mode == "weak") {
        std::weak_ptr<int> w;
        {
            auto owner = std::make_shared<int>(5);
            w = owner;
        }
        std::cout << (w.expired() ? "the object is gone; lock() gives nullptr" : "still alive") << "\n";
    } else {
        std::cout << "safe: nothing invalid happened\n";
    }
    return 0;
}
