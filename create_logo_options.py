#!/usr/bin/env python3
"""
Generate multiple Workflow logo options for review.

Outputs are written to:
  assets/logo-options/
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

BASE_DIR = Path(__file__).resolve().parent
OUT_DIR = BASE_DIR / "assets" / "logo-options"


def blend(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
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


def best_w_font(size: int, ratio: float = 0.78) -> ImageFont.FreeTypeFont:
    probe = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(probe)
    font_size = int(size * 0.86)
    font = load_font(font_size)
    bbox = draw.textbbox((0, 0), "W", font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    if text_w and text_h:
        scale = min((size * ratio) / text_w, (size * ratio) / text_h)
        font = load_font(max(1, int(font_size * scale)))
    return font


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def circle_mask(size: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse([0, 0, size - 1, size - 1], fill=255)
    return mask


def gradient_bg(size: int, start: tuple[int, int, int], end: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (size, size))
    px = img.load()
    denom = max(1, size - 1)
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * denom)
            px[x, y] = (*blend(start, end, t), 255)
    return img


def place_w(base: Image.Image, shadow: tuple[int, int, int, int]) -> Image.Image:
    size = base.size[0]
    overlay = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = best_w_font(size)
    bbox = draw.textbbox((0, 0), "W", font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (size - text_w) / 2 - bbox[0]
    y = (size - text_h) / 2 - bbox[1] - size * 0.006
    draw.text((x, y + size * 0.012), "W", font=font, fill=shadow)
    draw.text((x, y), "W", font=font, fill=(255, 255, 255, 255))
    return Image.alpha_composite(base, overlay)


def option_a(size: int) -> Image.Image:
    # Classic diagonal gradient.
    bg = gradient_bg(size, (18, 86, 207), (84, 174, 255))
    gloss = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(gloss)
    draw.ellipse(
        [-size * 0.25, -size * 0.25, size * 0.9, size * 0.9],
        fill=(255, 255, 255, 52),
    )
    bg = Image.alpha_composite(bg, gloss)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(bg, (0, 0), rounded_mask(size, int(size * 0.22)))
    return place_w(out, shadow=(8, 40, 102, 92))


def option_b(size: int) -> Image.Image:
    # Flat cobalt with subtle inner stroke.
    bg = Image.new("RGBA", (size, size), (22, 104, 233, 255))
    draw = ImageDraw.Draw(bg)
    pad = int(size * 0.06)
    draw.rounded_rectangle(
        [pad, pad, size - 1 - pad, size - 1 - pad],
        radius=int(size * 0.16),
        outline=(255, 255, 255, 52),
        width=max(2, int(size * 0.025)),
    )
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(bg, (0, 0), rounded_mask(size, int(size * 0.20)))
    return place_w(out, shadow=(11, 54, 130, 84))


def option_c(size: int) -> Image.Image:
    # Split-tone background for stronger contrast.
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(bg)
    draw.rectangle([0, 0, size, size], fill=(20, 93, 216, 255))
    draw.polygon([(size * 0.45, 0), (size, 0), (size, size * 0.55)], fill=(95, 184, 255, 255))
    draw.polygon([(0, size * 0.55), (size * 0.55, size), (0, size)], fill=(12, 66, 175, 255))
    ring_pad = int(size * 0.08)
    draw.rounded_rectangle(
        [ring_pad, ring_pad, size - 1 - ring_pad, size - 1 - ring_pad],
        radius=int(size * 0.18),
        outline=(255, 255, 255, 36),
        width=max(2, int(size * 0.02)),
    )
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(bg, (0, 0), rounded_mask(size, int(size * 0.22)))
    return place_w(out, shadow=(5, 44, 116, 90))


def option_d(size: int) -> Image.Image:
    # Circular badge variant, useful for taskbars and docks.
    bg = gradient_bg(size, (16, 88, 217), (68, 161, 250))
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    draw.ellipse(
        [size * 0.1, size * 0.1, size * 0.9, size * 0.9],
        outline=(255, 255, 255, 85),
        width=max(2, int(size * 0.032)),
    )
    draw.ellipse(
        [-size * 0.15, -size * 0.20, size * 0.75, size * 0.70],
        fill=(255, 255, 255, 38),
    )
    bg = Image.alpha_composite(bg, glow).filter(ImageFilter.GaussianBlur(radius=size * 0.002))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(bg, (0, 0), circle_mask(size))
    return place_w(out, shadow=(8, 43, 110, 96))


def write_preview_grid(entries: list[tuple[str, Image.Image]], path: Path) -> None:
    card = 560
    gap = 56
    cols = 2
    rows = 2
    margin = 64
    width = margin * 2 + cols * card + (cols - 1) * gap
    height = margin * 2 + rows * (card + 66) + (rows - 1) * gap
    canvas = Image.new("RGB", (width, height), (242, 246, 255))
    draw = ImageDraw.Draw(canvas)
    label_font = load_font(42)

    for i, (label, img) in enumerate(entries):
        r, c = divmod(i, cols)
        x = margin + c * (card + gap)
        y = margin + r * (card + 66 + gap)

        card_bg = Image.new("RGBA", (card, card), (255, 255, 255, 255))
        rounded = rounded_mask(card, 42)
        canvas.paste(card_bg, (x, y), rounded)

        preview = img.resize((450, 450), Image.Resampling.LANCZOS)
        px = x + (card - preview.width) // 2
        py = y + (card - preview.height) // 2
        canvas.paste(preview, (px, py), preview)

        text = f"{label}"
        bbox = draw.textbbox((0, 0), text, font=label_font)
        tw = bbox[2] - bbox[0]
        draw.text((x + (card - tw) // 2, y + card + 12), text, font=label_font, fill=(24, 42, 74))

    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path, "PNG")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    variants = [
        ("Option A - Classic Gradient", option_a(1024)),
        ("Option B - Flat Cobalt", option_b(1024)),
        ("Option C - Split Tone", option_c(1024)),
        ("Option D - Circle Badge", option_d(1024)),
    ]

    for idx, (label, icon) in enumerate(variants, start=1):
        slug = f"option-{idx}"
        full = OUT_DIR / f"{slug}-1024.png"
        med = OUT_DIR / f"{slug}-512.png"
        icon.save(full, "PNG")
        icon.resize((512, 512), Image.Resampling.LANCZOS).save(med, "PNG")
        print(f"Wrote {full}")
        print(f"Wrote {med}")
        print(f"  {label}")

    write_preview_grid(variants, OUT_DIR / "workflow-logo-options-preview.png")
    print(f"Wrote {OUT_DIR / 'workflow-logo-options-preview.png'}")


if __name__ == "__main__":
    main()
