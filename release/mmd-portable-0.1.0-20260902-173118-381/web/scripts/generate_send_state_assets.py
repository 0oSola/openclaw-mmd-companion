from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SEND_DIR = ROOT / "images" / "send"
SCALES = (1, 2, 3, 4)


def clamp_channel(value: float) -> int:
    return max(0, min(255, int(round(value))))


def tint_non_transparent(img: Image.Image, rgb: tuple[int, int, int], amount: float) -> Image.Image:
    if amount <= 0:
        return img
    base = img.convert("RGBA")
    overlay = Image.new("RGBA", base.size, (*rgb, 0))
    alpha = base.getchannel("A").point(lambda v: clamp_channel(v * amount))
    overlay.putalpha(alpha)
    return Image.alpha_composite(base, overlay)


def add_glow(img: Image.Image, rgb: tuple[int, int, int], blur_radius: float, opacity: float) -> Image.Image:
    base = img.convert("RGBA")
    alpha = base.getchannel("A")
    glow_alpha = alpha.filter(ImageFilter.GaussianBlur(radius=blur_radius)).point(
        lambda v: clamp_channel(v * opacity)
    )
    glow = Image.new("RGBA", base.size, (*rgb, 0))
    glow.putalpha(glow_alpha)
    return Image.alpha_composite(glow, base)


def add_top_sheen(img: Image.Image, opacity: float) -> Image.Image:
    base = img.convert("RGBA")
    sheen = Image.new("RGBA", base.size, (255, 255, 255, 0))
    width, height = base.size
    for y in range(height):
        # Stronger on upper third, quickly fading out.
        progress = y / max(1, height - 1)
        if progress > 0.52:
            alpha = 0
        else:
            alpha = clamp_channel((1.0 - (progress / 0.52)) ** 1.8 * 255 * opacity)
        for x in range(width):
            sheen.putpixel((x, y), (255, 255, 255, alpha))
    sheen.putalpha(ImageChops.multiply(sheen.getchannel("A"), base.getchannel("A")))
    return Image.alpha_composite(base, sheen)


def make_hover(img: Image.Image, scale: int) -> Image.Image:
    result = img.convert("RGBA")
    result = ImageEnhance.Color(result).enhance(1.14)
    result = ImageEnhance.Brightness(result).enhance(1.09)
    result = tint_non_transparent(result, (116, 224, 255), 0.12)
    result = add_glow(result, (95, 224, 255), blur_radius=2.0 * scale, opacity=0.28)
    result = add_top_sheen(result, 0.14)
    return result


def make_disabled(img: Image.Image, scale: int) -> Image.Image:
    base = img.convert("RGBA")
    alpha = base.getchannel("A")
    rgb = base.convert("RGB")
    rgb = ImageEnhance.Color(rgb).enhance(0.18)
    rgb = ImageEnhance.Brightness(rgb).enhance(0.86)
    rgb = ImageEnhance.Contrast(rgb).enhance(0.92)
    tinted = Image.new("RGBA", base.size)
    tinted.paste(rgb, (0, 0))
    tinted.putalpha(alpha.point(lambda v: clamp_channel(v * 0.72)))
    tinted = tint_non_transparent(tinted, (168, 196, 228), 0.16)
    tinted = add_glow(tinted, (160, 194, 236), blur_radius=1.2 * scale, opacity=0.08)
    return tinted


def make_loading(img: Image.Image, scale: int) -> Image.Image:
    result = img.convert("RGBA")
    result = ImageEnhance.Color(result).enhance(1.1)
    result = ImageEnhance.Brightness(result).enhance(1.07)
    result = tint_non_transparent(result, (100, 232, 255), 0.1)
    result = add_glow(result, (91, 213, 255), blur_radius=2.3 * scale, opacity=0.3)
    result = add_top_sheen(result, 0.18)
    return result


STATE_BUILDERS = {
    "hover": make_hover,
    "disabled": make_disabled,
    "loading": make_loading,
}


def main() -> None:
    for scale in SCALES:
        source = SEND_DIR / f"send_icon_fixed_{scale}x.png"
        original = Image.open(source).convert("RGBA")
        for state, builder in STATE_BUILDERS.items():
            output = SEND_DIR / f"send_icon_{state}_{scale}x.png"
            builder(original, scale).save(output)
            print(f"wrote {output}")


if __name__ == "__main__":
    main()
