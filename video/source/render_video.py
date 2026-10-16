"""Render the CANScope physical build video.

Pipeline: scenes.build() -> narration WAVs (Windows SAPI, one per sentence)
-> one 1920x1080 frame per sentence (subtitle = that sentence) -> ffmpeg
(concat demuxer, still-image H.264 + AAC). Also writes storyboard.md,
narration.md and captions.srt next to the MP4.

Usage (from the repository root):
  python video/source/render_video.py            # full render
  python video/source/render_video.py --frames-only --limit 10
Requires: Pillow, imageio-ffmpeg (bundled ffmpeg), Windows with System.Speech.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import textwrap
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "tools" / "hwdocs"))
sys.path.insert(0, str(HERE))
import draw as D  # noqa: E402
import ledger as L  # noqa: E402
import scenes  # noqa: E402
from build_diagrams import render as render_sheet  # noqa: E402
from PIL import Image  # noqa: E402

OUT_DIR = REPO / "video"
WORK = REPO / "build" / "video"
FW, FH = 1920, 1080
TOP, BOT = 70, 975
RATE = 22050
GAP_S = 0.45
STEP_PAUSE_S = 1.4
VOICE = "Microsoft Zira Desktop"

TONE = {"info": (40, 70, 110), "ok": D.STATUS_COL["CONFIRMED"], "warn": D.STATUS_COL["PROVISIONAL"],
        "stop": D.STATUS_COL["BLOCKED"]}


# --------------------------------------------------------------------------- TTS
DIGITS = "zero one two three four five six seven eight nine".split()


def speakable(s: str) -> str:
    rep = [
        (r"0x([0-9A-Fa-f]+)", lambda m: "hex " + " ".join(DIGITS[int(ch, 16)] if ch.isdigit() else ch.upper()
                                                          for ch in m.group(1))),
        (r"\bN(\d)-(\d)(\d)\b", r"N \1, \2 \3"), (r"\bB-0(\d)\b", r"B zero \1"),
        (r"\bG(\d+)\b", r"G \1"), (r"3V3_N(\d)", r"three volt three, node \1"), (r"\b3V3\b", "three volt three"),
        (r"GPIO\s?(\d+)", r"G P I O \1"), (r"\bGPIO\b", "G P I O"), (r"\bCANH\b", "CAN high"),
        (r"\bCANL\b", "CAN low"), (r"\bCTX\b", "C T X"), (r"\bCRX\b", "C R X"), (r"\bTRX(\d)", r"T R X \1"),
        (r"\bESP(\d)", r"E S P \1"), (r"\bRX2\b", "R X 2"), (r"\bTX2\b", "T X 2"), (r"\bVIN\b", "V in"),
        (r"\bGND\b", "ground"), (r"\bkOhm\b", "kilo-ohm"), (r"\bOhm\b", "ohm"), (r"\bR_PD\b", "R P D"),
        (r"\bR_B\b", "R B"), (r"\bR_([GYR])\b", r"R \1"), (r"\bLED_([GYR])\b", r"LED \1"), (r"\bBTN_([AB])\b",
                                                                                         r"button \1"),
        (r"\bRT(\d)\b", r"R T \1"), (r"\bBZ1\b", "B Z 1"), (r"\bQ1\b", "Q 1"), (r"\bD1\b", "D 1"),
        (r"\bSDA\b", "S D A"), (r"\bSCL\b", "S C L"), (r"\bI2C\b", "I squared C"), (r"\bD(\d\d)\b", r"D \1"),
        (r"\bL([1-4])\b", r"L \1"), (r"(\d) V\b", r"\1 volts"), (r"\bmA\b", "milliamps"), (r"->", " to "),
        (r"_", " "), (r";", ","), (r"\bOLED\b", "O LED"), (r"\bRAIL3\b", "rail"),
    ]
    for pat, sub in rep:
        s = re.sub(pat, sub, s)
    return s


def tts_all(items: list[tuple[str, Path]]):
    todo = [(t, p) for t, p in items if not p.exists()]
    if not todo:
        return
    manifest = WORK / "tts_manifest.json"
    manifest.write_text(json.dumps([{"text": t, "path": str(p)} for t, p in todo]), encoding="utf-8")
    ps = WORK / "tts.ps1"
    ps.write_text(f"""
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('{VOICE}')
$s.Rate = -1
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo({RATE}, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$items = Get-Content -Raw -Encoding utf8 '{manifest}' | ConvertFrom-Json
foreach ($it in $items) {{
  $s.SetOutputToWaveFile($it.path, $fmt)
  $s.Speak($it.text)
}}
$s.SetOutputToNull()
""", encoding="utf-8")
    print(f"TTS: synthesising {len(todo)} sentences ...", flush=True)
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ps)], check=True)


def wav_seconds(p: Path) -> float:
    with wave.open(str(p)) as w:
        return w.getnframes() / w.getframerate()


# --------------------------------------------------------------------------- frames
_sheet_cache: dict = {}


def sheet_img(name):
    if name not in _sheet_cache:
        _sheet_cache[name] = render_sheet(name, scale=1.0)
    return _sheet_cache[name]


def diagram_img(led, vis, scale):
    c = D.Canvas(scale=scale)
    t = vis["type"]
    if t == "node":
        st = {"done": set(vis["done"]), "current": vis["current"], "all": False}
        D.draw_node(c, led, vis["node"], st)
        c.text(640, 22, f"Node {vis['node']} wiring", 20, D.INK, bold=True, anchor="mm")
    elif t == "bus":
        st = {"done": set(vis.get("done", [])), "current": vis.get("current"), "all": vis.get("all", False)}
        D.draw_bus(c, led, st)
        c.text(640, 40, "CAN bus trunk", 22, D.INK, bold=True, anchor="mm")
    elif t == "measure":
        draw_measure(c, vis["kind"])
    return c.finish()


def draw_measure(c: D.Canvas, kind):
    titles = {
        "rails": ("Supply short check", "RED probe: 3V3 (each node), VIN (Node 3)", "BLACK probe: GND of the same node",
                  "EXPECT: not a steady 0 Ohm"),
        "canpol": ("CAN continuity and polarity", "RED: TRX1 CANH  -> BLACK: TRX3 CANH (then CANL to CANL)",
                   "Then CANH / CANL to GND, 3V3, VIN: must NOT beep", "EXPECT: CANH-CANH and CANL-CANL about 0 Ohm"),
        "term": ("Bus termination", "RED: any CANH point", "BLACK: any CANL point", "EXPECT: about 60 Ohm"),
        "power1": ("Node 1 alone on USB", "Serial monitor 115200 baud", "RED: TRX1 3V3   BLACK: TRX1 GND",
                   "EXPECT: 3.0 - 3.6 V"),
        "power2": ("Node 2 alone on USB", "Serial monitor 115200 baud", "RED: TRX2 3V3   BLACK: TRX2 GND",
                   "EXPECT: 3.0 - 3.6 V"),
        "power3": ("Node 3 alone on USB", "RED: TRX3 3V3 (3.0-3.6 V), then VIN (4.4-5.25 V, G12)",
                   "BLACK: Node 3 GND rail", "EXPECT: values inside both ranges"),
    }
    head, l1, l2, exp = titles[kind]
    unpowered = not kind.startswith("power")
    c.text(640, 60, head, 30, D.INK, bold=True, anchor="mm")
    c.text(640, 105, "ALL POWER REMOVED" if unpowered else "ONLY THIS NODE'S USB PLUGGED IN", 20,
           D.STATUS_COL["BLOCKED"] if unpowered else D.STATUS_COL["PROVISIONAL"], bold=True, anchor="mm")
    c.rect(440, 170, 840, 700, fill=(250, 200, 40), outline=(60, 50, 10), width=3, r=26)
    c.rect(480, 210, 800, 360, fill=(200, 215, 190), outline=(60, 60, 60), width=2, r=8)
    c.text(640, 285, "EXPECTED\n" + exp.split(": ", 1)[1], 26, (30, 40, 30), kind="mono", bold=True, anchor="mm",
           spacing=8)
    c.circle(640, 500, 95, fill=(50, 50, 50))
    c.text(640, 500, "Ohm / V\n(not current!)", 18, (240, 240, 240), bold=True, anchor="mm", spacing=4)
    c.circle(560, 650, 18, fill=(20, 20, 20))
    c.circle(720, 650, 18, fill=(200, 30, 30))
    c.text(560, 685, "COM", 14, D.INK, bold=True, anchor="mm")
    c.text(720, 685, "V/Ohm", 14, D.INK, bold=True, anchor="mm")
    c.line([(720, 650), (900, 760), (1050, 770)], (200, 30, 30), 6)
    c.line([(560, 650), (380, 760), (230, 770)], (20, 20, 20), 6)
    c.text(1060, 800, l1, 17, D.INK, bold=True, anchor="ra")
    c.text(220, 800, l2, 17, D.INK, bold=True, anchor="la")
    c.text(640, 880, "Illustration of the method. The value shown is what to EXPECT, not a recorded measurement.",
           16, D.MUTED, anchor="mm")


def wrap(c, text, size, width, bold=False, kind="sans"):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if c.text_w(t, size, kind, bold) <= width:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_panel(c: D.Canvas, led, panel, x0, y0, w, h):
    c.rect(x0, y0, x0 + w, y0 + h, fill=(255, 255, 255), outline=(205, 205, 205), width=1.5, r=12)
    x, y = x0 + 22, y0 + 20
    width = w - 44
    if panel["type"] == "wire":
        conn = L.by_id(led)[panel["conn"]]
        col = D.STATUS_COL[conn["status"]]
        c.text(x, y, conn["id"], 44, D.INK, bold=True)
        c.tag(x0 + w - 120, y + 26, conn["status"], col, (255, 255, 255), 20)
        y += 72
        rows = [("FROM", L.describe_ep(led, L.parse_ep(conn["from"]))),
                ("TO", L.describe_ep(led, L.parse_ep(conn["to"]))),
                ("SIGNAL", conn["signal"]),
                ("WIRE", "component lead (no jumper)" if conn["kind"] == "lead" else f"{conn['color']} jumper"),
                ("DOMAIN", conn["domain"]),
                ("GATES", ", ".join(f"{g} {led['gates'][g]['title']}" for g in conn["gates"]) or "none"),
                ("CHECK", conn["verify"])]
        for k, v in rows:
            c.text(x, y, k, 15, D.MUTED, bold=True)
            if k == "WIRE" and conn["kind"] != "lead":
                sw = D.WIRE[conn["color"]]
                c.rect(x + 100, y + 2, x + 150, y + 20, fill=sw, outline=(60, 60, 60), r=3)
                lines = wrap(c, v, 21, width - 170, True)
                xx = x + 165
            else:
                lines = wrap(c, v, 21 if k in ("FROM", "TO", "SIGNAL") else 18, width - 100,
                             k in ("FROM", "TO", "SIGNAL"))
                xx = x + 100
            for i, ln in enumerate(lines[:4]):
                c.text(xx, y - 3 + i * 27, ln, 21 if k in ("FROM", "TO", "SIGNAL", "WIRE") else 18,
                       col if k == "SIGNAL" else D.INK, bold=k in ("FROM", "TO", "SIGNAL"))
            y += max(1, min(4, len(lines))) * 27 + 16
        if conn["status"] == "BLOCKED":
            c.rect(x0 + 12, y0 + h - 92, x0 + w - 12, y0 + h - 12, fill=(255, 232, 232), outline=col, width=2, r=8)
            c.text(x0 + w / 2, y0 + h - 52, "STOP - do NOT make this connection", 24, col, bold=True, anchor="mm")
        elif conn["status"] == "PROVISIONAL":
            c.text(x0 + w / 2, y0 + h - 30, "Wire only after the gates above passed and are recorded", 16, col,
                   bold=True, anchor="mm")
    elif panel["type"] == "gates":
        for g in panel["gates"]:
            gate = led["gates"][g]
            c.text(x, y, f"{g}  {gate['title']}", 22, D.INK, bold=True)
            y += 34
            for k, v, colr in (("HOW", gate["procedure"], D.INK), ("PASS", gate["pass"], D.STATUS_COL["CONFIRMED"]),
                               ("FAIL", gate["fail"], D.STATUS_COL["BLOCKED"])):
                lines = wrap(c, v, 16, width - 70)
                c.text(x, y, k, 14, colr, bold=True)
                for i, ln in enumerate(lines[:6]):
                    c.text(x + 62, y - 2 + i * 22, ln, 16, D.INK)
                y += max(1, min(6, len(lines))) * 22 + 8
            y += 14
    elif panel["type"] == "bullets":
        tone = TONE[panel.get("tone", "info")]
        for i, ln in enumerate(wrap(c, panel["title"], 26, width, True)):
            c.text(x, y + i * 34, ln, 26, tone, bold=True)
        y += 34 * len(wrap(c, panel["title"], 26, width, True)) + 18
        for item in panel["items"]:
            lines = wrap(c, item, 19, width - 30)
            c.circle(x + 8, y + 12, 5, fill=tone)
            for i, ln in enumerate(lines[:5]):
                c.text(x + 26, y + i * 27, ln, 19, D.INK)
            y += min(5, len(lines)) * 27 + 12


def draw_card(c: D.Canvas, vis):
    tone = TONE[vis.get("tone", "info")]
    c.rect(60, 100, FW - 60, BOT - 25, fill=(255, 255, 255), outline=(205, 205, 205), width=1.5, r=16)
    c.rect(60, 100, 76, BOT - 25, fill=tone, r=4)
    lines = wrap(c, vis["heading"], 48, FW - 260, True)
    y = 150
    for ln in lines:
        c.text(130, y, ln, 48, D.INK, bold=True)
        y += 62
    y += 30
    for text, t in vis["lines"]:
        col = TONE[t]
        sub = wrap(c, text, 30, FW - 330)
        c.rect(130, y + 6, 152, y + 28, fill=col, r=4)
        for i, ln in enumerate(sub):
            c.text(180, y + i * 40, ln, 30, D.INK, bold=t == "stop")
        y += 40 * len(sub) + 26


def frame(led, step, sent_idx, base_cache):
    c = D.Canvas(FW, FH, scale=1.0, ss=1)
    c.rect(0, 0, FW, TOP, fill=(22, 32, 48))
    c.text(28, TOP / 2, f"Scene {step['scene']}  |  {scenes.SCENES[step['scene']]}", 26, (240, 240, 240),
           bold=True, anchor="lm")
    c.text(FW - 28, TOP / 2, f"{step['title']}   step {step['seq']}", 22, (180, 200, 225), anchor="rm")
    vis = step["visual"]
    if vis["type"] == "card":
        draw_card(c, vis)
    else:
        key = step["seq"]
        if key not in base_cache:
            if vis["type"] == "sheet":
                img = sheet_img(vis["name"])
            else:
                img = diagram_img(led, vis, 1.0)
            base_cache.clear()
            base_cache[key] = img
        img = base_cache[key]
        aw, ah = 1235, BOT - TOP - 10
        k = min(aw / img.width, ah / img.height)
        im = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
        c.img.paste(im, (8 + (aw - im.width) // 2, TOP + 5))
        c.tag(130, TOP + 26, "SCHEMATIC ILLUSTRATION", D.STATUS_COL["PROVISIONAL"], (255, 250, 235), 15)
        if step["panel"]:
            draw_panel(c, led, step["panel"], 1255, TOP + 12, FW - 1255 - 14, BOT - TOP - 24)
    # subtitle bar
    c.rect(0, BOT, FW, FH, fill=(14, 18, 24))
    text = step["narration"][sent_idx]
    lines = wrap(c, text, 27, 1430)
    if len(lines) > 3:
        lines = lines[:3]
        lines[-1] += " ..."
    y0 = BOT + (FH - BOT) / 2 - (len(lines) - 1) * 16
    for i, ln in enumerate(lines):
        c.text(30, y0 + i * 32, ln, 27 if len(lines) < 3 else 24, (245, 245, 245), anchor="lm")
    p = step["power"]
    off = p.startswith("ALL POWER OFF")
    col = (198, 40, 40) if off else (196, 120, 0)
    c.rect(1490, BOT + 16, FW - 16, FH - 16, fill=col, r=10)
    for i, ln in enumerate(wrap(c, ("POWER: " + p).upper(), 17, 390, True)[:3]):
        c.text((1490 + FW - 16) / 2, BOT + 36 + i * 22, ln, 17, (255, 255, 255), bold=True, anchor="mm")
    return c.img


# --------------------------------------------------------------------------- outputs
def ts(t):
    h, r = divmod(t, 3600)
    m, s = divmod(r, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def write_docs(steps, timeline, total):
    led = L.load()
    # narration.md
    out = ["# CANScope physical build video: narration script", "",
           f"Generated by `video/source/render_video.py` from `video/source/scenes.py` and "
           f"`docs/wiring/pin_ledger.json` ({led['meta']['revision']}). Total length {ts(total)}.",
           "Voice: Windows SAPI (Microsoft Zira). Timestamps are the start of each sentence in the MP4.", ""]
    cur_scene = None
    for st, idx, t0, t1 in timeline:
        if st["scene"] != cur_scene:
            cur_scene = st["scene"]
            out += ["", f"## Scene {cur_scene}: {scenes.SCENES[cur_scene]}", ""]
        if idx == 0:
            out += [f"**Step {st['seq']} - {st['title']}**", ""]
        out.append(f"- `{ts(t0)}` {st['narration'][idx]}")
    (OUT_DIR / "narration.md").write_text("\n".join(out) + "\n", encoding="utf-8")
    # storyboard.md
    starts = {}
    for st, idx, t0, t1 in timeline:
        starts.setdefault(st["seq"], [t0, t1])
        starts[st["seq"]][1] = t1
    sb = ["# CANScope physical build video: storyboard", "",
          "One row per step. Every diagram is a schematic illustration generated from the pin ledger; no "
          "photographs of the builder's hardware were available. Wire steps show the ledger row in the right "
          "panel (FROM, TO, signal, colour, status, gates, check).", "",
          "| Step | Time | Scene | Title | Visual | Panel | Power state |", "|---|---|---|---|---|---|---|"]
    for st in steps:
        v = st["visual"]
        vt = {"card": f"text card: {v.get('heading', '')}", "sheet": f"sheet `{v.get('name')}`",
              "node": f"Node {v.get('node')} diagram, {len(v.get('done', []))} wires placed"
                      + (f", highlight **{v['current']}**" if v.get("current") else ""),
              "bus": "bus diagram" + (f", highlight **{v['current']}**" if v.get("current") else ""),
              "measure": f"meter illustration ({v.get('kind')})"}[v["type"]]
        p = st["panel"]
        pt = "-" if not p else {"wire": f"ledger row {p.get('conn')}", "gates": "gates " + ", ".join(p.get("gates", [])),
                                "bullets": p.get("title", "")}[p["type"]]
        a, b = starts[st["seq"]]
        sb.append(f"| {st['seq']} | {ts(a)} - {ts(b)} | {st['scene']} | {st['title']} | {vt} | {pt} | "
                  f"{st['power']} |")
    (OUT_DIR / "storyboard.md").write_text("\n".join(sb) + "\n", encoding="utf-8")
    # captions.srt
    srt = []
    for i, (st, idx, t0, t1) in enumerate(timeline, 1):
        f = lambda t: ts(t).replace(".", ",")  # noqa: E731
        srt += [str(i), f"{f(t0)} --> {f(t1)}", st["narration"][idx], ""]
    (OUT_DIR / "CANScope_Physical_Build_Demo.srt").write_text("\n".join(srt), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="only the first N steps (test renders)")
    ap.add_argument("--frames-only", action="store_true")
    args = ap.parse_args()
    led = L.load()
    steps = scenes.build(led)
    if args.limit:
        steps = steps[: args.limit]
    (WORK / "tts").mkdir(parents=True, exist_ok=True)
    (WORK / "frames").mkdir(parents=True, exist_ok=True)
    items = []
    for st in steps:
        for s in st["narration"]:
            spoken = speakable(s)
            h = hashlib.sha1((VOICE + spoken).encode()).hexdigest()[:16]
            items.append((spoken, WORK / "tts" / f"{h}.wav"))
    if not args.frames_only:
        tts_all(items)
    # timeline + audio
    timeline, t = [], 0.0
    pcm = bytearray()
    it = iter(items)
    concat = ["ffconcat version 1.0"]
    base_cache: dict = {}
    n = 0
    for st in steps:
        for idx in range(len(st["narration"])):
            spoken, wav = next(it)
            dur = wav_seconds(wav) if wav.exists() else 3.0
            pad = GAP_S + (STEP_PAUSE_S if idx == len(st["narration"]) - 1 else 0.0)
            if wav.exists():
                with wave.open(str(wav)) as w:
                    assert w.getframerate() == RATE and w.getsampwidth() == 2 and w.getnchannels() == 1
                    pcm += w.readframes(w.getnframes())
            else:
                pcm += bytes(int(dur * RATE) * 2)
            pcm += bytes(int(pad * RATE) * 2)
            seg = len(pcm) / 2 / RATE - t
            timeline.append((st, idx, t, t + seg))
            n += 1
            fp = WORK / "frames" / f"f{n:05d}.png"
            frame(led, st, idx, base_cache).save(fp)
            concat += [f"file '{fp.as_posix()}'", f"duration {seg:.3f}"]
            t += seg
        print(f"step {st['seq']:3d}/{len(steps)} {st['title'][:40]:40s} t={ts(t)}", flush=True)
    concat.append(f"file '{(WORK / 'frames' / f'f{n:05d}.png').as_posix()}'")
    (WORK / "frames.ffconcat").write_text("\n".join(concat) + "\n", encoding="utf-8")
    with wave.open(str(WORK / "narration.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(pcm))
    if args.frames_only:
        print("frames only; skipping encode")
        return
    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    mp4 = OUT_DIR / ("CANScope_Physical_Build_Demo.mp4" if not args.limit else "preview.mp4")
    # One chapter per scene so a builder can jump straight to e.g. "Assemble Node 3".
    meta = [";FFMETADATA1", "title=CANScope physical build demonstration (schematic illustrations)"]
    scene_start: dict[int, float] = {}
    for st, idx, t0, t1 in timeline:
        scene_start.setdefault(st["scene"], t0)
    order = sorted(scene_start.items(), key=lambda kv: kv[1])
    for i, (sc, t0) in enumerate(order):
        t1 = order[i + 1][1] if i + 1 < len(order) else t
        meta += ["[CHAPTER]", "TIMEBASE=1/1000", f"START={int(t0 * 1000)}", f"END={int(t1 * 1000)}",
                 f"title=Scene {sc}: {scenes.SCENES[sc]}"]
    (WORK / "chapters.txt").write_text("\n".join(meta) + "\n", encoding="utf-8")
    cmd = [ff, "-y", "-f", "concat", "-safe", "0", "-i", str(WORK / "frames.ffconcat"), "-i",
           str(WORK / "narration.wav"), "-i", str(WORK / "chapters.txt"), "-map", "0:v", "-map", "1:a",
           "-map_metadata", "2", "-map_chapters", "2",
           "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "medium",
           "-tune", "stillimage", "-crf", "20", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
           "-shortest", str(mp4)]
    subprocess.run(cmd, check=True)
    if not args.limit:
        write_docs(steps, timeline, t)
    print(f"wrote {mp4} ({t / 60:.1f} min)")


if __name__ == "__main__":
    main()
