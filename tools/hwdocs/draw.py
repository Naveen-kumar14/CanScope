"""Engineering wiring diagrams for CANScope, drawn from the canonical ledger.

All geometry is in a 1280 x 960 unit space and rendered at any scale with 2x
supersampling. Every wire drawn here is keyed by its ledger connection id;
validate.py checks that the ids drawn equal the ids in the ledger.

These are SCHEMATIC ILLUSTRATIONS, not photographs of the builder's modules.
"""
from __future__ import annotations

import math
from PIL import Image, ImageDraw, ImageFont

import ledger as L

W, H = 1280, 960
FONTS = {
    ("sans", False): "C:/Windows/Fonts/segoeui.ttf",
    ("sans", True): "C:/Windows/Fonts/segoeuib.ttf",
    ("semi", False): "C:/Windows/Fonts/seguisb.ttf",
    ("mono", False): "C:/Windows/Fonts/consola.ttf",
    ("mono", True): "C:/Windows/Fonts/consolab.ttf",
}

BG = (250, 250, 247)
INK = (28, 33, 40)
MUTED = (110, 116, 124)
BOARD = (24, 44, 72)
SILK = (236, 240, 245)
PINC = (212, 175, 55)
MODULE_TRX = (21, 101, 192)
STATUS_COL = {"CONFIRMED": (46, 125, 50), "PROVISIONAL": (196, 120, 0), "BLOCKED": (198, 40, 40)}
WIRE = {
    "red": (214, 39, 40), "black": (30, 30, 30), "white": (246, 246, 246), "brown": (140, 86, 75),
    "yellow": (235, 190, 0), "green": (44, 160, 44), "blue": (31, 119, 180), "purple": (148, 103, 189),
    "grey": (135, 135, 135), "orange": (255, 127, 14), "component": (90, 90, 90),
}
HALO = (255, 214, 64)


class Canvas:
    def __init__(self, w=W, h=H, scale=1.0, ss=2, bg=BG):
        self.w, self.h, self.scale, self.ss = w, h, scale, ss
        self.k = scale * ss
        self.img = Image.new("RGB", (round(w * self.k), round(h * self.k)), bg)
        self.d = ImageDraw.Draw(self.img)
        self._fonts: dict = {}

    def p(self, x, y):
        return (x * self.k, y * self.k)

    def font(self, size, kind="sans", bold=False):
        key = (kind, bold, size)
        if key not in self._fonts:
            path = FONTS.get((kind, bold)) or FONTS[(kind, False)]
            self._fonts[key] = ImageFont.truetype(path, max(1, round(size * self.k)))
        return self._fonts[key]

    def line(self, pts, fill, width=2, joint="curve"):
        self.d.line([self.p(*q) for q in pts], fill=fill, width=max(1, round(width * self.k)), joint=joint)

    def dashed(self, pts, fill, width=2, dash=10, gap=7):
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            seg = math.hypot(x2 - x1, y2 - y1)
            if seg == 0:
                continue
            ux, uy = (x2 - x1) / seg, (y2 - y1) / seg
            t = 0.0
            while t < seg:
                e = min(seg, t + dash)
                self.line([(x1 + ux * t, y1 + uy * t), (x1 + ux * e, y1 + uy * e)], fill, width)
                t += dash + gap

    def rect(self, x1, y1, x2, y2, fill=None, outline=None, width=1, r=0):
        box = [self.p(x1, y1), self.p(x2, y2)]
        wd = max(1, round(width * self.k)) if outline else 0
        if r:
            self.d.rounded_rectangle(box, radius=r * self.k, fill=fill, outline=outline, width=wd)
        else:
            self.d.rectangle(box, fill=fill, outline=outline, width=wd)

    def circle(self, x, y, r, fill=None, outline=None, width=1):
        self.d.ellipse([self.p(x - r, y - r), self.p(x + r, y + r)], fill=fill, outline=outline,
                       width=max(1, round(width * self.k)) if outline else 0)

    def poly(self, pts, fill=None, outline=None):
        self.d.polygon([self.p(*q) for q in pts], fill=fill, outline=outline)

    def text(self, x, y, s, size=14, fill=INK, kind="sans", bold=False, anchor="la", spacing=4):
        self.d.multiline_text(self.p(x, y), s, font=self.font(size, kind, bold), fill=fill, anchor=anchor,
                              spacing=spacing * self.k) if "\n" in s else \
            self.d.text(self.p(x, y), s, font=self.font(size, kind, bold), fill=fill, anchor=anchor)

    def text_w(self, s, size=14, kind="sans", bold=False):
        return self.d.textlength(s, font=self.font(size, kind, bold)) / self.k

    def tag(self, x, y, s, fg=INK, bg=(255, 255, 255), size=12, bold=True, border=None, pad=5):
        w = self.text_w(s, size, bold=bold) + 2 * pad
        h = size + 2 * pad
        self.rect(x - w / 2, y - h / 2, x + w / 2, y + h / 2, fill=bg, outline=border or fg, width=1.2, r=4)
        self.text(x, y, s, size, fg, bold=bold, anchor="mm")
        return w

    def finish(self):
        return self.img.resize((round(self.w * self.scale), round(self.h * self.scale)), Image.LANCZOS)


def mix(c, bg=BG, a=0.25):
    return tuple(round(bg[i] * (1 - a) + c[i] * a) for i in range(3))


# --------------------------------------------------------------------------- parts
ESP_X0, ESP_Y0, ESP_PITCH = 260, 330, 50
TOP_Y, BOT_Y = 345, 505


def esp_xy(ledger, pin):
    p = L.esp_pin(ledger, pin)
    x = ESP_X0 + 25 + (p["pos"] - 1) * ESP_PITCH
    return (x, BOT_Y if p["side"] == "3V3-side" else TOP_Y)


def draw_esp32(c: Canvas, ledger, title, used=frozenset(), show_avoid=False):
    x0, y0, x1, y1 = ESP_X0, ESP_Y0, ESP_X0 + 15 * ESP_PITCH, 520
    c.rect(x0 - 38, 393, x0 + 4, 457, fill=(170, 172, 176), outline=(90, 90, 90), width=1.5, r=3)
    c.text(x0 - 17, 425, "USB", 11, INK, bold=True, anchor="mm")
    c.rect(x0, y0, x1, y1, fill=BOARD, outline=(10, 20, 35), width=2, r=8)
    c.rect(x1 - 290, 382, x1 - 12, 468, fill=(196, 199, 204), outline=(120, 120, 120), width=1.5, r=4)
    c.rect(x1 - 60, 382, x1 - 12, 468, fill=(60, 120, 70))
    c.text(x1 - 175, 412, "ESP-WROOM-32", 15, (40, 40, 40), bold=True, anchor="mm")
    c.text(x1 - 175, 434, "(read YOUR marking: gate G1)", 11, (60, 60, 60), anchor="mm")
    c.text(x1 - 36, 425, "ANT", 10, SILK, bold=True, anchor="mm")
    c.text(x0 + 150, 415, title, 15, SILK, bold=True, anchor="mm")
    c.text(x0 + 150, 440, "pin 1 of each header = next to USB", 10, SILK, anchor="mm")
    rows = ledger["esp32_header"]["rows"]
    avoid = ledger["esp32_header"]["avoid"]
    bad = set(avoid["flash"] + avoid["strapping"] + avoid["usb_serial"])
    for side, y, ly, la in (("VIN-side", TOP_Y, 364, "mm"), ("3V3-side", BOT_Y, 486, "mm")):
        for i, (silk, g) in enumerate(zip(rows[side]["silk"], rows[side]["gpio"])):
            x = x0 + 25 + i * ESP_PITCH
            key = silk if not (silk == "GND" and side == "VIN-side") else "GND@VIN"
            hot = key in used
            if show_avoid and g in bad:
                c.rect(x - 22, y - 12, x + 22, y + 30 if side == "VIN-side" else y + 12, fill=(120, 40, 40))
            c.rect(x - 7, y - 7, x + 7, y + 7, fill=HALO if hot else PINC, outline=(80, 60, 0), width=1)
            c.text(x, ly, silk, 12, HALO if hot else SILK, bold=hot, anchor=la)


TRX_X0, TRX_Y0 = 420, 700
TRX_PINS = {"3V3": (450, 700), "GND": (500, 700), "CTX": (560, 700), "CRX": (610, 700),
            "CANH": (470, 800), "CANL": (590, 800)}


def trx_xy(pin, dx=0):
    x, y = TRX_PINS[pin]
    return (x + dx, y)


def draw_trx(c: Canvas, name, dx=0, used=frozenset()):
    x0 = TRX_X0 + dx
    c.rect(x0, 700, x0 + 260, 800, fill=MODULE_TRX, outline=(10, 50, 110), width=2, r=6)
    c.rect(x0 + 95, 728, x0 + 165, 772, fill=(30, 30, 30), r=2)
    c.text(x0 + 130, 744, "VP230", 11, (220, 220, 220), bold=True, anchor="mm")
    c.text(x0 + 130, 760, "SN65HVD230", 8, (200, 200, 200), anchor="mm")
    c.text(x0 + 205, 750, name, 15, SILK, bold=True, anchor="mm")
    for pin, (x, y) in TRX_PINS.items():
        x += dx
        hot = pin in used
        c.rect(x - 6, y - 6, x + 6, y + 6, fill=HALO if hot else PINC, outline=(80, 60, 0))
        ly = y + 16 if y == 700 else y - 16
        c.text(x, ly, pin, 11, HALO if hot else SILK, bold=True, anchor="mm")


OLED_PINS = {"GND": (790, 700), "VCC": (850, 700), "SCL": (910, 700), "SDA": (970, 700)}


def draw_oled(c: Canvas, used=frozenset()):
    c.rect(760, 700, 1000, 860, fill=(25, 60, 110), outline=(10, 30, 60), width=2, r=6)
    c.rect(780, 735, 980, 840, fill=(8, 8, 10), r=2)
    c.text(880, 787, "SSD1306 128x64 I2C", 12, (90, 200, 255), anchor="mm")
    for pin, (x, y) in OLED_PINS.items():
        hot = pin in used
        c.rect(x - 6, y - 6, x + 6, y + 6, fill=HALO if hot else PINC, outline=(80, 60, 0))
        c.text(x, y + 17, pin, 11, HALO if hot else SILK, bold=True, anchor="mm")


def resistor(c: Canvas, a, b, label, value_bands, vertical=True):
    (x1, y1), (x2, y2) = a, b
    c.line([a, b], WIRE["component"], 2)
    if vertical:
        ym = (y1 + y2) / 2
        c.rect(x1 - 7, ym - 16, x1 + 7, ym + 16, fill=(226, 205, 160), outline=(120, 100, 60), width=1, r=3)
        for i, col in enumerate(value_bands):
            c.rect(x1 - 7, ym - 11 + i * 6, x1 + 7, ym - 8 + i * 6, fill=col)
        c.text(x1 + 12, ym, label, 11, INK, bold=True, anchor="lm")
    else:
        xm = (x1 + x2) / 2
        c.rect(xm - 16, y1 - 7, xm + 16, y1 + 7, fill=(226, 205, 160), outline=(120, 100, 60), width=1, r=3)
        for i, col in enumerate(value_bands):
            c.rect(xm - 11 + i * 6, y1 - 7, xm - 8 + i * 6, y1 + 7, fill=col)
        c.text(xm, y1 + 18, label, 11, INK, bold=True, anchor="mm")


BANDS = {
    "220": [(200, 30, 30), (200, 30, 30), (120, 70, 30)],
    "120": [(120, 70, 30), (200, 30, 30), (120, 70, 30)],
    "1k": [(120, 70, 30), (20, 20, 20), (200, 30, 30)],
    "10k": [(120, 70, 30), (20, 20, 20), (240, 130, 20)],
}


def led(c: Canvas, x, ya, yk, colour, name):
    """Vertical LED, anode at bottom (ya), cathode at top (yk)."""
    c.line([(x, ya), (x, yk)], WIRE["component"], 2)
    ym = (ya + yk) / 2
    c.poly([(x - 12, ym + 9), (x + 12, ym + 9), (x, ym - 9)], fill=colour, outline=INK)
    c.line([(x - 12, ym - 9), (x + 12, ym - 9)], INK, 2.5)
    c.text(x + 16, ym + 6, "A", 9, MUTED, anchor="lm")
    c.text(x + 16, ym - 9, "K", 9, MUTED, anchor="lm")
    c.text(x - 16, ym, name, 11, INK, bold=True, anchor="rm")


def ground(c: Canvas, x, y, label="GND (top rail)"):
    c.line([(x, y), (x, y + 6)], INK, 2)
    for i, w in enumerate((12, 8, 4)):
        c.line([(x - w, y + 6 + i * 4), (x + w, y + 6 + i * 4)], INK, 2)
    if label:
        c.text(x, y + 26, label, 9, MUTED, anchor="mm")


def button(c: Canvas, cx, cy, name):
    c.rect(cx - 26, cy - 26, cx + 26, cy + 26, fill=(60, 60, 64), outline=INK, width=1.5, r=4)
    c.circle(cx, cy, 13, fill=(20, 20, 20))
    legs = {"L1": (cx - 28, cy + 28), "L2": (cx + 28, cy + 28), "L3": (cx + 28, cy - 28), "L4": (cx - 28, cy - 28)}
    for n, (x, y) in legs.items():
        c.rect(x - 4, y - 4, x + 4, y + 4, fill=PINC, outline=(80, 60, 0))
        c.text(x + (-10 if x < cx else 10), y, n, 9, MUTED, anchor="rm" if x < cx else "lm")
    c.dashed([legs["L1"], legs["L3"]], (180, 180, 180), 1, 4, 4)
    c.text(cx, cy + 46, name, 11, INK, bold=True, anchor="mm")
    return legs


def npn(c: Canvas, blocked=True):
    """Q1 symbol, base on the right (B 240,232), C (200,200), E (200,265)."""
    c.circle(214, 232, 30, outline=INK, width=1.5)
    c.line([(222, 212), (222, 252)], INK, 3)
    c.line([(240, 232), (222, 232)], INK, 2)
    c.line([(222, 222), (200, 205), (200, 200)], INK, 2)
    c.line([(222, 242), (200, 260), (200, 265)], INK, 2)
    c.poly([(200, 260), (206, 250), (211, 257)], fill=INK)
    c.text(190, 200, "C", 10, MUTED, anchor="rm")
    c.text(190, 266, "E", 10, MUTED, anchor="rm")
    c.text(246, 222, "B", 10, MUTED, anchor="lm")
    c.text(150, 232, "Q1 NPN", 11, INK, bold=True, anchor="rm")
    if blocked:
        c.tag(150, 252, "PINOUT BLOCKED (G10)", STATUS_COL["BLOCKED"], (255, 235, 235), 9)


def buzzer(c: Canvas):
    c.circle(200, 150, 17, fill=(30, 30, 30), outline=INK)
    c.text(200, 150, "BZ", 9, (230, 230, 230), bold=True, anchor="mm")
    c.text(212, 128, "+", 13, STATUS_COL["BLOCKED"], bold=True, anchor="lm")
    c.text(212, 173, "-", 13, INK, bold=True, anchor="lm")
    c.text(232, 150, "BZ1 5 V active", 11, INK, bold=True, anchor="lm")


def diode(c: Canvas, x, yk, ya):
    c.line([(x, yk), (x, ya)], WIRE["component"], 2)
    ym = (yk + ya) / 2
    c.poly([(x - 8, ym + 7), (x + 8, ym + 7), (x, ym - 7)], fill=(200, 200, 200), outline=INK)
    c.line([(x - 8, ym - 7), (x + 8, ym - 7)], INK, 2.5)
    c.text(x - 12, ym, "D1\n1N4148\n(if magnetic)", 9, INK, anchor="rm", spacing=1)


# --------------------------------------------------------------------------- wires
def draw_wire(c: Canvas, conn, pts, state):
    cid = conn["id"]
    cur = state.get("current")
    if not state.get("all") and cid not in state.get("done", set()) and cid != cur:
        return False
    col = WIRE[conn["color"]]
    lead = conn["kind"] == "lead"
    wd = 3 if lead else 5
    dim = cur is not None and cid != cur and state.get("dim", True)
    if cid == cur:
        c.line(pts, HALO, wd + 14)
    c.line(pts, BG, wd + 5)
    if conn["status"] == "BLOCKED":
        c.dashed(pts, mix(STATUS_COL["BLOCKED"], a=0.35) if dim else STATUS_COL["BLOCKED"], wd)
    else:
        if conn["color"] == "white":
            c.line(pts, mix((60, 60, 60), a=0.35) if dim else (60, 60, 60), wd + 2)
        c.line(pts, mix(col, a=0.3) if dim else col, wd)
    for q in (pts[0], pts[-1]):
        c.circle(*q, 4.5, fill=mix(INK, a=0.3) if dim else INK)
    if state.get("ids", True) and not dim and cid not in NOTE_IDS:
        lx, ly = LABEL_POS.get(cid) or _label_pos(pts)
        c.tag(lx, ly, cid, STATUS_COL[conn["status"]], (255, 255, 255), 10)
    return True


# Short component leads in the crowded buzzer area are listed in a note box
# instead of carrying a tag; other tags are nudged apart.
NOTE_IDS = {"N3-28", "N3-29", "N3-30", "N3-31", "N3-32", "N3-33", "N3-34"}
LABEL_POS = {"N3-04": (400, 760), "N3-05": (380, 860), "N3-10": (740, 760), "N3-11": (720, 860),
             "N3-01": (285, 760), "N3-02": (335, 860), "B-05": (950, 700)}


def _lead_note(c: Canvas, ledger, state):
    allc = L.by_id(ledger)
    x0, y0 = 14, 548
    c.rect(x0, y0, 262, y0 + 196, fill=(255, 255, 255), outline=(190, 190, 190), r=6)
    c.text(x0 + 8, y0 + 8, "Buzzer-driver leads (no tag in drawing)", 10, INK, bold=True)
    for i, cid in enumerate(sorted(NOTE_IDS)):
        conn = allc[cid]
        hot = cid == state.get("current")
        col = STATUS_COL[conn["status"]]
        y = y0 + 34 + i * 22
        if hot:
            c.rect(x0 + 4, y - 9, 258, y + 9, fill=HALO, r=3)
        c.text(x0 + 8, y, cid, 10, col, bold=True, anchor="lm")
        c.text(x0 + 58, y, f"{conn['from']} - {conn['to']}", 10, INK, kind="mono", anchor="lm")
        c.text(x0 + 218, y, {"BLOCKED": "BLKD", "PROVISIONAL": "PROV", "CONFIRMED": "CONF"}[conn["status"]], 9, col, bold=True, anchor="lm")


def _label_pos(pts):
    best, bl = None, -1
    for a, b in zip(pts, pts[1:]):
        ln = math.hypot(b[0] - a[0], b[1] - a[1])
        if ln > bl:
            best, bl = (a, b), ln
    (x1, y1), (x2, y2) = best
    return ((x1 + x2) / 2, (y1 + y2) / 2)


def rail_tag(c: Canvas, x, y, plus: bool, text=None):
    col = (200, 30, 30) if plus else (30, 30, 30)
    c.tag(x, y, text or ("B+ rail 3V3" if plus else "B- rail GND"), col, (255, 255, 255), 10)


# --------------------------------------------------------------------------- node geometry
def geometry(ledger, node):
    E = lambda pin: esp_xy(ledger, pin)  # noqa: E731
    T = trx_xy
    if node in (1, 2):
        n = str(node)
        g = {
            f"N{n}-01": [E("3V3"), (285, 670), (450, 670), T("3V3")],
            f"N{n}-02": [E("GND"), (335, 650), (500, 650), T("GND")],
            f"N{n}-03": [E("TX2"), (585, 620), (560, 620), T("CTX")],
            f"N{n}-04": [E("RX2"), (535, 600), (610, 600), T("CRX")],
        }
        if node == 1:
            g["N1-05"] = [(500, 835), (470, 835), T("CANH")]
            g["N1-06"] = [(560, 835), (590, 835), T("CANL")]
        return g
    return {
        "N3-01": [E("3V3"), (285, 915)],
        "N3-02": [E("GND"), (335, 940)],
        "N3-03": [(1240, 940), (1240, 90)],
        "N3-04": [(400, 915), (400, 680), (450, 680), T("3V3")],
        "N3-05": [(380, 940), (380, 660), (500, 660), T("GND")],
        "N3-06": [E("TX2"), (585, 620), (560, 620), T("CTX")],
        "N3-07": [E("RX2"), (535, 600), (610, 600), T("CRX")],
        "N3-08": [(500, 835), (470, 835), T("CANH")],
        "N3-09": [(560, 835), (590, 835), T("CANL")],
        "N3-10": [(740, 915), (740, 665), (850, 665), OLED_PINS["VCC"]],
        "N3-11": [(720, 940), (720, 680), (790, 680), OLED_PINS["GND"]],
        "N3-12": [E("D21"), (785, 630), (970, 630), OLED_PINS["SDA"]],
        "N3-13": [E("D22"), (935, 650), (910, 650), OLED_PINS["SCL"]],
        "N3-14": [E("D25"), (635, 310), (650, 310), (650, 290)],
        "N3-15": [(650, 240), (650, 215)],
        "N3-16": [(650, 165), (650, 90)],
        "N3-17": [E("D26"), (585, 310), (560, 310), (560, 290)],
        "N3-18": [(560, 240), (560, 215)],
        "N3-19": [(560, 165), (560, 90)],
        "N3-20": [E("D27"), (535, 310), (470, 310), (470, 290)],
        "N3-21": [(470, 240), (470, 215)],
        "N3-22": [(470, 165), (470, 90)],
        "N3-23": [E("D32"), (735, 300), (872, 300), (872, 228)],
        "N3-24": [(928, 172), (928, 90)],
        "N3-25": [E("D33"), (685, 285), (742, 285), (742, 228)],
        "N3-26": [(798, 172), (798, 90)],
        "N3-27": [E("D13"), (385, 232), (320, 232)],
        "N3-28": [(270, 232), (240, 232)],
        "N3-29": [(252, 250), (252, 232)],
        "N3-30": [(252, 285), (252, 298)],
        "N3-31": [(200, 265), (200, 290)],
        "N3-32": [(200, 167), (200, 200)],
        "N3-33": [(130, 165), (130, 170), (200, 170)],
        "N3-34": [(130, 135), (130, 130), (200, 130)],
        "N3-35": [E("VIN"), (285, 318), (60, 318), (60, 105), (200, 105), (200, 133)],
    }


def used_pins(ledger, node):
    out = set()
    for conn in L.connections(ledger, node):
        for s in ("from", "to"):
            ep = L.parse_ep(conn[s])
            if ep.comp.startswith("ESP"):
                out.add(ep.pin)
    return out


def draw_node(c: Canvas, ledger, node, state=None):
    state = state or {"all": True}
    conns = {x["id"]: x for x in L.connections(ledger, node)}
    geo = geometry(ledger, node)
    names = {1: "NODE 1 - Motor ECU", 2: "NODE 2 - Battery ECU", 3: "NODE 3 - CANScope"}
    trx_used = {L.parse_ep(x["to"]).pin for x in conns.values() if L.parse_ep(x["to"]).comp.startswith("TRX")}
    draw_esp32(c, ledger, names[node], used_pins(ledger, node))
    draw_trx(c, f"TRX{node}", used=trx_used)
    drawn = []
    if node in (1, 2):
        c.rect(260, 110, 1010, 290, fill=(255, 255, 255), outline=(200, 200, 200), r=8)
        c.text(280, 128, f"Node {node} uses only FOUR ESP32 pins, all on the 3V3-side header (bottom row):", 15, INK,
               bold=True)
        for i, t in enumerate(("pin 1  3V3            -> TRX 3V3   (red)",
                               "pin 2  GND            -> TRX GND   (black)",
                               "pin 6  RX2 = GPIO16   <- TRX CRX   (brown)",
                               "pin 7  TX2 = GPIO17   -> TRX CTX   (white)")):
            c.text(300, 165 + i * 27, t, 15, INK, kind="mono")
        c.text(280, 275, "Every other ESP32 pin stays EMPTY.  The VIN-side header is not used on this node.", 13,
               STATUS_COL["BLOCKED"], bold=True, anchor="lm")
        _bus_stubs(c, node)
        if node == 1:
            resistor(c, (500, 835), (560, 835), "RT1 120 Ohm (end A)", BANDS["120"], vertical=False)
    else:
        c.line([(260, 915), (1225, 915)], (200, 30, 30), 3)
        c.line([(260, 940), (1240, 940)], (30, 30, 30), 3)
        c.text(1225, 905, "Board B bottom + rail = 3V3_N3 (Node 3 only)", 11, (200, 30, 30), bold=True, anchor="rb")
        c.text(1100, 952, "Board B bottom - rail = GND", 11, INK, bold=True, anchor="rm")
        c.line([(420, 90), (1240, 90)], (30, 30, 30), 3)
        c.text(1000, 80, "Board B top - rail = GND", 11, INK, bold=True, anchor="mb")
        draw_oled(c, {"GND", "VCC", "SCL", "SDA"})
        resistor(c, (500, 835), (560, 835), "RT2 120 Ohm (end B)", BANDS["120"], vertical=False)
        _bus_stubs(c, 3)
        for x, (col, nm, r) in {470: ((220, 40, 40), "RED", "R_R"), 560: ((240, 200, 0), "YEL", "R_Y"),
                                650: ((40, 170, 60), "GRN", "R_G")}.items():
            resistor(c, (x, 290), (x, 240), f"{r}\n220", BANDS["220"])
            led(c, x, 215, 165, col, nm)
        button(c, 770, 200, "BTN_B")
        button(c, 900, 200, "BTN_A")
        buzzer(c)
        diode(c, 130, 135, 165)
        npn(c, blocked=conns["N3-28"]["status"] == "BLOCKED")
        resistor(c, (320, 232), (270, 232), "R_B 1k", BANDS["1k"], vertical=False)
        resistor(c, (252, 250), (252, 285), "", BANDS["10k"])
        c.text(262, 268, "R_PD\n10k", 9, INK, bold=True, anchor="lm", spacing=0)
        ground(c, 252, 298, "")
        ground(c, 200, 290, "")
        c.text(330, 290, "ground symbol =\ntop GND rail", 9, MUTED, anchor="lm", spacing=0)
    for cid, conn in conns.items():
        if cid in geo and draw_wire(c, conn, geo[cid], state):
            drawn.append(cid)
    if node == 3:
        _lead_note(c, ledger, state)
    _legend(c)
    return set(geo), drawn


def _bus_stubs(c: Canvas, node):
    for pin, label_l, label_r in (("CANH", "CANH", "yellow"), ("CANL", "CANL", "green")):
        x, y = TRX_PINS[pin]
        col = WIRE[label_r]
        c.line([(x, 800), (x, 870)], col, 4)
        seg = {1: ("B-01", "B-02"), 2: ("B-01/B-04", "B-02/B-05"), 3: ("B-04", "B-05")}[node]
        txt = f"{pin} ({seg[0] if pin == 'CANH' else seg[1]})"
        c.tag(x, 880, txt, INK, (255, 255, 240), 9)


def _legend(c: Canvas):
    x, y = 1012, 560
    c.rect(x, y - 30, 1228, y + 210, fill=(255, 255, 255), outline=(200, 200, 200), r=6)
    c.text(x + 10, y - 20, "STATUS (wire-ID tag colour)", 10, INK, bold=True)
    for i, (s, col) in enumerate(STATUS_COL.items()):
        c.rect(x + 12, y + 2 + i * 22, x + 30, y + 16 + i * 22, fill=col, r=2)
        c.text(x + 38, y + 9 + i * 22, s, 10, INK, anchor="lm")
    notes = [("Dashed red = BLOCKED: do not wire.", STATUS_COL["BLOCKED"]),
             ("Thin grey = component lead.", MUTED),
             ("Transceiver / OLED pin ORDER varies:", STATUS_COL["BLOCKED"]),
             ("connect by PRINTED NAME (G4, G7).", STATUS_COL["BLOCKED"]),
             ("Bus trunk B-01..B-06: bus diagram.", MUTED),
             ("Schematic illustration, not a photo.", MUTED)]
    for i, (t, col) in enumerate(notes):
        c.text(x + 10, y + 72 + i * 20, t, 10, col, bold=col != MUTED)


# --------------------------------------------------------------------------- bus diagram
BUS_TRX = {"TRX1": 80, "TRX2": 470, "TRX3": 900}


def bus_pin(comp, pin):
    x0 = BUS_TRX[comp]
    return {"GND": (x0 + 30, 520), "CANH": (x0 + 90, 520), "CANL": (x0 + 170, 520)}[pin]


def bus_geometry():
    P = bus_pin
    return {
        "B-01": [P("TRX1", "CANH"), (170, 640), (560, 640), P("TRX2", "CANH")],
        "B-04": [(560, 640), (990, 640), P("TRX3", "CANH")],
        "B-02": [P("TRX1", "CANL"), (250, 700), (640, 700), P("TRX2", "CANL")],
        "B-05": [(640, 700), (1070, 700), P("TRX3", "CANL")],
        "B-03": [P("TRX1", "GND"), (110, 760), (500, 760), P("TRX2", "GND")],
        "B-06": [(500, 760), (860, 760), (860, 572)],
        "N1-05": [(190, 585), (170, 585)],
        "N1-06": [(230, 585), (250, 585)],
        "N3-08": [(1010, 585), (990, 585)],
        "N3-09": [(1050, 585), (1070, 585)],
    }


def draw_bus(c: Canvas, ledger, state=None):
    state = state or {"all": True}
    allc = L.by_id(ledger)
    c.rect(30, 150, 790, 830, outline=(150, 150, 150), width=1.5, r=10)
    c.text(45, 160, "BREADBOARD A  (Node 1 + Node 2)", 13, MUTED, bold=True)
    c.rect(820, 150, 1250, 830, outline=(150, 150, 150), width=1.5, r=10)
    c.text(835, 160, "BREADBOARD B  (Node 3)", 13, MUTED, bold=True)
    for comp, x0 in BUS_TRX.items():
        n = comp[-1]
        c.rect(x0, 230, x0 + 220, 330, fill=BOARD, r=6)
        c.text(x0 + 110, 266, f"ESP{n}", 16, SILK, bold=True, anchor="mm")
        c.text(x0 + 110, 298, {"1": "Motor ECU", "2": "Battery ECU", "3": "CANScope monitor"}[n], 12, SILK,
               anchor="mm")
        for k, lbl in enumerate(("3V3", "GND", "TX2", "RX2")):
            xx = x0 + 35 + k * 50
            c.line([(xx, 330), (xx, 420)], (150, 150, 150), 2)
            c.text(xx + 3, 375, lbl, 9, MUTED, anchor="lm")
        c.rect(x0, 420, x0 + 220, 520, fill=MODULE_TRX, r=6)
        c.text(x0 + 110, 450, f"{comp}  SN65HVD230", 13, SILK, bold=True, anchor="mm")
        for pin in ("GND", "CANH", "CANL"):
            px, py = bus_pin(comp, pin)
            c.rect(px - 6, py - 6, px + 6, py + 6, fill=PINC)
            c.text(px, py - 18, pin, 10, SILK, bold=True, anchor="mm")
    c.tag(860, 560, "B- rail (Node 3 GND)", INK, (255, 255, 255), 10)
    c.text(872, 585, "TRX3 GND reaches the\nB- rail through N3-05", 9, MUTED, anchor="la", spacing=0)
    resistor(c, (190, 585), (230, 585), "", BANDS["120"], vertical=False)
    resistor(c, (1010, 585), (1050, 585), "", BANDS["120"], vertical=False)
    c.tag(210, 612, "RT1 120 Ohm", STATUS_COL["PROVISIONAL"], (255, 255, 255), 10)
    c.tag(1030, 612, "RT2 120 Ohm", STATUS_COL["PROVISIONAL"], (255, 255, 255), 10)
    drawn = []
    geo = bus_geometry()
    for cid, pts in geo.items():
        if draw_wire(c, allc[cid], pts, state):
            drawn.append(cid)
    for x, y in ((560, 640), (640, 700), (500, 760)):
        c.circle(x, y, 6, fill=INK)
    c.text(40, 640, "CANH", 13, WIRE["yellow"], bold=True, anchor="lm")
    c.text(40, 700, "CANL", 13, WIRE["green"], bold=True, anchor="lm")
    c.text(40, 760, "GND", 13, INK, bold=True, anchor="lm")
    c.text(60, 860, "PHYSICAL END A", 14, STATUS_COL["BLOCKED"], bold=True)
    c.text(1240, 860, "PHYSICAL END B", 14, STATUS_COL["BLOCKED"], bold=True, anchor="ra")
    c.text(640, 890, "One straight line: end A - Node 1 - Node 2 - Node 3 - end B.  Exactly two 120 Ohm terminators.",
           14, INK, bold=True, anchor="mm")
    c.text(640, 915, "Power off: CANH-to-CANL should read about 60 Ohm (120 || 120).  Twist each CANH/CANL pair.",
           13, INK, anchor="mm")
    c.text(640, 940, "No terminator at Node 2.  No star / Y branches.  Never connect CANH or CANL to an ESP32 pin.",
           13, STATUS_COL["BLOCKED"], anchor="mm")
    return set(geo), drawn


# --------------------------------------------------------------------------- reference sheets
def draw_pin_locator(c: Canvas, ledger):
    draw_esp32(c, ledger, "ESP32 DevKit V1 30-pin", {"3V3", "GND", "TX2", "RX2", "D21", "D22", "D25", "D26", "D27",
                                                    "D32", "D33", "D13", "VIN"}, show_avoid=True)
    c.text(640, 60, "ESP32 DevKit V1 (30-pin) pin locator: USB to the LEFT, component side up", 22, INK, bold=True,
           anchor="mm")
    c.text(640, 95, "Highlighted = used by CANScope.  Dark red = do NOT use (flash, strapping, USB serial).",
           14, MUTED, anchor="mm")
    rows = ledger["esp32_header"]["rows"]
    uses = _pin_uses(ledger)
    for side, y0, dy in (("VIN-side", 125, 1), ("3V3-side", 600, 1)):
        c.text(80, y0, f"{side} header (pin 1 = next to USB)", 14, INK, bold=True)
        for i, (s, g) in enumerate(zip(rows[side]["silk"], rows[side]["gpio"])):
            col = i // 8
            x = 80 + col * 560
            y = y0 + 26 + (i % 8) * 20
            key = "GND@VIN" if (s == "GND" and side == "VIN-side") else s
            use = uses.get(key, "")
            gtxt = f"GPIO{g}" if g is not None else "power"
            c.text(x, y, f"{i + 1:>2}  {s:<4} {gtxt:<7} {use}", 12, INK if use else MUTED, kind="mono",
                   bold=bool(use))
    c.text(640, 940, "Gate G2: your silkscreen must match this order exactly, or STOP.", 14,
           STATUS_COL["BLOCKED"], bold=True, anchor="mm")


def _pin_uses(ledger):
    uses = {}
    for conn in ledger["connections"]:
        ep = L.parse_ep(conn["from"])
        if ep.comp.startswith("ESP"):
            tgt = conn["to"]
            nodes = uses.setdefault(ep.pin, [])
            nodes.append(f"{ep.comp[-1]}:{tgt.split(':')[0]}")
    return {k: "used " + ", ".join(sorted(set(v))) for k, v in uses.items()}


def draw_trx_id(c: Canvas):
    c.text(640, 50, "SN65HVD230 transceiver: what the IC is, and what to check on YOUR module", 22, INK, bold=True,
           anchor="mm")
    c.rect(270, 120, 490, 420, fill=(30, 30, 30), r=6)
    c.text(380, 270, "VP230\n(SN65HVD230)\nSOIC-8 top view", 16, (230, 230, 230), bold=True, anchor="mm",
           spacing=6)
    left = [("1", "D  (TXD in)"), ("2", "GND"), ("3", "VCC 3.0-3.6 V"), ("4", "R  (RXD out)")]
    right = [("8", "Rs (mode)"), ("7", "CANH"), ("6", "CANL"), ("5", "Vref (leave open)")]
    for i, (n, t) in enumerate(left):
        y = 160 + i * 75
        c.rect(240, y - 8, 270, y + 8, fill=PINC)
        c.text(234, y, f"{t}   {n}", 14, INK, bold=True, anchor="rm")
    for i, (n, t) in enumerate(right):
        y = 160 + i * 75
        c.rect(490, y - 8, 520, y + 8, fill=PINC)
        c.text(526, y, f"{n}   {t}", 14, INK, bold=True, anchor="lm")
    c.circle(288, 140, 6, fill=(200, 200, 200))
    rows = [
        ("Supply", "VCC 3.0-3.6 V. Feed it from the ESP32 3V3 pin. Never 5 V (D/R abs max = VCC+0.5 V)."),
        ("TX path", "ESP32 TX GPIO -> module CTX / TXD / D.  NOT crossed like a UART."),
        ("RX path", "Module CRX / RXD / R -> ESP32 RX GPIO."),
        ("Rs pin 8", "Strong pull-down = high-speed (needed).  10-100 kOhm = slope control.  High = STANDBY:"),
        ("", "driver off, cannot transmit or ACK.  Gate G5."),
        ("Vref pin 5", "VCC/2 reference output.  Leave unconnected."),
        ("Termination", "Many modules carry a 120 Ohm across CANH-CANL.  Measure it (gate G6)."),
        ("Labels", "Module header order varies.  Wire by PRINTED NAME only (gate G4)."),
    ]
    y = 480
    for k, v in rows:
        c.text(100, y, k, 14, INK, bold=True)
        c.text(260, y, v, 14, INK)
        y += 34
    c.text(100, 780, "Source: Texas Instruments SN65HVD23x datasheet SLOS346O (rev. April 2018), pin table and Section 8.",
           12, MUTED)
    dx = 60
    c.rect(660 + dx, 130, 1200 + dx // 2, 420, outline=(150, 150, 150), width=1.5, r=8)
    c.text(930 + dx, 150, "Typical module (illustration only)", 14, MUTED, bold=True, anchor="mm")
    c.rect(720 + dx, 190, 1140 + dx // 2, 360, fill=MODULE_TRX, r=8)
    c.rect(890 + dx, 240, 970 + dx, 310, fill=(30, 30, 30))
    c.text(930 + dx, 275, "VP230", 12, (220, 220, 220), bold=True, anchor="mm")
    for i, t in enumerate(("3V3", "GND", "CTX", "CRX")):
        c.rect(740 + dx + i * 40, 200, 752 + dx + i * 40, 212, fill=PINC)
        c.text(746 + dx + i * 40, 225, t, 10, SILK, bold=True, anchor="mm")
    for i, t in enumerate(("CANH", "CANL")):
        c.rect(1040 + i * 40, 335, 1052 + i * 40, 347, fill=PINC)
        c.text(1046 + i * 40, 322, t, 10, SILK, bold=True, anchor="mm")
    c.rect(1040, 240, 1070, 255, fill=(40, 40, 40))
    c.text(1055, 268, "R? 121\n=120 Ohm?", 9, SILK, anchor="mm", spacing=0)
    c.text(930 + dx, 395, "Your module's pin order and parts may differ.", 13, STATUS_COL["BLOCKED"], bold=True,
           anchor="mm")


def draw_parts_id(c: Canvas):
    c.text(640, 40, "Identify before you insert: LED, resistor, button, buzzer, transistor, OLED", 22, INK, bold=True,
           anchor="mm")
    # LED
    c.rect(40, 80, 400, 440, outline=(200, 200, 200), r=8)
    c.text(220, 100, "LED polarity (gate G9)", 15, INK, bold=True, anchor="mm")
    c.circle(220, 190, 40, fill=(80, 200, 90), outline=INK, width=2)
    c.line([(255, 160), (255, 220)], INK, 3)
    c.line([(200, 230), (200, 380)], (120, 120, 120), 4)
    c.line([(240, 230), (240, 340)], (120, 120, 120), 4)
    c.text(190, 360, "ANODE +\nlong leg", 12, INK, bold=True, anchor="rm")
    c.text(250, 330, "CATHODE -\nshort leg,\nflat rim", 12, INK, bold=True, anchor="lm")
    c.text(220, 415, "GPIO -> 220 Ohm -> anode;  cathode -> GND", 12, INK, anchor="mm")
    # resistors
    c.rect(420, 80, 860, 440, outline=(200, 200, 200), r=8)
    c.text(640, 100, "Resistor colour bands (4-band) - measure anyway (G13)", 15, INK, bold=True, anchor="mm")
    y = 150
    for val, bands, txt in (("220", BANDS["220"], "red red brown (gold)"), ("120", BANDS["120"], "brown red brown (gold)"),
                            ("1k", BANDS["1k"], "brown black red (gold)"), ("10k", BANDS["10k"], "brown black orange (gold)")):
        resistor(c, (450, y), (560, y), "", bands, vertical=False)
        c.text(580, y, f"{val} Ohm: {txt}", 13, INK, anchor="lm")
        y += 60
    c.text(640, 410, "5-band (1%) parts use different colours.", 12, MUTED, anchor="mm")
    # button
    c.rect(880, 80, 1240, 440, outline=(200, 200, 200), r=8)
    c.text(1060, 100, "Tactile button: diagonal rule (G8)", 15, INK, bold=True, anchor="mm")
    legs = button(c, 1060, 240, "BTN")
    c.text(1060, 340, "Diagonal legs (L1, L3) are ALWAYS on\nopposite contacts, in any orientation.\n"
                      "GPIO -> L1,  GND -> L3.  Meter: open released,\nclosed pressed.", 12, INK, anchor="mm",
           spacing=3)
    # buzzer
    c.rect(40, 460, 400, 920, outline=(200, 200, 200), r=8)
    c.text(220, 480, "5 V active buzzer (G11)", 15, INK, bold=True, anchor="mm")
    c.circle(220, 590, 60, fill=(30, 30, 30))
    c.circle(220, 590, 8, fill=(80, 80, 80))
    c.text(220, 520, "+", 26, STATUS_COL["BLOCKED"], bold=True, anchor="mm")
    c.line([(200, 650), (200, 790)], (120, 120, 120), 4)
    c.line([(240, 650), (240, 750)], (120, 120, 120), 4)
    c.text(190, 770, "+ long leg", 12, INK, bold=True, anchor="rm")
    c.text(250, 740, "- short", 12, INK, bold=True, anchor="lm")
    c.text(220, 840, "Active = beeps on plain DC.\nRated 5 V, <= 30 mA.  Never on a GPIO.\n"
                     "Electromagnetic type -> add D1.", 12, INK, anchor="mm", spacing=3)
    # transistor
    c.rect(420, 460, 860, 920, outline=(200, 200, 200), r=8)
    c.text(640, 480, "NPN transistor TO-92 (G10) - BLOCKED until read", 15, STATUS_COL["BLOCKED"], bold=True,
           anchor="mm")
    c.poly([(560, 520), (720, 520), (720, 620), (560, 620)], fill=(40, 40, 40))
    c.d.pieslice([c.p(560, 560), c.p(720, 680)], 0, 180, fill=(40, 40, 40))
    c.text(640, 570, "flat face\ntoward you", 12, (230, 230, 230), anchor="mm", spacing=2)
    for i in range(3):
        c.line([(600 + i * 40, 680), (600 + i * 40, 760)], (150, 150, 150), 4)
        c.text(600 + i * 40, 775, str(i + 1), 12, INK, bold=True, anchor="mm")
    rows = [("PN2222A", "E B C"), ("2N3904", "E B C"), ("S8050", "E B C"), ("BC547", "C B E")]
    for i, (p, o) in enumerate(rows):
        c.text(500, 805 + i * 24, f"{p:<8} legs 1-2-3 = {o}", 13, INK, kind="mono")
    c.text(640, 905, "Examples only: confirm with YOUR part's datasheet.", 12, STATUS_COL["BLOCKED"], bold=True,
           anchor="mm")
    # OLED
    c.rect(880, 460, 1240, 920, outline=(200, 200, 200), r=8)
    c.text(1060, 480, "SSD1306 I2C OLED (G7)", 15, INK, bold=True, anchor="mm")
    c.rect(930, 520, 1190, 700, fill=(25, 60, 110), r=6)
    c.rect(950, 560, 1170, 690, fill=(8, 8, 10))
    for i, t in enumerate(("GND", "VCC", "SCL", "SDA")):
        c.rect(990 + i * 45, 528, 1000 + i * 45, 538, fill=PINC)
        c.text(995 + i * 45, 550, t, 10, SILK, bold=True, anchor="mm")
    c.text(1060, 760, "Read YOUR labels: some modules\nswap GND and VCC.\nPower from 3V3 only "
                      "(keeps SDA/SCL\npull-ups at 3.3 V).\nAddress: back marking 0x78 = 0x3C.",
           12, INK, anchor="mm", spacing=3)


def draw_power(c: Canvas):
    c.text(640, 40, "Power and ground domains (power OFF while wiring)", 22, INK, bold=True, anchor="mm")
    for i, (n, extra) in enumerate(((1, ""), (2, ""), (3, "OLED.  LEDs: from GPIOs;\nbuttons: internal pull-ups"))):
        x0 = 60 + i * 410
        c.rect(x0, 90, x0 + 360, 640, outline=(180, 180, 180), r=10)
        c.text(x0 + 180, 112, f"NODE {n}", 18, INK, bold=True, anchor="mm")
        c.rect(x0 + 120, 140, x0 + 240, 190, fill=(170, 172, 176), r=4)
        c.text(x0 + 180, 165, f"PC USB {n}", 13, INK, bold=True, anchor="mm")
        c.line([(x0 + 180, 190), (x0 + 180, 240)], WIRE["orange"], 5)
        c.rect(x0 + 90, 240, x0 + 270, 290, fill=(255, 236, 214), outline=WIRE["orange"], width=2, r=4)
        c.text(x0 + 180, 265, f"VIN / 5 V (Node {n})", 13, INK, bold=True, anchor="mm")
        c.line([(x0 + 180, 290), (x0 + 180, 330)], WIRE["orange"], 5)
        c.rect(x0 + 110, 330, x0 + 250, 380, fill=(230, 230, 230), outline=INK, r=4)
        c.text(x0 + 180, 355, "on-board 3.3 V regulator", 11, INK, anchor="mm")
        c.line([(x0 + 180, 380), (x0 + 180, 420)], WIRE["red"], 5)
        c.rect(x0 + 90, 420, x0 + 270, 470, fill=(255, 225, 225), outline=WIRE["red"], width=2, r=4)
        c.text(x0 + 180, 445, f"3V3_N{n}", 14, INK, bold=True, anchor="mm")
        c.text(x0 + 180, 500, f"feeds: TRX{n}" + (f",\n{extra}" if extra else ""), 13, INK, anchor="mm")
        if n == 3:
            c.line([(x0 + 270, 265), (x0 + 330, 265), (x0 + 330, 560)], WIRE["orange"], 4)
            c.text(x0 + 320, 580, "VIN -> BZ1 +\n(N3-35, last)", 12, INK, bold=True, anchor="rm", spacing=2)
        c.rect(x0 + 40, 600, x0 + 320, 630, fill=(40, 40, 40), r=4)
        c.text(x0 + 180, 615, f"GND node {n}", 13, (240, 240, 240), bold=True, anchor="mm")
    c.line([(100, 680), (1180, 680)], (30, 30, 30), 6)
    for x in (240, 650, 1060):
        c.line([(x, 630), (x, 680)], (30, 30, 30), 5)
    c.text(640, 705, "ONE common GND: B-03 (Node 1-2) and B-06 (Node 2-3) run beside the CAN pair", 14, INK,
           bold=True, anchor="mm")
    for i, t in enumerate((
            "NEVER join 3V3_N1, 3V3_N2 and 3V3_N3 together (two regulators fighting).",
            "NEVER join VIN/5 V of different nodes, and NEVER put 5 V on any 3V3 pin or rail.",
            "No external 5 V supply is used.  The buzzer takes 5 V from Node 3's own VIN pin while Node 3 is on USB.",
            "Unplug ALL three USB cables before any wiring change or any resistance / continuity test.")):
        c.text(80, 760 + i * 40, "X  " + t, 15, STATUS_COL["BLOCKED"] if i < 2 else INK, bold=i < 2)


def draw_placement(c: Canvas):
    c.text(640, 36, "Breadboard placement plan (recommended, PROVISIONAL - gate G3)", 22, INK, bold=True, anchor="mm")

    def board(y0, name):
        c.rect(40, y0, 1240, y0 + 330, fill=(245, 244, 238), outline=(170, 170, 170), width=2, r=8)
        c.text(50, y0 - 12, name, 15, INK, bold=True, anchor="lb")
        for yy, col in ((y0 + 14, (200, 30, 30)), (y0 + 30, (30, 30, 200)), (y0 + 300, (200, 30, 30)),
                        (y0 + 316, (30, 30, 200))):
            c.line([(60, yy), (1220, yy)], col, 1.5)
        c.rect(60, y0 + 158, 1220, y0 + 172, fill=(225, 224, 216))
        for col in range(63):
            x = 70 + col * 18.4
            for r in range(10):
                yy = y0 + 55 + r * 22 + (30 if r >= 5 else 0)
                c.circle(x, yy, 1.6, fill=(160, 160, 160))
            if col % 5 == 0 or col == 62:
                c.text(x, y0 + 44, str(col + 1), 9, MUTED, anchor="mm")
        return y0

    def zone(y0, c1, c2, top, bottom, label, fill):
        x1 = 70 + (c1 - 1) * 18.4 - 8
        x2 = 70 + (c2 - 1) * 18.4 + 8
        rows_y = {0: y0 + 50, 5: y0 + 165, 10: y0 + 280}
        c.rect(x1, rows_y[top], x2, rows_y[bottom], fill=fill, outline=INK, width=1.2, r=4)
        c.text((x1 + x2) / 2, (rows_y[top] + rows_y[bottom]) / 2, label, 11, INK, bold=True, anchor="mm")

    a = board(100, "Breadboard A: Node 1 (bus end A) and Node 2 (middle)")
    zone(a, 1, 15, 0, 10, "ESP1  cols 1-15\nUSB off the LEFT edge", (190, 205, 225))
    zone(a, 18, 24, 5, 10, "TRX1\n+ RT1", (180, 210, 245))
    zone(a, 32, 46, 0, 10, "ESP2  cols 32-46\nUSB toward col 31", (190, 205, 225))
    zone(a, 49, 55, 5, 10, "TRX2", (180, 210, 245))
    b = board(530, "Breadboard B: Node 3 (bus end B)")
    zone(b, 1, 15, 0, 10, "ESP3  cols 1-15", (190, 205, 225))
    zone(b, 18, 24, 5, 10, "TRX3\n+ RT2", (180, 210, 245))
    zone(b, 27, 33, 5, 10, "OLED", (200, 220, 240))
    zone(b, 18, 30, 0, 5, "buzzer, Q1,\nR_B, R_PD, D1", (240, 225, 200))
    zone(b, 34, 46, 0, 5, "3 LEDs + 3 x 220", (215, 240, 215))
    zone(b, 50, 58, 0, 10, "BTN_B   BTN_A\nacross trench", (235, 235, 235))
    c.text(640, 880, "Board A rails are NOT used: every Node 1 / Node 2 wire is point-to-point.  Never put 3V3 on a "
                     "Board A rail.", 13, INK, anchor="mm")
    c.text(640, 905, "Board B rails: bottom + = 3V3_N3, bottom - = GND, top - = GND (linked by N3-03).  "
                     "Check split rails (G14).", 13, INK, anchor="mm")
    c.text(640, 935, "Column numbers are a suggestion: if your board does not leave a free hole beside every pin, "
                     "follow gate G3.", 13, STATUS_COL["PROVISIONAL"], bold=True, anchor="mm")
