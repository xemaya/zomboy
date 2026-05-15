"""Generate ZOM-BOY+ sprite assets via DeerAPI gpt-image-2.

Style: chunky pixel art reminiscent of the reference board game illustration —
top-down tiles + bust-ish character pieces, GB-ish but full color (not pure 4-shade green).

Usage:
    python gen_sprites.py                 # generate all missing
    python gen_sprites.py --force ...     # overwrite existing
    python gen_sprites.py grass stone     # subset by stem name
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

API_KEY = os.environ["DEERAPI_KEY"]
API_URL = "https://api.deerapi.com/v1/images/generations"
MODEL = "gpt-image-2"

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "sprites"


STYLE = (
    "Chunky 16-bit pixel art, top-down view, sharp pixel edges, "
    "no anti-aliasing, no smooth gradients, no realism. "
    "Limited color palette per sprite (4-6 colors), bold dark outline. "
    "Saturated GameBoy-ish but full-color (not monochrome green). "
    "Centered subject, single sprite per image, no UI, no text, no shadow halo, "
    "no characters except what is specified. "
    "Camera looks straight down at the tile (no perspective)."
)


# (stem, size, transparent_bg, body)
PROMPTS = [
    (
        "grass_tile", "1024x1024", False,
        "A single seamless square pixel-art grass tile, viewed straight from above. "
        "Bright light-green base (#9bbc0f-ish), a few darker green tufts of grass "
        "(2-3 small tufts), no flowers, no rocks. Square aspect, fills the whole image."
    ),
    (
        "stone_tile", "1024x1024", False,
        "A single square pixel-art tile of a cluster of grey boulders sitting on grass, "
        "viewed straight from above. The grass underneath matches a bright light-green grass tile. "
        "The stone cluster occupies the middle ~70% of the tile, with clear pixelated highlights and "
        "darker shadow side; rough irregular boulder shapes, not perfectly round. "
        "Strong dark outline around the stone cluster."
    ),
    (
        "house_tile", "1024x1024", False,
        "A single square pixel-art tile showing a tiny cottage on a bright light-green grass background, "
        "viewed slightly from above and front (3/4 view but mostly top). "
        "Brown sloped triangular roof with dark outline, wooden plank walls (light brown / tan), "
        "one small dark door in the middle, a glowing warm yellow window on each side of the door. "
        "Cozy fairy-tale tiny house. The house occupies about 70% of the tile."
    ),
    (
        "house_empty", "1024x1024", False,
        "A single square pixel-art tile showing the SAME tiny cottage as the active house but it is "
        "abandoned and empty now: the roof is darker / muted, the walls are greyed out, "
        "the windows are dark (no warm glow), the door is closed. "
        "Still on a bright light-green grass background, same composition. "
        "Slightly desaturated palette."
    ),
    (
        "start_tile", "1024x1024", False,
        "A single square pixel-art grass tile (same bright light-green base as the grass tile), "
        "with a single bold uppercase letter 'S' centered in golden yellow pixel font, "
        "with a dark outline. The grass tile occupies the full square, the S occupies about 35% "
        "of the tile width."
    ),
    (
        "survivor", "1024x1024", True,
        "A single pixel-art character sprite of a brave human survivor standing centered, "
        "facing the viewer. Wears a deep BLUE baseball cap and BLUE shirt, light skin tone face with "
        "simple pixel eyes and a small mouth, dark blue trousers, small brown boots. "
        "Bold dark outline around the entire figure. Standing pose, arms slightly out. "
        "Place the character on a SOLID PURE MAGENTA (#FF00FF) background — no other elements, "
        "no grass, no ground, no shadow, no scenery. The magenta MUST be a perfectly flat, fully "
        "saturated #FF00FF color filling every non-character pixel. "
        "Character occupies center ~60% of the image."
    ),
    (
        "zombie", "1024x1024", True,
        "A single pixel-art character sprite of a cartoon ZOMBIE standing centered, "
        "facing the viewer. Sickly pale GREEN skin, slightly slouched posture, "
        "torn dark green ragged shirt, dark green trousers, one eye larger than the other, "
        "small open mouth showing one fang, arms hanging down. "
        "Bold dark outline around the entire figure. "
        "Place the character on a SOLID PURE MAGENTA (#FF00FF) background — no other elements, "
        "no grass, no ground, no shadow, no scenery. The magenta MUST be a perfectly flat, fully "
        "saturated #FF00FF color filling every non-character pixel. "
        "Character occupies center ~60% of the image."
    ),
]


def build_prompt(body: str, transparent: bool) -> str:
    extra = (
        ""
        if transparent
        else " The whole tile fills the image; no transparent areas; no border."
    )
    return f"{STYLE}\n\n{body}{extra}"


def generate_one(stem: str, size: str, transparent: bool, body: str) -> bool:
    # gpt-image-2 does not accept the `background` field; rely on prompt
    # instructions for transparency.
    payload = {
        "model": MODEL,
        "prompt": build_prompt(body, transparent),
        "n": 1,
        "size": size,
        "output_format": "png",
    }
    data_bytes = json.dumps(payload).encode("utf-8")

    last_err = None
    for attempt in range(1, 4):
        req = urllib.request.Request(
            API_URL,
            data=data_bytes,
            headers={
                "Authorization": f"Bearer {API_KEY}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=360) as resp:
                result = json.loads(resp.read())
            break
        except urllib.error.HTTPError as e:
            body_text = e.read().decode("utf-8", errors="replace")
            print(f"  [{stem}] attempt {attempt}: HTTP {e.code}: {body_text[:300]}")
            last_err = f"HTTP {e.code}"
            if e.code in (400, 401, 403):
                return False
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            print(f"  [{stem}] attempt {attempt}: {type(e).__name__}: {e}")
            last_err = f"{type(e).__name__}: {e}"
        time.sleep(3 * attempt)
    else:
        print(f"  [{stem}] failed: {last_err}")
        return False

    data = result.get("data") or []
    if not data:
        print(f"  [{stem}] unexpected response: {json.dumps(result)[:500]}")
        return False

    item = data[0]
    out = OUT_DIR / f"{stem}.png"
    out.parent.mkdir(parents=True, exist_ok=True)

    if item.get("b64_json"):
        out.write_bytes(base64.b64decode(item["b64_json"]))
    elif item.get("url"):
        with urllib.request.urlopen(item["url"], timeout=120) as img_resp:
            out.write_bytes(img_resp.read())
    else:
        print(f"  [{stem}] no image data: {json.dumps(item)[:500]}")
        return False

    print(f"  [{stem}] OK -> {out.name} ({out.stat().st_size // 1024} KB)")
    return True


def main():
    args = sys.argv[1:]
    force = "--force" in args
    args = [a for a in args if not a.startswith("--")]
    name_filter = set(args)
    if name_filter:
        force = True

    jobs = []
    for stem, size, transparent, body in PROMPTS:
        if name_filter and stem not in name_filter:
            continue
        target = OUT_DIR / f"{stem}.png"
        if target.exists() and not force:
            print(f"SKIP {stem} (exists)")
            continue
        jobs.append((stem, size, transparent, body))

    print(f"Generating {len(jobs)} sprites in parallel...")
    ok = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        futs = [pool.submit(generate_one, *j) for j in jobs]
        for f in as_completed(futs):
            if f.result():
                ok += 1

    print(f"\nDone: {ok}/{len(jobs)} succeeded")


if __name__ == "__main__":
    main()
