// new and delete, new[] and delete[].
// new allocates and constructs one object; delete destroys and releases it. new[] needs delete[].
#include <iostream>

struct Account {
    int id;
    double balance;
};

int main() {
    Account *one = new Account{1, 50.0};
    int *many = new int[4]{2, 4, 6, 8};
    one->balance += many[3];
    std::cout << "account " << one->id << " has " << one->balance << "\n";
    delete one;
    delete[] many;
    return 0;
}
