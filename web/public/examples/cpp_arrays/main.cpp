// Arrays and pointer arithmetic in C++.
// A built-in array walked with a pointer (p + 1 is the next element), std::array (which knows its
// size), and an array on the heap from new[], which must be released with delete[].
#include <array>
#include <iostream>

int main() {
    int raw[4] = {5, 10, 15, 20};
    int sum = 0;
    for (int* p = raw; p != raw + 4; ++p) {
        sum += *p;
    }
    std::array<int, 3> safe = {1, 2, 3};
    int* heap = new int[3]{7, 8, 9};
    std::cout << "sum " << sum << " safe " << safe.size() << " third " << *(heap + 2) << "\n";
    delete[] heap;
    return 0;
}
