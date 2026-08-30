class Solution:
    def balancePoint(self, values: list[int]) -> int:
        total = sum(values)
        left = 0
        for i, v in enumerate(values):
            if left * 2 + v == total:
                return i
            left += v
        return -1
