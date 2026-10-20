from .shapes import circle_area, rectangle_area


def describe(kind, *size):
    area = circle_area(*size) if kind == "circle" else rectangle_area(*size)
    return f"{kind} {size}: area {area:.2f}"
