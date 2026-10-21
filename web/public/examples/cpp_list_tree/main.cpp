// A linked list and a binary search tree owned by smart pointers.
// Each node owns the next one (or its children) through a unique_ptr, so when head and root go
// away at the end of main, every node is destroyed and freed automatically: no delete anywhere.
#include <iostream>
#include <memory>

struct ListNode {
    int value;
    std::unique_ptr<ListNode> next;
};

struct TreeNode {
    int value;
    std::unique_ptr<TreeNode> left, right;
};

void insert(std::unique_ptr<TreeNode>& root, int value) {
    if (!root) {
        root = std::make_unique<TreeNode>();
        root->value = value;
        return;
    }
    insert(value < root->value ? root->left : root->right, value);
}

int sum(const TreeNode* t) {
    return t ? t->value + sum(t->left.get()) + sum(t->right.get()) : 0;
}

int main() {
    std::unique_ptr<ListNode> head;
    for (int v = 3; v >= 1; v--) {
        auto node = std::make_unique<ListNode>();
        node->value = v;
        node->next = std::move(head);
        head = std::move(node);
    }
    std::unique_ptr<TreeNode> root;
    for (int v : {50, 30, 70, 20}) insert(root, v);
    std::cout << "first " << head->value << " tree sum " << sum(root.get()) << "\n";
    return 0;
}
