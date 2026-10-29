#!/usr/bin/env python3
"""生成 Lucky Bump 占位图标（tabBar 81x81 + 应用图标 192x192）。
正式视觉资产可由设计师提供后替换 static/ 目录。零第三方依赖。"""
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

class Canvas:
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

    def circle(self, cx, cy, r, rgba, alpha=1.0, erase_below=None):
        for y in range(int(cy - r) - 2, int(cy + r) + 3):
            if erase_below is not None and y >= erase_below:
                continue
            for x in range(int(cx - r) - 2, int(cx + r) + 3):
                d = math.hypot(x - cx, y - cy)
                a = max(0.0, min(1.0, r - d + 0.5))
                if a > 0:
                    self.blend(x, y, rgba, a * alpha)

    def ring(self, cx, cy, r, t, rgba):
        for y in range(int(cy - r) - 2, int(cy + r) + 3):
            for x in range(int(cx - r) - 2, int(cx + r) + 3):
                d = math.hypot(x - cx, y - cy)
                a = max(0.0, min(1.0, min(d - (r - t), r - d) + 0.5))
                if a > 0:
                    self.blend(x, y, rgba, a)

    def rect(self, x0, y0, x1, y1, rgba, alpha=1.0):
        for y in range(int(y0), int(y1)):
            for x in range(int(x0), int(x1)):
                self.blend(x, y, rgba, alpha)

    def round_rect(self, x0, y0, x1, y1, r, rgba, alpha=1.0):
        for y in range(int(y0), int(y1)):
            for x in range(int(x0), int(x1)):
                dx = max(x0 + r - x, x - (x1 - r - 1), 0)
                dy = max(y0 + r - y, y - (y1 - r - 1), 0)
                d = math.hypot(dx, dy)
                a = max(0.0, min(1.0, r - d + 0.5))
                if a > 0:
                    self.blend(x, y, rgba, a * alpha)

    def heart(self, cx, cy, s, rgba):
        # 隐式心形: (x^2+y^2-1)^3 - x^2*y^3 <= 0
        for y in range(int(cy - s) - 2, int(cy + s) + 3):
            for x in range(int(cx - s) - 2, int(cx + s) + 3):
                nx = (x - cx) / s
                ny = -(y - cy) / s + 0.15
                v = (nx * nx + ny * ny - 1) ** 3 - nx * nx * ny ** 3
                if v <= 0:
                    self.blend(x, y, rgba, 1.0)

    def line(self, x0, y0, x1, y1, t, rgba):
        steps = int(max(abs(x1 - x0), abs(y1 - y0))) * 2 + 1
        for i in range(steps + 1):
            x = x0 + (x1 - x0) * i / steps
            y = y0 + (y1 - y0) * i / steps
            self.circle(x, y, t / 2, rgba)

GRAY = (182, 170, 187, 255)      # 未选中：藕灰紫
ROSE = (228, 83, 127, 255)       # 选中：蔷薇玫瑰
WHITE = (255, 255, 255, 255)
GRAD_A = (240, 112, 157, 255)    # 应用图标渐变起点
GRAD_B = (220, 61, 117, 255)     # 应用图标渐变终点

def tab_icon(name, color, out):
    S = 81
    c = Canvas(S, S)
    cx, cy = S / 2, S / 2
    if name == "today":       # 太阳：圆 + 8 条光线
        c.circle(cx, cy, 12, color)
        for k in range(8):
            ang = k * math.pi / 4
            c.line(cx + 20 * math.cos(ang), cy + 20 * math.sin(ang),
                   cx + 27 * math.cos(ang), cy + 27 * math.sin(ang), 5, color)
    elif name == "record":    # 加号（圆角更饱满）
        c.round_rect(cx - 6, 14, cx + 6, 67, 6, color)
        c.round_rect(14, cy - 6, 67, cy + 6, 6, color)
    elif name == "data":      # 柱状图
        for i, hgt in enumerate([22, 34, 46]):
            x = 18 + i * 17
            c.round_rect(x, cy + 18 - hgt, x + 12, cy + 18, 6, color)
        c.line(16, cy + 18, 65, cy + 18, 3, color)
    elif name == "learn":     # 书本
        c.round_rect(14, 18, 40, 63, 5, color)
        c.round_rect(41, 18, 67, 63, 5, color)
        c.rect(39.5, 18, 41.5, 63, (255, 255, 255, 255))
    elif name == "me":        # 人像
        c.circle(cx, 28, 11, color)
        c.circle(cx, 74, 24, color, erase_below=60)
    write_png(out, S, S, c.pix)

def app_icon(out):
    # 玫瑰渐变圆角方块 + 白色爱心（对角线性插值）
    S = 192
    c = Canvas(S, S)
    r0, r1 = 48, 48
    for y in range(8, S - 8):
        for x in range(8, S - 8):
            dx = max(8 + r0 - x, x - (S - 8 - r0 - 1), 0)
            dy = max(8 + r0 - y, y - (S - 8 - r0 - 1), 0)
            d = math.hypot(dx, dy)
            a = max(0.0, min(1.0, r0 - d + 0.5))
            if a <= 0:
                continue
            t = (x + y) / (2.0 * S)
            rgba = tuple(int(GRAD_A[i] + (GRAD_B[i] - GRAD_A[i]) * t) for i in range(3)) + (255,)
            c.blend(x, y, rgba, a)
    c.heart(S / 2, S / 2 + 8, 42, WHITE)
    write_png(out, S, S, c.pix)

if __name__ == "__main__":
    root = os.path.join(os.path.dirname(__file__), "..", "static")
    for name in ["today", "record", "data", "learn", "me"]:
        tab_icon(name, GRAY, os.path.join(root, "tab", f"{name}.png"))
        tab_icon(name, ROSE, os.path.join(root, "tab", f"{name}-active.png"))
    app_icon(os.path.join(root, "icon.png"))
    print("icons generated:", sorted(os.listdir(os.path.join(root, "tab"))))
