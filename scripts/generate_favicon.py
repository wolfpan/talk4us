#!/usr/bin/env python3
"""生成 Talk4us favicon 全套位图（与 public/favicon.svg 同一设计）。

设计：渐变圆角方块（青→天蓝→靛蓝）+ 白色对话气泡 + AI 四角火花。
用法：python scripts/generate_favicon.py
输出：public/favicon.ico、apple-touch-icon.png、icon-192.png、icon-512.png
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"

# 64 单位 viewBox，超采样 16 倍
UNIT = 64
SS = 16
SIZE = UNIT * SS  # 1024


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def diagonal_gradient(stops, w, h):
    """按 (x+y) 对角线插值的多段渐变。stops: [(t, (r,g,b)), ...]"""
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x + y) / (w + h - 2)
            for i in range(len(stops) - 1):
                t0, c0 = stops[i]
                t1, c1 = stops[i + 1]
                if t <= t1 or i == len(stops) - 2:
                    local = 0 if t1 == t0 else max(0.0, min(1.0, (t - t0) / (t1 - t0)))
                    px[x, y] = lerp(c0, c1, local)
                    break
    return img


def quad_points(p0, p1, p2, n=64):
    """二次贝塞尔展平为多边形顶点。"""
    return [
        (
            (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t**2 * p2[0],
            (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t**2 * p2[1],
        )
        for t in (i / n for i in range(n + 1))
    ]


def s(v):
    """viewBox 单位 → 超采样像素。"""
    return v * SS


def build_master():
    # 背景渐变（先小图逐像素、再放大，兼顾精确与速度）
    bg_stops = [
        (0.0, (0x22, 0xD3, 0xEE)),
        (0.5, (0x38, 0xBD, 0xF8)),
        (1.0, (0x81, 0x8C, 0xF8)),
    ]
    bg = diagonal_gradient(bg_stops, 256, 256).resize((SIZE, SIZE), Image.BILINEAR)

    spark_stops = [
        (0.0, (0x0E, 0xA5, 0xE9)),
        (1.0, (0x63, 0x66, 0xF1)),
    ]
    spark = diagonal_gradient(spark_stops, 256, 256).resize((SIZE, SIZE), Image.BILINEAR)

    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    # 1) 圆角方块底
    mask_bg = Image.new("L", (SIZE, SIZE), 0)
    d = ImageDraw.Draw(mask_bg)
    d.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=s(14), fill=255)
    icon.paste(bg, (0, 0), mask_bg)

    # 2) 白色对话气泡（圆角矩形 + 左下尾巴）
    mask_bubble = Image.new("L", (SIZE, SIZE), 0)
    d = ImageDraw.Draw(mask_bubble)
    d.rounded_rectangle([s(14), s(13), s(50), s(42)], radius=s(9), fill=255)
    d.polygon([(s(31), s(42)), (s(20), s(51)), (s(24), s(42))], fill=255)
    icon.paste(Image.new("RGB", (SIZE, SIZE), (255, 255, 255)), (0, 0), mask_bubble)

    # 3) AI 四角火花（四段二次贝塞尔）
    tips = [(32, 16), (42, 26), (32, 36), (22, 26)]
    ctrls = [(34.2, 23.8), (34.2, 28.2), (29.8, 28.2), (29.8, 23.8)]
    poly = []
    for i in range(4):
        poly += quad_points(tips[i], ctrls[i], tips[(i + 1) % 4])
    poly = [(s(x), s(y)) for x, y in poly]
    mask_spark = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask_spark).polygon(poly, fill=255)
    icon.paste(spark, (0, 0), mask_spark)

    return icon


def main():
    PUBLIC.mkdir(exist_ok=True)
    master = build_master()

    def save(size, name):
        master.resize((size, size), Image.LANCZOS).save(PUBLIC / name)

    save(512, "icon-512.png")
    save(192, "icon-192.png")
    save(180, "apple-touch-icon.png")

    # ICO：单文件内嵌 16/32/48
    master.resize((256, 256), Image.LANCZOS).save(
        PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]
    )
    print("done:", *(p.name for p in sorted(PUBLIC.glob("*")) if "icon" in p.name or "favicon" in p.name))


if __name__ == "__main__":
    main()
