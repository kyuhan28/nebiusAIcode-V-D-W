// std::vector growth.
// When a vector runs out of capacity it allocates a bigger buffer, moves the elements, and frees
// the old one: watch the blocks in the Memory tab. size() is how many elements it holds;
// capacity() is how many fit before the next reallocation (the growth rule is up to the library).
#include <iostream>
#include <vector>

int main() {
    std::vector<int> v;
    for (int i = 1; i <= 5; i++) {
        v.push_back(i * 10);
        std::cout << "size " << v.size() << " capacity " << v.capacity() << "\n";
    }
    return 0;
}
