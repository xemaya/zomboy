"""Remove a magenta (#FF00FF) background from PNG sprites — turn it transparent.

Usage:
    python chromakey.py survivor zombie         # process specific files
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SPRITES = ROOT / "public" / "sprites"


def chroma_key(path: Path, threshold: int = 70) -> None:
    img = Image.open(path).convert("RGBA")
    pixels = img.load()
    assert pixels is not None
    w, h = img.size
    removed = 0
    for y in range(h):
        for x in range(w):
            r, g, b, _a = pixels[x, y]
            # Magenta-ish: high R, low G, high B
            if r > 200 and g < threshold and b > 200:
                pixels[x, y] = (0, 0, 0, 0)
                removed += 1
    img.save(path)
    print(f"  {path.name}: cleared {removed} / {w*h} pixels ({removed*100//(w*h)}%)")


def main():
    names = sys.argv[1:] or ["survivor", "zombie"]
    for n in names:
        p = SPRITES / f"{n}.png"
        if not p.exists():
            print(f"  skip {n}: missing")
            continue
        chroma_key(p)


if __name__ == "__main__":
    main()
