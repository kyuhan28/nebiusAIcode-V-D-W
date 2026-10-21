// Copy and move semantics.
// Buffer owns a heap array. Copying allocates a new block and copies the values; moving takes over
// the source's block and leaves the source empty. Watch the blocks and the Objects list in Memory.
#include <iostream>
#include <utility>

class Buffer {
    int* data_;
    int size_;
public:
    explicit Buffer(int n) : data_(new int[n]), size_(n) {
        for (int i = 0; i < n; i++) data_[i] = i;
    }
    Buffer(const Buffer& other) : data_(new int[other.size_]), size_(other.size_) {
        for (int i = 0; i < size_; i++) data_[i] = other.data_[i];
    }
    Buffer(Buffer&& other) noexcept : data_(other.data_), size_(other.size_) {
        other.data_ = nullptr;
        other.size_ = 0;
    }
    Buffer& operator=(const Buffer& other) {
        if (this != &other) {
            Buffer copy(other);
            std::swap(data_, copy.data_);
            std::swap(size_, copy.size_);
        }
        return *this;
    }
    ~Buffer() { delete[] data_; }
    int size() const { return size_; }
};

int main() {
    Buffer a(3);
    Buffer b = a;               // copy constructor: b gets its own block
    Buffer c = std::move(a);    // move constructor: c takes a's block; a is left empty
    b = c;                      // copy assignment
    std::cout << "a " << a.size() << " b " << b.size() << " c " << c.size() << "\n";
    return 0;
}
