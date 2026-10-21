// Standard containers.
// vector keeps elements side by side; map and set keep them sorted in a tree; unordered_map
// hashes them; stack, queue, and priority_queue adapt another container.
#include <iostream>
#include <map>
#include <queue>
#include <set>
#include <stack>
#include <string>
#include <unordered_map>
#include <vector>

int main() {
    std::vector<int> nums{4, 1, 3};
    std::map<std::string, int> ages{{"ann", 31}, {"bob", 25}};
    std::set<int> unique{3, 1, 3, 2};
    std::unordered_map<std::string, int> counts;
    counts["x"] += 2;
    std::stack<int> st;
    st.push(1);
    st.push(2);
    std::queue<int> q;
    q.push(5);
    std::priority_queue<int> pq;
    for (int n : nums) pq.push(n);
    std::cout << ages["bob"] << " " << unique.size() << " " << counts["x"] << " " << st.top() << " " << q.front() << " " << pq.top() << "\n";
    return 0;
}
