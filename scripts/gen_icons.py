#!/usr/bin/env python3
"""生成 Lucky Bump v3 视觉资产（「幸运小山丘」品牌标）。
- static/icon.png   应用图标 192（App 打包 / PWA）
- static/mark.png   品牌标 512（引导页 / 关于页引用）
- static/tab/*.png  tabBar 81×81 ×2 态
零第三方依赖；4× 超采样抗锯齿。"""
import zlib, struct, math, os

def _chunk(tag, data):
    c = tag + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

def write_png(path, w, h, pix):
    raw = b"".join(b"\x00" + bytes(pix[y * w * 4:(y + 1) * w * 4]) for y in range(h))
    data = (b"\x89PNG\r\n\x1a\n"
            + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + _chunk(b"IDAT", zlib.compress(raw, 9))
            + b"" + _chunk(b"IEND", b""))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)

def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)

class Canvas:
    """RGBA 画布：alpha 混合图元（超采样由调用方决定倍率）。"""
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.pix = bytearray(w * h * 4)

    def blend(self, x, y, rgba, alpha):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 4
            r, g, b, a = rgba
            pa = self.pix[i + 3] / 255
            na = alpha + pa * (1 - alpha)
            if na > 0:
                for c in range(3):
                    self.pix[i + c] = int((rgba[c] * alpha + self.pix[i + c] * pa * (1 - alpha)) / na)
                self.pix[i + 3] = int(na * 255)

    def circle(self, cx, cy, r, rgba, alpha=1.0):
        for y in range(int(cy - r) - 2, int(cy + r) + 3):
            for x in range(int(cx - r) - 2, int(cx + r) + 3):
                d = math.hypot(x - cx, y - cy)
                a = max(0.0, min(1.0, r - d + 0.5))
                if a > 0:
                    self.blend(x, y, rgba, a * alpha)

    def round_rect(self, x0, y0, x1, y1, r, rgba, alpha=1.0):
        for y in range(int(y0), int(y1)):
            for x in range(int(x0), int(x1)):
                dx = max(x0 + r - x, x - (x1 - r - 1), 0)
                dy = max(y0 + r - y, y - (y1 - r - 1), 0)
                d = math.hypot(dx, dy)
                a = max(0.0, min(1.0, r - d + 0.5))
                if a > 0:
                    self.blend(x, y, rgba, a * alpha)

    def line(self, x0, y0, x1, y1, t, rgba, alpha=1.0):
        steps = int(max(abs(x1 - x0), abs(y1 - y0))) * 2 + 1
        for i in range(steps + 1):
            x = x0 + (x1 - x0) * i / steps
            y = y0 + (y1 - y0) * i / steps
            self.circle(x, y, t / 2, rgba, alpha)

    def quad(self, p0, p1, p2, t, rgba, alpha=1.0):
        """二次贝塞尔圆头粗笔画。"""
        steps = int(max(abs(p2[0] - p0[0]), abs(p2[1] - p0[1]))) * 2 + 1
        for i in range(steps + 1):
            u = i / steps
            x = (1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * p1[0] + u ** 2 * p2[0]
            y = (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * p1[1] + u ** 2 * p2[1]
            self.circle(x, y, t / 2, rgba, alpha)

    def star4(self, cx, cy, r, rgba, alpha=1.0):
        """四角幸运星（纤长 sparkle）：r(θ) = r·(0.12 + 0.88·|cos 2θ|^3)。"""
        for y in range(int(cy - r) - 2, int(cy + r) + 3):
            for x in range(int(cx - r) - 2, int(cx + r) + 3):
                dx, dy = x - cx, -(y - cy)
                d = math.hypot(dx, dy)
                if d > r:
                    continue
                ang = math.atan2(dy, dx) if (dx or dy) else 0
                rr = r * (0.12 + 0.88 * abs(math.cos(2 * ang)) ** 3)
                if d <= rr:
                    self.blend(x, y, rgba, alpha)

    def glow(self, cx, cy, r, rgba, peak=0.35):
        for y in range(int(cy - r) - 2, int(cy + r) + 3):
            for x in range(int(cx - r) - 2, int(cx + r) + 3):
                d = math.hypot(x - cx, y - cy)
                if d >= r:
                    continue
                a = peak * (1 - d / r) ** 2
                if a > 0:
                    self.blend(x, y, rgba, a)

def downsample(big: Canvas, factor: int) -> Canvas:
    """盒式下采样：超采样 → 抗锯齿。"""
    w, h = big.w // factor, big.h // factor
    out = Canvas(w, h)
    for y in range(h):
        for x in range(w):
            r = g = b = a = 0
            for dy in range(factor):
                for dx in range(factor):
                    i = ((y * factor + dy) * big.w + (x * factor + dx)) * 4
                    r += big.pix[i]; g += big.pix[i + 1]; b += big.pix[i + 2]; a += big.pix[i + 3]
            n = factor * factor
            j = (y * w + x) * 4
            out.pix[j] = r // n; out.pix[j + 1] = g // n; out.pix[j + 2] = b // n; out.pix[j + 3] = a // n
    return out

# —— 品牌色 ——
GRAD_A = (243, 118, 160, 255)   # 日出桃（顶）
GRAD_B = (212, 55, 112, 255)    # 绛玫瑰（底）
GOLD = (255, 196, 87, 255)      # 幸运金
WHITE = (255, 255, 255, 255)
GRAY = (164, 148, 160, 255)     # tab 未选中：藕灰
ROSE = (228, 83, 127, 255)      # tab 选中：蔷薇玫瑰

def brand_mark(px: int):
    """「幸运小山丘」：日出渐变圆角方 + 从左缘升起的 bump 山丘 + 右上幸运星。"""
    SS = 4
    S = px * SS
    c = Canvas(S, S)
    m = S * 0.04
    half = S / 2 - m
    radius = half * 0.46          # iOS 式连续圆角观感

    def badge_alpha(x, y):
        dx = max(m + half - x, x - (S - m - half - 1), 0)
        dy = max(m + half - y, y - (S - m - half - 1), 0)
        dx = max(dx - (half - radius), 0)
        dy = max(dy - (half - radius), 0)
        d = math.hypot(dx, dy)
        return max(0.0, min(1.0, radius - d + 0.5))

    for y in range(S):
        for x in range(S):
            a = badge_alpha(x, y)
            if a > 0:
                c.blend(x, y, mix(GRAD_A, GRAD_B, y / S), a)
    c.glow(S * 0.26, S * 0.16, S * 0.45, WHITE, peak=0.15)
    # bump 山丘：两端融入徽章边缘（地形感，不是嘴巴），峰在左三分之一
    stroke = S * 0.082
    c.quad((S * 0.02, S * 0.56), (S * 0.34, S * 0.24), (S * 0.98, S * 0.68), stroke, WHITE)
    # 右上天空：幸运星（金 sparkle + 微光晕），与山丘错位构图
    c.glow(S * 0.74, S * 0.25, S * 0.10, GOLD, peak=0.28)
    c.star4(S * 0.74, S * 0.25, S * 0.072, GOLD)
    # 裁剪：徽章外的辉光/笔画一律清除
    for y in range(S):
        for x in range(S):
            if badge_alpha(x, y) <= 0:
                i = (y * S + x) * 4
                c.pix[i + 3] = 0
    return downsample(c, SS)

def tab_icon(name, color, out):
    """tabBar 81×81：统一圆头笔触；未选中=藕灰、选中=玫瑰。"""
    SS = 4
    S = 81 * SS
    c = Canvas(S, S)
    lw = 5.8 * SS
    cx = S / 2
    if name == "today":       # 品牌微缩：山丘弧线 + 星
        c.quad((S * 0.12, S * 0.62), (S * 0.38, S * 0.28), (S * 0.88, S * 0.66), lw, color)
        c.star4(S * 0.72, S * 0.24, 8.5 * SS, color)
    elif name == "record":    # 加号
        c.line(cx, S * 0.20, cx, S * 0.80, lw, color)
        c.line(S * 0.20, cx, S * 0.80, cx, lw, color)
    elif name == "data":      # 三柱 + 基线
        for i, hgt in enumerate([0.20, 0.34, 0.48]):
            x = S * (0.20 + i * 0.21)
            c.round_rect(x, S * (0.74 - hgt), x + S * 0.12, S * 0.74, 4 * SS, color)
        c.line(S * 0.15, S * 0.74, S * 0.85, S * 0.74, 3.4 * SS, color)
    elif name == "learn":     # 翻开的书
        c.quad((S * 0.50, S * 0.32), (S * 0.30, S * 0.20), (S * 0.16, S * 0.28), lw, color)
        c.line(S * 0.16, S * 0.28, S * 0.16, S * 0.68, lw, color)
        c.line(S * 0.16, S * 0.68, S * 0.50, S * 0.76, lw, color)
        c.line(S * 0.50, S * 0.76, S * 0.50, S * 0.36, lw, color)
        c.quad((S * 0.50, S * 0.32), (S * 0.70, S * 0.20), (S * 0.84, S * 0.28), lw, color)
        c.line(S * 0.84, S * 0.28, S * 0.84, S * 0.68, lw, color)
        c.line(S * 0.84, S * 0.68, S * 0.50, S * 0.76, lw, color)
    elif name == "me":        # 头 + 肩
        c.circle(cx, S * 0.28, S * 0.13, color)
        c.quad((S * 0.18, S * 0.78), (S * 0.26, S * 0.52), (S * 0.50, S * 0.50), lw, color)
        c.quad((S * 0.50, S * 0.50), (S * 0.74, S * 0.52), (S * 0.82, S * 0.78), lw, color)
    write_png(out, 81, 81, downsample(c, SS).pix)

def main():
    root = os.path.join(os.path.dirname(__file__), "..", "static")
    for name in ["today", "record", "data", "learn", "me"]:
        tab_icon(name, GRAY, os.path.join(root, "tab", f"{name}.png"))
        tab_icon(name, ROSE, os.path.join(root, "tab", f"{name}-active.png"))
    write_png(os.path.join(root, "icon.png"), 192, 192, brand_mark(192).pix)
    write_png(os.path.join(root, "mark.png"), 512, 512, brand_mark(512).pix)
    print("v3 assets generated")

if __name__ == "__main__":
    main()
