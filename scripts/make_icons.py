# Builds every logo/icon asset from the two source logos.
# usage: python3 scripts/make_icons.py <mark-image> <wordmark-image>
import sys
from PIL import Image
import numpy as np

MARK_SRC, WORD_SRC = sys.argv[1], sys.argv[2]
NAVY = (8, 30, 70)


def to_rgba(path):
    """Return a tightly-cropped RGBA image. Keeps real transparency when the
    source has it; otherwise derives alpha from distance to a white background."""
    im = Image.open(path)
    if im.mode in ('RGBA', 'LA') or 'transparency' in im.info:
        img = im.convert('RGBA')
        a = np.asarray(img).astype(np.float32)
        # drop faint halo pixels left by the source's antialiasing
        a[..., 3] = np.where(a[..., 3] < 12, 0, a[..., 3])
        img = Image.fromarray(a.astype(np.uint8), 'RGBA')
    else:
        a = np.asarray(im.convert('RGB')).astype(np.float32)
        d = 255 - a.min(axis=2)
        alpha = np.clip((d - 8) * 1.5, 0, 255)
        al = np.maximum(alpha / 255.0, 1e-3)[..., None]
        rgb = np.clip((a - 255 * (1 - al)) / al, 0, 255)
        img = Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), 'RGBA')
    bbox = img.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    return img.crop(bbox)


def fit_h(img, h):
    return img.resize((round(img.width * h / img.height), h), Image.LANCZOS)


def save_png(img, path, colors=None):
    if colors:  # palette PNG with alpha: much smaller, visually identical for flat logos
        img = img.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    img.save(path, optimize=True)


def light_version(img):
    """Navy -> white, teal kept: for dark backgrounds."""
    a = np.asarray(img).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    teal = (g > 110) & (b > 110) & (g - r > 40)
    out = a.copy()
    out[~teal, 0:3] = 255
    return Image.fromarray(out.astype(np.uint8), 'RGBA')


mark = to_rgba(MARK_SRC)
word = to_rgba(WORD_SRC)

# Wordmark: shown at ~40-46px CSS height -> render at 3x for sharp retina display.
w = fit_h(word, 144)
save_png(w, 'public/img/wordmark.png', colors=64)
save_png(light_version(w), 'public/img/wordmark-light.png', colors=64)

# Mark: shown at <=96px CSS -> 288px is enough for 3x.
m = mark.copy(); m.thumbnail((288, 288), Image.LANCZOS)
save_png(m, 'public/img/mark.png', colors=128)


def icon(size, pad, bg=(255, 255, 255, 255)):
    c = Image.new('RGBA', (size, size), bg)
    inner = int(size * (1 - 2 * pad))
    mm = mark.copy(); mm.thumbnail((inner, inner), Image.LANCZOS)
    c.alpha_composite(mm, ((size - mm.width) // 2, (size - mm.height) // 2))
    return c


save_png(icon(192, 0.10), 'public/icons/icon-192.png', colors=128)
save_png(icon(512, 0.10), 'public/icons/icon-512.png', colors=128)
save_png(icon(512, 0.20), 'public/icons/maskable-512.png', colors=128)
icon(180, 0.12).convert('RGB').save('public/icons/apple-touch-icon.png', optimize=True)
save_png(icon(64, 0.04), 'public/icons/favicon-64.png', colors=64)
print('mark', mark.size, '-> ', m.size, '| word', word.size, '->', w.size)
