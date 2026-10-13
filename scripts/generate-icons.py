"""Renders the extension icon ("</>" on a journal-green tile) into public/icons/.

Run with: python3 scripts/generate-icons.py   (requires Pillow)
Drawn at 1024 px and downscaled for crisp small sizes.
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
SIZES = [16, 32, 48, 96, 128]
S = 1024
BACKGROUND = (15, 118, 110, 255)  # teal-700
FOREGROUND = (255, 255, 255, 255)
ACCENT = (153, 246, 228, 255)  # teal-200


def render() -> Image.Image:
    image = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((32, 32, S - 32, S - 32), radius=200, fill=BACKGROUND)
    width = 96
    # "<"
    draw.line([(390, 330), (230, 512), (390, 694)], fill=FOREGROUND, width=width, joint="curve")
    # ">"
    draw.line([(634, 330), (794, 512), (634, 694)], fill=FOREGROUND, width=width, joint="curve")
    # "/"
    draw.line([(565, 290), (459, 734)], fill=ACCENT, width=width)
    for x, y in [(390, 330), (230, 512), (390, 694), (634, 330), (794, 512), (634, 694), (565, 290), (459, 734)]:
        r = width // 2
        colour = ACCENT if (x, y) in [(565, 290), (459, 734)] else FOREGROUND
        draw.ellipse((x - r, y - r, x + r, y + r), fill=colour)
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    master = render()
    for size in SIZES:
        master.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png", optimize=True)
    print(f"Wrote {len(SIZES)} icons to {OUT}")


if __name__ == "__main__":
    main()
