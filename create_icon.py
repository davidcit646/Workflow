#!/usr/bin/env python3
"""
Generate Workflow app icons (PNG, ICO, SVG).
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BASE_DIR = Path(__file__).resolve().parent

PRIMARY = (26, 115, 232)  # #1a73e8
PRIMARY_DARK = (19, 93, 214)
PRIMARY_LIGHT = (90, 176, 255)
PRIMARY_DEEP = (12, 66, 175)


def blend(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def load_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        "/usr/share/fonts/open-sans/OpenSans-ExtraBold.ttf",
        "/usr/share/fonts/open-sans/OpenSans-Bold.ttf",
        "/usr/share/fonts/liberation-sans-fonts/LiberationSans-Bold.ttf",
        "/usr/share/fonts/google-droid-sans-fonts/DroidSans-Bold.ttf",
        "/usr/share/fonts/google-noto/NotoSans-CondensedExtraBold.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def build_split_tone(size: int) -> Image.Image:
    base = Image.new("RGBA", (size, size), PRIMARY_DARK + (255,))
    draw = ImageDraw.Draw(base)

    # Diagonal accents (Option C style) to keep high contrast behind the white W.
    draw.polygon([(size * 0.45, 0), (size, 0), (size, size * 0.55)], fill=PRIMARY_LIGHT + (255,))
    draw.polygon([(0, size * 0.55), (size * 0.55, size), (0, size)], fill=PRIMARY_DEEP + (255,))

    ring_pad = int(size * 0.08)
    draw.rounded_rectangle(
        [ring_pad, ring_pad, size - 1 - ring_pad, size - 1 - ring_pad],
        radius=int(size * 0.18),
        outline=(255, 255, 255, 36),
        width=max(1, int(size * 0.02)),
    )
    return base


def apply_round_mask(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, img.size[0], img.size[1]], radius=radius, fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def get_icon_font(size: int, target_ratio: float = 0.78) -> ImageFont.FreeTypeFont:
    # Choose a font size that fills most of the icon while respecting padding.
    font_size = int(size * 0.82)
    probe = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(probe)
    font = load_font(font_size)
    bbox = draw.textbbox((0, 0), "W", font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    if text_w == 0 or text_h == 0:
        return font
    scale = min((target_ratio * size) / text_w, (target_ratio * size) / text_h)
    font_size = max(1, int(font_size * scale))
    return load_font(font_size)


def draw_w(img: Image.Image) -> Image.Image:
    size = img.size[0]
    font = get_icon_font(size)
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    text = "W"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (size - text_w) / 2 - bbox[0]
    y = (size - text_h) / 2 - bbox[1] - size * 0.005

    shadow_color = (5, 44, 116, 90)
    draw.text((x, y + size * 0.012), text, font=font, fill=shadow_color)
    draw.text((x, y), text, font=font, fill=(255, 255, 255, 255))
    return Image.alpha_composite(img, overlay)


def build_icon(size: int) -> Image.Image:
    base = build_split_tone(size)
    rounded = apply_round_mask(base, radius=int(size * 0.22))
    return draw_w(rounded)


def ensure_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def write_svg(path: Path, size: int = 1080) -> None:
    svg = f"""<svg width="{size}" height="{size}" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#0B2D6B" flood-opacity="0.25" />
    </filter>
  </defs>
  <rect width="1080" height="1080" rx="220" fill="#135DD6" />
  <polygon points="486,0 1080,0 1080,594" fill="#5AB0FF" />
  <polygon points="0,594 594,1080 0,1080" fill="#0C42AF" />
  <rect x="86" y="86" width="908" height="908" rx="194" fill="none" stroke="#FFFFFF" stroke-opacity="0.14" stroke-width="22" />
  <text x="540" y="540" text-anchor="middle" dominant-baseline="central"
        font-family="Sora, Segoe UI, Arial, sans-serif" font-size="780" font-weight="700"
        fill="#FFFFFF" filter="url(#shadow)">W</text>
</svg>
"""
    ensure_dir(path)
    path.write_text(svg)


def main() -> None:
    outputs = [
        (BASE_DIR / "assets" / "app-icon-1080.png", 1080),
        (BASE_DIR / "electron" / "assets" / "app-icon.png", 512),
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
    electron_ico = BASE_DIR / "electron" / "assets" / "app-icon.ico"
    ensure_dir(electron_ico)
    ico_base.save(electron_ico, sizes=ico_sizes)
    print(f"Created {electron_ico}")

    web_ico = BASE_DIR / "web" / "favicon.ico"
    ensure_dir(web_ico)
    ico_base.save(web_ico, sizes=ico_sizes)
    print(f"Created {web_ico}")

    svg_targets = [
        BASE_DIR / "assets" / "app-icon.svg",
        BASE_DIR / "electron" / "assets" / "app-icon.svg",
        BASE_DIR / "web" / "assets" / "app-icon.svg",
    ]
    for target in svg_targets:
        write_svg(target)
        print(f"Created {target}")


if __name__ == "__main__":
    main()
