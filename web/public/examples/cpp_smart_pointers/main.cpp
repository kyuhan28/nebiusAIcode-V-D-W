// std::unique_ptr, std::shared_ptr, and std::weak_ptr.
// unique_ptr has one owner and can only be moved. shared_ptr counts its owners and frees the object
// when the last one goes away. weak_ptr watches without owning.
#include <iostream>
#include <memory>

int main() {
    std::unique_ptr<int> a = std::make_unique<int>(5);
    std::unique_ptr<int> b = std::move(a);
    std::cout << "a is " << (a ? "set" : "empty") << ", *b = " << *b << "\n";
    std::weak_ptr<int> watcher;
    {
        std::shared_ptr<int> first = std::make_shared<int>(7);
        std::shared_ptr<int> second = first;
        watcher = first;
        std::cout << "owners: " << first.use_count() << "\n";
    }
    std::cout << "expired: " << (watcher.expired() ? "yes" : "no") << "\n";
    return 0;
}
