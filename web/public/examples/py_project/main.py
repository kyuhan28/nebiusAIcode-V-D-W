"""A multi-file project: main.py imports the geometry package, which uses a relative import."""
from geometry.report import describe

for shape in [("circle", 1), ("rectangle", 2, 3)]:
    print(describe(*shape))
