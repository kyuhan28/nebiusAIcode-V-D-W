// Objects on the stack, and references.
// origin and corner live in main's frame. area() takes references: other names for main's objects,
// not copies and not pointer variables. At the end of main, the objects are destroyed in reverse
// order of construction.
#include <iostream>

struct Point {
    int x;
    int y;
    Point(int x, int y) : x(x), y(y) {}
    ~Point() { std::cout << "~Point(" << x << "," << y << ")\n"; }
};

int area(const Point& a, const Point& b) {
    int w = b.x - a.x;
    int h = b.y - a.y;
    return w * h;
}

int main() {
    Point origin(0, 0);
    Point corner(3, 4);
    int result = area(origin, corner);
    std::cout << "area " << result << "\n";
    return 0;
}
