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

# —— v4 精装余项：自绘功能图标集（替代 emoji 字形）与空态插画 ——

SS4 = 4  # 全部图标统一 4× 超采样

def circle_outline(c: Canvas, cx: float, cy: float, r: float, lw: float, col, alpha: float = 1.0):
    steps = max(60, int(r * 6))
    for i in range(steps + 1):
        ang = -math.pi / 2 + i / steps * 2 * math.pi
        c.circle(cx + r * math.cos(ang), cy + r * math.sin(ang), lw / 2, col, alpha)

def round_rect_outline(c: Canvas, x0: float, y0: float, x1: float, y1: float, r: float, lw: float, col):
    c.line(x0 + r, y0, x1 - r, y0, lw, col)
    c.line(x0 + r, y1, x1 - r, y1, lw, col)
    c.line(x0, y0 + r, x0, y1 - r, lw, col)
    c.line(x1, y0 + r, x1, y1 - r, lw, col)
    for (cx, cy, a0, a1) in [(x0 + r, y0 + r, math.pi, 1.5 * math.pi),
                             (x1 - r, y0 + r, 1.5 * math.pi, 2 * math.pi),
                             (x1 - r, y1 - r, 0, 0.5 * math.pi),
                             (x0 + r, y1 - r, 0.5 * math.pi, math.pi)]:
        steps = max(24, int(r))
        for i in range(steps + 1):
            ang = a0 + (a1 - a0) * i / steps
            c.circle(cx + r * math.cos(ang), cy + r * math.sin(ang), lw / 2, col)

def droplet(c: Canvas, cx: float, top: float, bottom: float, half_w: float, lw: float, col):
    """水滴轮廓：上尖下圆。"""
    steps = 240
    for i in range(steps + 1):
        u = i / steps
        y = top + (bottom - top) * u
        w = half_w * math.sin(math.pi * min(1.0, u * 1.25)) ** 0.75
        c.circle(cx - w, y, lw / 2, col)
        c.circle(cx + w, y, lw / 2, col)

def face(c: Canvas, mouth_dy: float, mouth_depth: float, col):
    """心情脸：圆脸 + 双眼 + 弧线嘴（mouth_dy>0 嘴在下、负为嘴角向下）。"""
    lw = 8.0 * SS4
    circle_outline(c, 72 * SS4, 74 * SS4, 40 * SS4, lw, col)
    c.circle(58 * SS4, 62 * SS4, 4.5 * SS4, col)
    c.circle(86 * SS4, 62 * SS4, 4.5 * SS4, col)
    my = (74 + mouth_dy) * SS4
    c.quad((56 * SS4, my), (72 * SS4, my + mouth_depth * SS4), (88 * SS4, my), 5.5 * SS4, col)

def icon_cycle(c: Canvas, col):
    """经期：水滴 + 内波线。"""
    lw = 9.0 * SS4
    droplet(c, 72 * SS4, 22 * SS4, 122 * SS4, 33 * SS4, lw, col)
    c.quad((48 * SS4, 90 * SS4), (60 * SS4, 102 * SS4), (72 * SS4, 90 * SS4), 6.0 * SS4, col)
    c.quad((72 * SS4, 90 * SS4), (84 * SS4, 78 * SS4), (96 * SS4, 90 * SS4), 6.0 * SS4, col)

def icon_test(c: Canvas, col):
    """试纸：竖条 + 两道杠（一浅一深→一短一长）。"""
    lw = 9.0 * SS4
    round_rect_outline(c, 46 * SS4, 22 * SS4, 98 * SS4, 122 * SS4, 14 * SS4, lw, col)
    c.line(60 * SS4, 66 * SS4, 60 * SS4, 88 * SS4, 7 * SS4, col)
    c.line(84 * SS4, 50 * SS4, 84 * SS4, 88 * SS4, 7 * SS4, col)

def icon_thermo(c: Canvas, col):
    """体温：温度计。"""
    lw = 9.0 * SS4
    c.line(72 * SS4, 26 * SS4, 72 * SS4, 94 * SS4, lw, col)
    c.circle(72 * SS4, 106 * SS4, 17 * SS4, col)
    c.line(90 * SS4, 42 * SS4, 90 * SS4, 52 * SS4, 5.5 * SS4, col)
    c.line(90 * SS4, 64 * SS4, 90 * SS4, 74 * SS4, 5.5 * SS4, col)

def icon_preg(c: Canvas, col):
    """验孕：孕肚剪影。"""
    lw = 9.0 * SS4
    c.circle(72 * SS4, 30 * SS4, 13 * SS4, col)
    c.quad((48 * SS4, 122 * SS4), (44 * SS4, 64 * SS4), (72 * SS4, 58 * SS4), lw, col)
    c.quad((72 * SS4, 58 * SS4), (102 * SS4, 64 * SS4), (96 * SS4, 122 * SS4), lw, col)

def icon_feeding(c: Canvas, col):
    """喂养：奶瓶。"""
    lw = 9.0 * SS4
    c.round_rect(52 * SS4, 56 * SS4, 92 * SS4, 126 * SS4, 12 * SS4, col)
    c.line(60 * SS4, 42 * SS4, 60 * SS4, 56 * SS4, lw, col)
    c.line(84 * SS4, 42 * SS4, 84 * SS4, 56 * SS4, lw, col)
    c.line(60 * SS4, 42 * SS4, 84 * SS4, 42 * SS4, lw, col)
    c.line(64 * SS4, 42 * SS4, 64 * SS4, 28 * SS4, 6.5 * SS4, col)
    c.line(80 * SS4, 42 * SS4, 80 * SS4, 28 * SS4, 6.5 * SS4, col)
    c.line(64 * SS4, 28 * SS4, 80 * SS4, 28 * SS4, 6.5 * SS4, col)
    c.line(58 * SS4, 86 * SS4, 86 * SS4, 86 * SS4, 5.5 * SS4, col)

def icon_diaper(c: Canvas, col):
    """尿布：尿布形（上宽下尖）。"""
    lw = 9.0 * SS4
    c.line(26 * SS4, 36 * SS4, 118 * SS4, 36 * SS4, lw, col)
    steps = 160
    for sgn in (-1, 1):
        for i in range(steps + 1):
            u = i / steps
            x = 72 * SS4 + sgn * 46 * SS4 * (1 - u * u)
            y = 36 * SS4 + 82 * SS4 * u * u
            c.circle(x, y, lw / 2, col)
    c.line(56 * SS4, 70 * SS4, 88 * SS4, 70 * SS4, 5.5 * SS4, col)

def icon_moon(c: Canvas, col):
    """夜觉：月牙 + 星。"""
    lw = 9.0 * SS4
    steps = 220
    for i in range(steps + 1):
        u = i / steps
        ang = math.pi * (0.25 + u * 1.5)
        c.circle(66 * SS4 + 40 * SS4 * math.cos(ang), 76 * SS4 - 40 * SS4 * math.sin(ang), lw / 2, col)
    c.star4(98 * SS4, 40 * SS4, 10 * SS4, col)

def icon_sun(c: Canvas, col):
    """小睡：太阳。"""
    lw = 8.0 * SS4
    c.circle(72 * SS4, 76 * SS4, 24 * SS4, col)
    for k in range(8):
        ang = k * math.pi / 4
        c.line(72 * SS4 + 34 * SS4 * math.cos(ang), 76 * SS4 + 34 * SS4 * math.sin(ang),
               72 * SS4 + 48 * SS4 * math.cos(ang), 76 * SS4 + 48 * SS4 * math.sin(ang), 6.5 * SS4, col)

def icon_growth(c: Canvas, col):
    """成长：身高尺 + 上扬箭头。"""
    lw = 9.0 * SS4
    c.line(48 * SS4, 22 * SS4, 48 * SS4, 122 * SS4, lw, col)
    for y in (40, 64, 88, 110):
        c.line(48 * SS4, y * SS4, 62 * SS4, y * SS4, 6.0 * SS4, col)
    c.quad((84 * SS4, 104 * SS4), (94 * SS4, 62 * SS4), (104 * SS4, 52 * SS4), lw, col)
    c.line(104 * SS4, 52 * SS4, 116 * SS4, 58 * SS4, lw, col)
    c.line(104 * SS4, 52 * SS4, 108 * SS4, 38 * SS4, lw, col)

def icon_album(c: Canvas, col):
    """相册：照片框（山 + 日）。"""
    lw = 9.0 * SS4
    round_rect_outline(c, 26 * SS4, 32 * SS4, 118 * SS4, 112 * SS4, 14 * SS4, lw, col)
    c.circle(52 * SS4, 56 * SS4, 8 * SS4, col)
    c.quad((38 * SS4, 98 * SS4), (68 * SS4, 62 * SS4), (84 * SS4, 80 * SS4), 7.5 * SS4, col)
    c.quad((84 * SS4, 80 * SS4), (98 * SS4, 68 * SS4), (108 * SS4, 92 * SS4), 7.5 * SS4, col)

def icon_lochia(c: Canvas, col):
    """恶露：血滴。"""
    lw = 9.0 * SS4
    droplet(c, 72 * SS4, 22 * SS4, 122 * SS4, 33 * SS4, lw, col)

def icon_heart(c: Canvas, col):
    """情绪/同房：心形。"""
    lw = 8.5 * SS4
    c.circle(51 * SS4, 56 * SS4, 19 * SS4, col)
    c.circle(93 * SS4, 56 * SS4, 19 * SS4, col)
    c.quad((34 * SS4, 64 * SS4), (72 * SS4, 118 * SS4), (110 * SS4, 64 * SS4), 8.5 * SS4, col)

def icon_weight(c: Canvas, col):
    """体重：表盘 + 指针。"""
    lw = 9.0 * SS4
    circle_outline(c, 72 * SS4, 72 * SS4, 46 * SS4, lw, col)
    c.line(72 * SS4, 72 * SS4, 92 * SS4, 48 * SS4, 7 * SS4, col)

def icon_bp(c: Canvas, col):
    """血压：圆环 + 心。"""
    lw = 9.0 * SS4
    circle_outline(c, 72 * SS4, 72 * SS4, 46 * SS4, lw, col)
    c.circle(59 * SS4, 64 * SS4, 11 * SS4, col)
    c.circle(85 * SS4, 64 * SS4, 11 * SS4, col)
    c.quad((50 * SS4, 70 * SS4), (72 * SS4, 94 * SS4), (94 * SS4, 70 * SS4), 6.5 * SS4, col)

def icon_glucose(c: Canvas, col):
    """血糖：水滴 + 内点。"""
    icon_lochia(c, col)
    c.circle(72 * SS4, 94 * SS4, 7 * SS4, col)

def icon_fetal(c: Canvas, col):
    """胎动：小脚丫。"""
    lw = 9.0 * SS4
    c.circle(70 * SS4, 86 * SS4, 26 * SS4, col)
    for dx, dy in ((44, 42), (60, 34), (76, 32), (92, 38)):
        c.circle(dx * SS4, dy * SS4, 6.5 * SS4, col)

def icon_timer(c: Canvas, col):
    """宫缩计时：秒表。"""
    lw = 9.0 * SS4
    circle_outline(c, 72 * SS4, 82 * SS4, 40 * SS4, lw, col)
    c.line(72 * SS4, 82 * SS4, 72 * SS4, 56 * SS4, 7 * SS4, col)
    c.line(72 * SS4, 82 * SS4, 92 * SS4, 90 * SS4, 7 * SS4, col)
    c.line(62 * SS4, 24 * SS4, 82 * SS4, 24 * SS4, 7 * SS4, col)
    c.line(72 * SS4, 24 * SS4, 72 * SS4, 36 * SS4, 7 * SS4, col)

def icon_diary(c: Canvas, col):
    """日记：本子 + 行线。"""
    lw = 9.0 * SS4
    round_rect_outline(c, 36 * SS4, 24 * SS4, 108 * SS4, 120 * SS4, 12 * SS4, lw, col)
    for y in (48, 66, 84, 102):
        c.line(52 * SS4, y * SS4, 92 * SS4, y * SS4, 5.5 * SS4, col)

def icon_clinic(c: Canvas, col):
    """产检：医院十字。"""
    lw = 9.0 * SS4
    round_rect_outline(c, 32 * SS4, 32 * SS4, 112 * SS4, 112 * SS4, 16 * SS4, lw, col)
    c.line(72 * SS4, 52 * SS4, 72 * SS4, 92 * SS4, 8 * SS4, col)
    c.line(52 * SS4, 72 * SS4, 92 * SS4, 72 * SS4, 8 * SS4, col)

def icon_symptom(c: Canvas, col):
    """症状：小花（六瓣）。"""
    lw = 8.0 * SS4
    for k in range(6):
        ang = k * math.pi / 3
        c.line(72 * SS4 + 14 * SS4 * math.cos(ang), 72 * SS4 + 14 * SS4 * math.sin(ang),
               72 * SS4 + 38 * SS4 * math.cos(ang), 72 * SS4 + 38 * SS4 * math.sin(ang), 7 * SS4, col)
    c.circle(72 * SS4, 72 * SS4, 11 * SS4, col)

def icon_vaccine(c: Canvas, col):
    """疫苗：注射器。"""
    lw = 8.5 * SS4
    c.line(40 * SS4, 104 * SS4, 96 * SS4, 48 * SS4, lw, col)
    c.line(52 * SS4, 116 * SS4, 108 * SS4, 60 * SS4, lw, col)
    c.line(40 * SS4, 104 * SS4, 52 * SS4, 116 * SS4, lw, col)
    c.line(60 * SS4, 74 * SS4, 74 * SS4, 88 * SS4, 6 * SS4, col)
    c.line(74 * SS4, 60 * SS4, 88 * SS4, 74 * SS4, 6 * SS4, col)
    c.line(96 * SS4, 48 * SS4, 108 * SS4, 60 * SS4, lw, col)

def icon_baby(c: Canvas, col):
    """宝宝：圆脸 + 呆毛。"""
    lw = 9.0 * SS4
    circle_outline(c, 72 * SS4, 78 * SS4, 38 * SS4, lw, col)
    c.circle(58 * SS4, 70 * SS4, 4.5 * SS4, col)
    c.circle(86 * SS4, 70 * SS4, 4.5 * SS4, col)
    c.quad((58 * SS4, 94 * SS4), (72 * SS4, 102 * SS4), (86 * SS4, 94 * SS4), 6 * SS4, col)
    c.quad((64 * SS4, 40 * SS4), (72 * SS4, 24 * SS4), (82 * SS4, 36 * SS4), 6 * SS4, col)

def icon_family(c: Canvas, col):
    """家庭：大人 + 小孩双肩线。"""
    lw = 8.5 * SS4
    c.circle(50 * SS4, 46 * SS4, 13 * SS4, col)
    c.quad((26 * SS4, 112 * SS4), (30 * SS4, 74 * SS4), (52 * SS4, 70 * SS4), lw, col)
    c.circle(94 * SS4, 60 * SS4, 10 * SS4, col)
    c.quad((74 * SS4, 112 * SS4), (78 * SS4, 84 * SS4), (94 * SS4, 80 * SS4), lw, col)
    c.quad((94 * SS4, 80 * SS4), (110 * SS4, 84 * SS4), (116 * SS4, 112 * SS4), lw, col)

def icon_privacy(c: Canvas, col):
    """隐私：锁。"""
    lw = 9.0 * SS4
    round_rect_outline(c, 38 * SS4, 66 * SS4, 106 * SS4, 120 * SS4, 14 * SS4, lw, col)
    steps = 160
    for i in range(steps + 1):
        ang = math.pi + i / steps * math.pi
        c.circle(72 * SS4 + 20 * SS4 * math.cos(ang), 66 * SS4 + 20 * SS4 * math.sin(ang), lw / 2, col)
    c.circle(72 * SS4, 92 * SS4, 7 * SS4, col)

def icon_settings(c: Canvas, col):
    """设置：齿轮。"""
    lw = 9.0 * SS4
    circle_outline(c, 72 * SS4, 72 * SS4, 34 * SS4, lw, col)
    for k in range(8):
        ang = k * math.pi / 4
        c.line(72 * SS4 + 34 * SS4 * math.cos(ang), 72 * SS4 + 34 * SS4 * math.sin(ang),
               72 * SS4 + 48 * SS4 * math.cos(ang), 72 * SS4 + 48 * SS4 * math.sin(ang), 7 * SS4, col)
    c.circle(72 * SS4, 72 * SS4, 11 * SS4, col)

def icon_chart(c: Canvas, col):
    """趋势：折线 + 端点。"""
    lw = 8.5 * SS4
    c.line(26 * SS4, 118 * SS4, 118 * SS4, 118 * SS4, 6 * SS4, col)
    c.quad((32 * SS4, 92 * SS4), (60 * SS4, 66 * SS4), (78 * SS4, 76 * SS4), lw, col)
    c.quad((78 * SS4, 76 * SS4), (98 * SS4, 86 * SS4), (112 * SS4, 42 * SS4), lw, col)
    c.circle(112 * SS4, 42 * SS4, 8 * SS4, col)

def icon_history(c: Canvas, col):
    """时间线：时钟。"""
    icon_timer(c, col)

def icon_export(c: Canvas, col):
    """导出：盒 + 上箭头。"""
    lw = 9.0 * SS4
    c.line(28 * SS4, 66 * SS4, 28 * SS4, 114 * SS4, lw, col)
    c.line(116 * SS4, 66 * SS4, 116 * SS4, 114 * SS4, lw, col)
    c.line(28 * SS4, 114 * SS4, 116 * SS4, 114 * SS4, lw, col)
    c.line(28 * SS4, 66 * SS4, 48 * SS4, 44 * SS4, lw, col)
    c.line(48 * SS4, 44 * SS4, 96 * SS4, 44 * SS4, lw, col)
    c.line(96 * SS4, 44 * SS4, 116 * SS4, 66 * SS4, lw, col)
    c.line(72 * SS4, 94 * SS4, 72 * SS4, 22 * SS4, 7 * SS4, col)
    c.line(58 * SS4, 34 * SS4, 72 * SS4, 22 * SS4, 7 * SS4, col)
    c.line(72 * SS4, 22 * SS4, 86 * SS4, 34 * SS4, 7 * SS4, col)

def icon_report(c: Canvas, col):
    """报告：文件。"""
    lw = 9.0 * SS4
    round_rect_outline(c, 40 * SS4, 24 * SS4, 104 * SS4, 120 * SS4, 10 * SS4, lw, col)
    for y in (52, 70, 88, 106):
        c.line(56 * SS4, y * SS4, 88 * SS4, y * SS4, 5 * SS4, col)

def icon_camera(c: Canvas, col):
    """拍照：相机。"""
    lw = 9.0 * SS4
    round_rect_outline(c, 26 * SS4, 46 * SS4, 118 * SS4, 112 * SS4, 14 * SS4, lw, col)
    c.quad((52 * SS4, 46 * SS4), (60 * SS4, 32 * SS4), (84 * SS4, 32 * SS4), 7 * SS4, col)
    c.quad((84 * SS4, 32 * SS4), (92 * SS4, 34 * SS4), (92 * SS4, 46 * SS4), 7 * SS4, col)
    circle_outline(c, 72 * SS4, 80 * SS4, 16 * SS4, 7 * SS4, col)

def icon_pill(c: Canvas, col):
    """用药：胶囊。"""
    lw = 9.0 * SS4
    c.line(48 * SS4, 48 * SS4, 96 * SS4, 96 * SS4, lw, col)
    c.line(48 * SS4, 48 * SS4, 62 * SS4, 34 * SS4, lw, col)
    c.line(96 * SS4, 96 * SS4, 110 * SS4, 82 * SS4, lw, col)
    c.quad((62 * SS4, 34 * SS4), (96 * SS4, 20 * SS4), (110 * SS4, 82 * SS4), lw, col)

def icon_tip(c: Canvas, col):
    """提示：灯泡。"""
    lw = 9.0 * SS4
    circle_outline(c, 72 * SS4, 62 * SS4, 30 * SS4, lw, col)
    c.line(60 * SS4, 96 * SS4, 84 * SS4, 96 * SS4, 7 * SS4, col)
    c.line(62 * SS4, 110 * SS4, 82 * SS4, 110 * SS4, 7 * SS4, col)
    c.line(72 * SS4, 40 * SS4, 72 * SS4, 62 * SS4, 6 * SS4, col)

def icon_warn(c: Canvas, col):
    """红线警示：三角 + 感叹号。"""
    lw = 9.0 * SS4
    c.line(72 * SS4, 24 * SS4, 122 * SS4, 112 * SS4, lw, col)
    c.line(122 * SS4, 112 * SS4, 22 * SS4, 112 * SS4, lw, col)
    c.line(22 * SS4, 112 * SS4, 72 * SS4, 24 * SS4, lw, col)
    c.line(72 * SS4, 58 * SS4, 72 * SS4, 84 * SS4, 8 * SS4, col)
    c.circle(72 * SS4, 98 * SS4, 4.5 * SS4, col)

def icon_water(c: Canvas, col):
    """饮水：水杯 + 杯柄。"""
    lw = 9.0 * SS4
    round_rect_outline(c, 40 * SS4, 40 * SS4, 94 * SS4, 118 * SS4, 16 * SS4, lw, col)
    steps = 120
    for i in range(steps + 1):
        ang = -math.pi / 2 + i / steps * math.pi
        c.circle(94 * SS4 + 16 * SS4 * math.cos(ang), 78 * SS4 + 18 * SS4 * math.sin(ang), lw / 2, col)
    c.line(52 * SS4, 66 * SS4, 82 * SS4, 66 * SS4, 6 * SS4, col)

def icon_add(c: Canvas, col):
    """加号。"""
    lw = 9.0 * SS4
    c.line(72 * SS4, 30 * SS4, 72 * SS4, 114 * SS4, lw, col)
    c.line(30 * SS4, 72 * SS4, 114 * SS4, 72 * SS4, lw, col)

def icon_bag(c: Canvas, col):
    """待产包：提包 + 提手。"""
    lw = 9.0 * SS4
    round_rect_outline(c, 32 * SS4, 58 * SS4, 112 * SS4, 120 * SS4, 14 * SS4, lw, col)
    steps = 160
    for i in range(steps + 1):
        ang = math.pi + i / steps * math.pi
        c.circle(72 * SS4 + 20 * SS4 * math.cos(ang), 58 * SS4 + 20 * SS4 * math.sin(ang), lw / 2, col)

def icon_bowl(c: Canvas, col):
    """辅食：碗 + 热气。"""
    lw = 9.0 * SS4
    steps = 160
    for i in range(steps + 1):
        ang = i / steps * math.pi
        c.circle(72 * SS4 + 44 * SS4 * math.cos(ang), 70 * SS4 + 44 * SS4 * math.sin(ang), lw / 2, col)
    c.line(28 * SS4, 70 * SS4, 116 * SS4, 70 * SS4, lw, col)
    c.line(52 * SS4, 116 * SS4, 92 * SS4, 116 * SS4, 7 * SS4, col)
    c.quad((58 * SS4, 50 * SS4), (48 * SS4, 38 * SS4), (58 * SS4, 26 * SS4), 5.5 * SS4, col)
    c.quad((80 * SS4, 50 * SS4), (70 * SS4, 38 * SS4), (80 * SS4, 26 * SS4), 5.5 * SS4, col)

def icon_info(c: Canvas, col):
    """关于：信息圆。"""
    lw = 9.0 * SS4
    circle_outline(c, 72 * SS4, 72 * SS4, 46 * SS4, lw, col)
    c.circle(72 * SS4, 48 * SS4, 5 * SS4, col)
    c.line(72 * SS4, 64 * SS4, 72 * SS4, 96 * SS4, 8 * SS4, col)

def icon_strip(c: Canvas, lines: list[tuple[float, float, float]], col):
    """试纸：竖条 + 结果线（x0, y0, y1）。"""
    lw = 9.0 * SS4
    round_rect_outline(c, 46 * SS4, 22 * SS4, 98 * SS4, 122 * SS4, 14 * SS4, lw, col)
    for x, y0, y1 in lines:
        c.line(x * SS4, y0 * SS4, x * SS4, y1 * SS4, 7 * SS4, col)

def icon_strip_neg(c: Canvas, col):
    """阴性：一道杠。"""
    icon_strip(c, [(72, 62, 86)], col)

def icon_strip_weak(c: Canvas, col):
    """弱阳：一深一浅。"""
    icon_strip(c, [(58, 72, 84), (86, 50, 88)], col)

def icon_strip_strong(c: Canvas, col):
    """强阳：两道深杠。"""
    icon_strip(c, [(58, 50, 88), (86, 50, 88)], col)

ICONS = {
    "cycle": icon_cycle, "test": icon_test, "thermo": icon_thermo, "preg": icon_preg,
    "feeding": icon_feeding, "diaper": icon_diaper, "sleep": icon_moon, "sun": icon_sun,
    "growth": icon_growth, "album": icon_album, "lochia": icon_lochia, "heart": icon_heart,
    "weight": icon_weight, "bp": icon_bp, "glucose": icon_glucose, "fetal": icon_fetal,
    "timer": icon_timer, "diary": icon_diary, "clinic": icon_clinic, "symptom": icon_symptom,
    "vaccine": icon_vaccine, "baby": icon_baby, "family": icon_family, "privacy": icon_privacy,
    "settings": icon_settings, "chart": icon_chart, "history": icon_history,
    "export": icon_export, "report": icon_report, "camera": icon_camera, "pill": icon_pill,
    "tip": icon_tip, "warn": icon_warn, "add": icon_add, "bag": icon_bag, "bowl": icon_bowl,
    "water": icon_water,
    "info": icon_info, "strip-neg": icon_strip_neg, "strip-weak": icon_strip_weak,
    "strip-strong": icon_strip_strong,
    "warn-danger": (icon_warn, (229, 72, 77, 255)),  # 红线专用红（与 --lb-danger 一致）
    "mood-great": lambda c, col: face(c, 8, 1, col),
    "mood-good": lambda c, col: face(c, 6, 0.5, col),
    "mood-normal": lambda c, col: face(c, 4, 0, col),
    "mood-low": lambda c, col: face(c, 4, -0.5, col),
    "mood-bad": lambda c, col: face(c, 2, -1, col),
}

def gen_function_icons():
    """static/icons/*.png：144×144 功能图标（玫瑰色；暗色/按压语义由容器与主题承担）。"""
    root = os.path.join(os.path.dirname(__file__), "..", "static", "icons")
    for name, fn in ICONS.items():
        color = ROSE
        if isinstance(fn, tuple):
            fn, color = fn
        c = Canvas(144 * SS4, 144 * SS4)
        fn(c, color)
        write_png(os.path.join(root, f"{name}.png"), 144, 144, downsample(c, SS4).pix)

def gen_empty_scene():
    """static/empty-scene.png：插画级空态——山丘 + 太阳 + 幸运星 + 辉光。"""
    S = 320 * SS4
    c = Canvas(S, S)
    c.glow(S * 0.5, S * 0.36, S * 0.52, (250, 231, 239, 255), peak=0.9)
    c.glow(S * 0.70, S * 0.30, S * 0.15, GOLD, peak=0.35)
    c.circle(S * 0.70, S * 0.30, S * 0.055, GOLD)
    c.star4(S * 0.28, S * 0.30, S * 0.05, GOLD)
    c.quad((S * -0.02, S * 0.72), (S * 0.30, S * 0.50), (S * 0.62, S * 0.76), S * 0.16, (242, 183, 203, 255))
    c.quad((S * 0.30, S * 0.80), (S * 0.62, S * 0.44), (S * 1.05, S * 0.84), S * 0.20, GRAD_B)
    c.line(S * 0.02, S * 0.82, S * 0.98, S * 0.82, S * 0.045, (216, 203, 211, 255))
    write_png(os.path.join(os.path.dirname(__file__), "..", "static", "empty-scene.png"), 320, 320, downsample(c, SS4).pix)

def main():
    root = os.path.join(os.path.dirname(__file__), "..", "static")
    for name in ["today", "record", "data", "learn", "me"]:
        tab_icon(name, GRAY, os.path.join(root, "tab", f"{name}.png"))
        tab_icon(name, ROSE, os.path.join(root, "tab", f"{name}-active.png"))
    write_png(os.path.join(root, "icon.png"), 192, 192, brand_mark(192).pix)
    write_png(os.path.join(root, "mark.png"), 512, 512, brand_mark(512).pix)
    gen_function_icons()
    gen_empty_scene()
    print("v4 assets generated")

if __name__ == "__main__":
    main()
