#!/usr/bin/env python3
"""
Generate Workflow app icons (PNG, ICO, SVG) from one squircle source.
"""

from __future__ import annotations

from math import copysign, cos, pi, sin
from pathlib import Path

from PIL import Image, ImageDraw

BASE_DIR = Path(__file__).resolve().parent

PRIMARY = (37, 98, 205)  # #2562cd
PRIMARY_LIGHT = (96, 173, 247)  # #60adf7
PRIMARY_DEEP = (25, 72, 176)  # #1948b0
LETTER = (240, 240, 240, 255)
SQUIRCLE_EXPONENT = 4.2

# Stable vector outline for the "W" so all renderers get the same shape.
W_POINTS = [
    (0.120, 0.240),
    (0.260, 0.240),
    (0.370, 0.790),
    (0.470, 0.240),
    (0.530, 0.240),
    (0.630, 0.790),
    (0.740, 0.240),
    (0.880, 0.240),
    (0.705, 0.820),
    (0.560, 0.820),
    (0.500, 0.525),
    (0.440, 0.820),
    (0.295, 0.820),
]

def ensure_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def scale_points(points: list[tuple[float, float]], size: int) -> list[tuple[float, float]]:
    return [(x * size, y * size) for x, y in points]


def superellipse_points(
    size: int,
    *,
    inset: float = 0.0,
    exponent: float = SQUIRCLE_EXPONENT,
    samples: int = 512,
) -> list[tuple[float, float]]:
    center = (size - 1) / 2.0
    radius = max(1.0, center - inset)
    power = 2.0 / exponent
    points: list[tuple[float, float]] = []
    for i in range(samples):
        theta = (2.0 * pi * i) / samples
        x_unit = copysign(abs(cos(theta)) ** power, cos(theta))
        y_unit = copysign(abs(sin(theta)) ** power, sin(theta))
        points.append((center + (x_unit * radius), center + (y_unit * radius)))
    return points


def make_squircle_mask(size: int, *, inset: float = 0.0) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon(superellipse_points(size, inset=inset), fill=255)
    return mask


def build_split_tone(size: int) -> Image.Image:
    base = Image.new("RGBA", (size, size), PRIMARY + (255,))
    draw = ImageDraw.Draw(base)
    draw.polygon([(size * 0.45, 0), (size, 0), (size, size * 0.55)], fill=PRIMARY_LIGHT + (255,))
    draw.polygon([(0, size * 0.55), (size * 0.55, size), (0, size)], fill=PRIMARY_DEEP + (255,))
    return base


def draw_w(icon: Image.Image) -> None:
    draw = ImageDraw.Draw(icon)
    draw.polygon(scale_points(W_POINTS, icon.size[0]), fill=LETTER)


def build_icon(size: int) -> Image.Image:
    squircle_mask = make_squircle_mask(size)
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    icon.paste(build_split_tone(size), (0, 0), squircle_mask)
    draw_w(icon)
    return icon


def points_to_svg_path(points: list[tuple[float, float]]) -> str:
    segments = [f"M {points[0][0]:.3f} {points[0][1]:.3f}"]
    segments.extend(f"L {x:.3f} {y:.3f}" for x, y in points[1:])
    segments.append("Z")
    return " ".join(segments)


def write_svg(path: Path, size: int = 1080) -> None:
    squircle_path = points_to_svg_path(superellipse_points(size, samples=128))
    w_path = points_to_svg_path(scale_points(W_POINTS, size))
    svg = f"""<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="squircle-clip">
      <path d="{squircle_path}"/>
    </clipPath>
  </defs>
  <path d="{squircle_path}" fill="#2562CD"/>
  <g clip-path="url(#squircle-clip)">
    <polygon points="{size * 0.45:.3f},0 {size:.3f},0 {size:.3f},{size * 0.55:.3f}" fill="#60ADF7"/>
    <polygon points="0,{size * 0.55:.3f} {size * 0.55:.3f},{size:.3f} 0,{size:.3f}" fill="#1948B0"/>
  </g>
  <path d="{w_path}" fill="#F0F0F0"/>
</svg>
"""
    ensure_dir(path)
    path.write_text(svg, encoding="utf-8")


def main() -> None:
    outputs = [
        (BASE_DIR / "assets" / "app-icon-1080.png", 1080),
        (BASE_DIR / "src-tauri" / "icons" / "icon.png", 512),
        (BASE_DIR / "src-tauri" / "icons" / "128x128.png", 128),
        (BASE_DIR / "src-tauri" / "icons" / "32x32.png", 32),
        (BASE_DIR / "assets" / "icon.png", 256),
        (BASE_DIR / "web" / "assets" / "app-icon.png", 256),
        (BASE_DIR / "web" / "favicon-32.png", 32),
        (BASE_DIR / "web" / "icon-180.png", 180),
    ]

    for path, size in outputs:
        ensure_dir(path)
        icon = build_icon(size)
        icon.save(path, "PNG")
        print(f"Created {path} ({size}px)")

    ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    ico_base = build_icon(256)
    tauri_ico = BASE_DIR / "src-tauri" / "icons" / "icon.ico"
    ensure_dir(tauri_ico)
    ico_base.save(tauri_ico, sizes=ico_sizes)
    print(f"Created {tauri_ico}")

    web_ico = BASE_DIR / "web" / "favicon.ico"
    ensure_dir(web_ico)
    ico_base.save(web_ico, sizes=ico_sizes)
    print(f"Created {web_ico}")

    svg_targets = [
        BASE_DIR / "assets" / "app-icon.svg",
        BASE_DIR / "web" / "assets" / "app-icon.svg",
    ]
    for target in svg_targets:
        write_svg(target)
        print(f"Created {target}")


if __name__ == "__main__":
    main()
