"""Build docs/CANScope_Physical_Build_Manual_Rev2.pdf from the ledger and diagrams.

Run build_diagrams.py first (or let this script call it).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import ledger as L  # noqa: E402
import build_diagrams  # noqa: E402

from reportlab.lib import colors  # noqa: E402
from reportlab.lib.enums import TA_CENTER  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet  # noqa: E402
from reportlab.lib.units import mm  # noqa: E402
from reportlab.pdfbase import pdfmetrics  # noqa: E402
from reportlab.pdfbase.ttfonts import TTFont  # noqa: E402
from reportlab.platypus import (Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer,  # noqa: E402
                                Table, TableStyle)

OUT = L.REPO / "docs" / "CANScope_Physical_Build_Manual_Rev2.pdf"
DIAG = L.REPO / "docs" / "wiring" / "diagrams"

pdfmetrics.registerFont(TTFont("Seg", "C:/Windows/Fonts/segoeui.ttf"))
pdfmetrics.registerFont(TTFont("SegB", "C:/Windows/Fonts/segoeuib.ttf"))
pdfmetrics.registerFont(TTFont("Mono", "C:/Windows/Fonts/consola.ttf"))
pdfmetrics.registerFontFamily("Seg", normal="Seg", bold="SegB", italic="Seg", boldItalic="SegB")

NAVY = colors.HexColor("#16304a")
TEAL = colors.HexColor("#0f7c86")
RED = colors.HexColor("#c62828")
AMBER = colors.HexColor("#c47800")
GREEN = colors.HexColor("#2e7d32")
STATUS_C = {"CONFIRMED": GREEN, "PROVISIONAL": AMBER, "BLOCKED": RED}

ss = getSampleStyleSheet()
S = {
    "h1": ParagraphStyle("h1", parent=ss["Heading1"], fontName="SegB", fontSize=17, textColor=NAVY, spaceBefore=4,
                         spaceAfter=6),
    "h2": ParagraphStyle("h2", parent=ss["Heading2"], fontName="SegB", fontSize=12.5, textColor=TEAL, spaceBefore=8,
                         spaceAfter=4),
    "p": ParagraphStyle("p", parent=ss["BodyText"], fontName="Seg", fontSize=9.5, leading=13),
    "small": ParagraphStyle("small", fontName="Seg", fontSize=7.6, leading=9.6),
    "smallb": ParagraphStyle("smallb", fontName="SegB", fontSize=7.6, leading=9.6, textColor=colors.white),
    "mono": ParagraphStyle("mono", fontName="Mono", fontSize=8.2, leading=10.5),
    "title": ParagraphStyle("title", fontName="SegB", fontSize=30, textColor=NAVY, leading=36),
    "sub": ParagraphStyle("sub", fontName="Seg", fontSize=14, textColor=TEAL, leading=18),
    "center": ParagraphStyle("center", fontName="Seg", fontSize=8.5, alignment=TA_CENTER, textColor=colors.grey),
}


def P(t, st="p"):
    return Paragraph(t, S[st])


def box(text, col=RED, bg="#fdecea"):
    t = Table([[P(text)]], colWidths=[180 * mm], spaceBefore=6, spaceAfter=6)
    t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 1.2, col), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg)),
                           ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 6),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    return t


def table(rows, widths, head=True, font=7.6, status_col=None):
    data = [[P(str(c), "smallb" if (head and i == 0) else "small") for c in r] for i, r in enumerate(rows)]
    if status_col is not None:
        for i in range(1 if head else 0, len(rows)):
            col = STATUS_C.get(rows[i][status_col])
            if col is not None:
                data[i][status_col] = P(f"<b><font color='{col.hexval().replace('0x', '#')}'>"
                                        f"{rows[i][status_col]}</font></b>", "small")
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1 if head else 0)
    style = [("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c5ccd3")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
             ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]
    if head:
        style += [("BACKGROUND", (0, 0), (-1, 0), NAVY)]
    for i in range(1 if head else 0, len(rows)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#eef4f6")))
    t.setStyle(TableStyle(style))
    return t


def img(name, width=180):
    path = DIAG / f"{name}.png"
    from PIL import Image as PI
    w, h = PI.open(path).size
    return Image(str(path), width=width * mm, height=width * mm * h / w)


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Seg", 7.5)
    canvas.setFillColor(colors.grey)
    canvas.drawString(15 * mm, 10 * mm, "CANScope physical build manual | Rev 2.0-draft - NOT FINAL | "
                                        "schematic illustrations, not photographs | PROVISIONAL rows need their gates")
    canvas.drawRightString(195 * mm, 10 * mm, str(doc.page))
    canvas.restoreState()


def ep(led, s):
    return L.describe_ep(led, L.parse_ep(s))


def conn_rows(led, ids):
    rows = [["ID", "From", "To", "Signal", "Wire", "Status", "Gates", "Check (power off)"]]
    C = L.by_id(led)
    for i in ids:
        c = C[i]
        rows.append([c["id"], ep(led, c["from"]), ep(led, c["to"]), c["signal"],
                     "lead" if c["kind"] == "lead" else c["color"], c["status"], ", ".join(c["gates"]), c["verify"]])
    return table(rows, [12, 30, 25, 22, 12, 21, 13, 45], status_col=5)


def build():
    build_diagrams.main()
    led = L.load()
    C = L.by_id(led)
    story = []
    A = story.append

    # cover
    A(Spacer(1, 18 * mm))
    A(P("CANScope", "title"))
    A(P("Three-node ESP32 + Classical CAN bench: physical build manual", "sub"))
    A(Spacer(1, 4 * mm))
    A(P(f"<b>{led['meta']['revision']}</b> | {led['meta']['date']} | supersedes Rev 1.0 | "
        "generated from <font face='Mono'>docs/wiring/pin_ledger.json</font>"))
    A(Spacer(1, 4 * mm))
    A(img("08_can_bus_trunk", 175))
    A(Spacer(1, 3 * mm))
    A(box("<b>NOT FINAL.</b> This revision corrects Rev 1.0 and assigns every GPIO, but no board, module or wire "
          "has been physically inspected, measured or powered by its author. Every diagram is a schematic "
          "illustration, not a photograph of your parts. PROVISIONAL connections may be made only after the bench "
          "gates listed for them pass. BLOCKED connections (the buzzer transistor Q1) must stay empty. "
          "A successful compile never proves the hardware works."))
    A(PageBreak())

    # 0 how to use
    A(P("0. How to use this manual", "h1"))
    A(P("Every wire has one row in the canonical ledger (<font face='Mono'>docs/wiring/pin_ledger.json</font>). "
        "The diagrams, the video, this PDF and the sign-off checklist are generated from it, and "
        "<font face='Mono'>tools/hwdocs/validate.py</font> checks that they agree with each other and with the "
        "firmware pin settings. If anything disagrees with the ledger, the ledger wins. Report the mismatch."))
    A(table([["Status", "Meaning", "What you do"]] + [
        ["CONFIRMED", "Supported by a named document and independent of unidentified parts", "Wire it; check labels"],
        ["PROVISIONAL", "Supported by documents but depends on a detail only you can see", "Pass the listed gates first"],
        ["BLOCKED", "Required information is missing", "Leave it EMPTY; supply the evidence"]],
        [26, 90, 64], status_col=0))
    A(P("Gates G1-G14 are short bench checks. Record each result on the sign-off sheet (section 19).", "p"))
    A(P("Corrections to Rev 1.0", "h2"))
    A(P("The full register, with evidence, is in <font face='Mono'>validation/correction_register.md</font> "
        "(27 entries). The most important:"))
    for t in ["Node 3 CAN moves to GPIO17/16 (the same as Nodes 1/2 and the repo's monitor firmware). The brief's "
              "22/21 collided with the Arduino-ESP32 default I2C pins SDA 21 / SCL 22, which the OLED needs.",
              "The SN65HVD230 has no STB/EN pin. Pin 8 is Rs, which must be low for high-speed mode; high means "
              "standby (cannot transmit or ACK). Vref stays open.",
              "All Node 3 peripheral GPIOs assigned: LEDs 25/26/27, buttons 32/33, buzzer drive 13. None are "
              "strapping, flash, input-only or USB-serial pins.",
              "Buttons: diagonal-leg rule replaces the package-dependent 'pairs across the trench' advice.",
              "Buzzer: reviewed low-side NPN with values; 5 V from Node 3's own VIN (no external supply); "
              "transistor pinout BLOCKED until the part is identified.",
              "Onboard terminators: measured per module (G6) with a decision rule; exactly two on the bus.",
              "The 3V3 of different nodes is never joined; Board A rails carry GND only.",
              "Bare boards are flashed before wiring; the bring-up firmware for each node is named.",
              "Firmware gaps stated plainly: no OLED/LED/button/buzzer code, no simulation, no fault injection yet."]:
        A(P("- " + t))
    A(PageBreak())

    # 1 inventory
    A(P("1. Inventory and tools", "h1"))
    A(table([["Qty", "Item", "Status", "Notes"],
             ["3", "ESP32 DevKit V1, 30-pin, ESP-WROOM-32", "available", "G1 shield marking, G2 header order"],
             ["3", "SN65HVD230 CAN transceiver module", "available", "G4 identity, G5 Rs pin, G6 onboard terminator"],
             ["1", "SSD1306 0.96 in I2C OLED 128x64, 4-pin", "available", "G7 label order and address"],
             ["1 each", "Green, yellow, red LED", "available", "G9 polarity"],
             ["3", "220 Ohm resistor (one per LED)", "available", "G13 measure"],
             ["2", "120 Ohm resistor (bus ends)", "available", "G13; fit only per G6"],
             ["2", "Tactile push button, 4-leg", "available", "G8 diagonal legs"],
             ["1", "5 V active buzzer", "available", "G11 type, rating, polarity"],
             ["2", "830-point breadboard", "available", "G14 rails"],
             ["many", "Dupont jumper wires", "available", "Colours suggested in the ledger"],
             ["3", "USB data cable", "available", "Charge-only cables will not flash"],
             ["1", "NPN transistor, Ic >= 100 mA (e.g. PN2222A, 2N3904, BC547, S8050)", "REQUIRED EXTRA",
              "Needed so no GPIO drives the buzzer; pinout gate G10"],
             ["1", "1 kOhm resistor (Q1 base)", "REQUIRED EXTRA", "G13"],
             ["1", "10 kOhm resistor (Q1 base pull-down)", "RECOMMENDED", "Keeps the buzzer silent during boot"],
             ["1", "1N4148 diode", "CONDITIONAL", "Only if the buzzer is electromagnetic (G11)"],
             ["1", "Digital multimeter (continuity, diode, Ohm, DC V)", "REQUIRED TOOL", "Every gate uses it"]],
            [14, 70, 30, 66]))
    A(PageBreak())

    # 2 identification
    A(P("2. Identification guide", "h1"))
    A(img("01_esp32_pin_locator", 180))
    A(PageBreak())
    A(img("02_transceiver_identification", 180))
    A(Spacer(1, 3 * mm))
    A(img("03_parts_identification", 165))
    A(PageBreak())
    A(P("Bench gates", "h2"))
    A(table([["Gate", "Title", "When", "Procedure", "Pass", "Fail"]] +
            [[g, v["title"], v["when"], v["procedure"], v["pass"], v["fail"]] for g, v in led["gates"].items()],
            [10, 24, 20, 52, 38, 36]))
    A(PageBreak())

    # 3 placement
    A(P("3. Breadboard layout and node labelling", "h1"))
    A(img("04_breadboard_placement", 180))
    A(P("Label each board with tape before placing: N1 Motor ECU, N2 Battery ECU, N3 CANScope. Board A holds Nodes "
        "1 and 2; Board B holds Node 3. The column numbers are suggestions; gate G3 decides the fit."))
    A(box("Before any wire: flash each <b>bare</b> board (nothing connected but USB), one at a time. "
          "Node 1: <font face='Mono'>pio run -d firmware/node1 -e node1 -t upload</font>. "
          "Node 2: <font face='Mono'>pio run -d firmware/node2 -e legacy_sketch -t upload</font>. "
          "Node 3: <font face='Mono'>pio run -d firmware/monitor -e monitor -t upload</font>. "
          "All use CAN TX GPIO17, RX GPIO16, 500 kbit/s, which matches the ledger (checked by validate.py).",
          AMBER, "#fff6e5"))
    A(PageBreak())

    # 4 ledger
    A(P("4. Pin-by-pin wiring ledger (all connections)", "h1"))
    A(P("ESP32 positions count from the USB end of each header, as in the pin locator. 'Lead' means a component's own "
        "leg sharing a breadboard strip; no jumper. Colours are suggestions; the ID label on the wire is "
        "authoritative."))
    A(conn_rows(led, [c["id"] for c in led["connections"]]))
    A(P("Conditional rows", "h2"))
    A(table([["ID", "Applies when", "From", "To", "Status", "Gates"]] +
            [[c["id"], c["applies"], c["from"], c["to"], c["status"], ", ".join(c["gates"])]
             for c in led["conditional_connections"]], [14, 60, 32, 34, 20, 20], status_col=4))
    A(PageBreak())

    # 5-7 nodes
    for n, sec, title in ((1, 5, "Node 1 - Motor ECU wiring"), (2, 6, "Node 2 - Battery ECU wiring"),
                          (3, 7, "Node 3 - CANScope monitor wiring")):
        A(P(f"{sec}. {title}", "h1"))
        A(img(f"0{4 + n}_node{n}_wiring", 180))
        ids = [c["id"] for c in L.connections(led, n)]
        if n < 3:
            A(conn_rows(led, ids))
            if n == 2:
                A(P("Shared with Node 1: the same four pins and colours. Node-specific: Node 2 is the middle of the "
                    "bus (no terminator), and its 3V3 must never touch Node 1's 3V3."))
        else:
            A(P("Rows for Node 3 are listed by circuit in sections 8-11; power and transceiver rows below."))
            A(conn_rows(led, ["N3-01", "N3-02", "N3-03", "N3-04", "N3-05", "N3-06", "N3-07"]))
        A(PageBreak())

    A(P("8. OLED wiring and orientation", "h1"))
    A(P("Wire by the printed pin name, never by position: modules exist with GND-VCC-SCL-SDA and VCC-GND-SCL-SDA "
        "orders (gate G7). Power from the 3V3 rail only, so the module's I2C pull-ups sit at 3.3 V. SDA = GPIO21 "
        "and SCL = GPIO22 are the Arduino-ESP32 default Wire pins (pins_arduino.h). The address is usually 0x3C "
        "(back marking 0x78). It can only be confirmed by an I2C scan, and <b>no firmware for it exists yet</b>."))
    A(conn_rows(led, ["N3-10", "N3-11", "N3-12", "N3-13"]))
    A(P("9. Three LED circuits", "h1"))
    A(P("Each LED has its own 220 Ohm series resistor: GPIO -> resistor -> anode (long leg); cathode (short leg, "
        "flat rim) -> GND. Current = (3.3 V - Vf) / 220 Ohm, about 5-7 mA. Never share one resistor between LEDs."))
    A(conn_rows(led, [f"N3-{i}" for i in range(14, 23)]))
    A(P("10. Buttons: contacts and orientation", "h1"))
    A(P("On a 4-leg tactile switch the two contacts each have two legs, so <b>diagonally opposite legs are always "
        "on different contacts</b>, however the switch is turned. Seat it across the centre trench, wire GPIO to L1 "
        "and GND to the diagonal leg L3, and confirm with the meter: open when released, closed when pressed (G8). "
        "The firmware will use the internal pull-up (about 45 kOhm), so pressed = LOW. GPIO32/33 have internal "
        "pull-ups; GPIO34-39 do not and are not used."))
    A(conn_rows(led, ["N3-23", "N3-24", "N3-25", "N3-26"]))
    A(PageBreak())
    A(P("11. Reviewed transistor-driven buzzer circuit", "h1"))
    A(P("Low-side NPN switch. GPIO13 -> R_B 1 kOhm -> Q1 base (Ib about 2.6 mA); R_PD 10 kOhm base -> GND keeps Q1 "
        "off while GPIO13 floats during reset; Q1 emitter -> GND; Q1 collector -> buzzer -; buzzer + -> Node 3 VIN "
        "(USB 5 V, measured 4.4-5.25 V at gate G12). For a buzzer of 30 mA or less the forced gain is about 12, "
        "which saturates the example parts. A 1N4148 across the buzzer (band toward +) is fitted only for "
        "an electromagnetic buzzer. The GPIO never touches the buzzer. D12 (GPIO12), next to D13, is a "
        "strapping pin and stays empty."))
    A(box("<b>BLOCKED:</b> Q1's leg order differs between parts (PN2222A/2N3904/S8050 = E-B-C, BC547 = C-B-E, flat "
          "face toward you). N3-28 to N3-32 stay empty until the part number and its datasheet pinout are recorded "
          "(G10). N3-35 (VIN -> buzzer +) is installed last, power off, after G10, G11 and G12."))
    A(conn_rows(led, [f"N3-{i}" for i in range(27, 36)]))
    A(PageBreak())

    A(P("12. Physical CANH/CANL trunk", "h1"))
    A(img("08_can_bus_trunk", 180))
    A(conn_rows(led, ["B-01", "B-02", "B-03", "B-04", "B-05", "B-06"]))
    A(P("One linear bus: end A - Node 1 - Node 2 - Node 3 - end B. Each node taps the line directly at its "
        "transceiver pins; there are no Y branches. Twist each CANH/CANL pair and keep the board-to-board segment "
        "short. The GND wire runs beside the pair so all nodes share one reference."))
    A(P("13. Termination: exactly two, at the physical ends", "h1"))
    A(table([["G6 reading per bare module", "Action"],
             ["All three > 10 kOhm (no onboard terminator)", "Fit RT1 at TRX1 (N1-05/06) and RT2 at TRX3 (N3-08/09)"],
             ["TRX1 or TRX3 reads about 120 Ohm", "Omit that end's external resistor (the onboard one is the end "
                                                  "terminator)"],
             ["TRX2 reads about 120 Ohm", "BLOCKED (row C-T2): its onboard resistor must be removed; send a photo "
                                         "first"]], [80, 100]))
    A(conn_rows(led, ["N1-05", "N1-06", "N3-08", "N3-09"]))
    A(PageBreak())
    A(P("14. Ground and power domains", "h1"))
    A(img("09_power_ground_domains", 180))
    A(PageBreak())

    A(P("15. Unpowered continuity and resistance checks", "h1"))
    A(box("All three USB cables unplugged for every check in this section. The PC's USB ground joins the nodes "
          "and would falsify readings. Meter leads: black in COM, red in V/Ohm. Never use the current jack."))
    A(table([["Check", "Probe points", "Pass", "If not"],
             ["Ledger walk-through", "Each row of section 19, both ends", "Every PROVISIONAL row's gates recorded; "
                                                                           "BLOCKED rows empty", "Fix with power off"],
             ["Supply shorts", "3V3 to GND on each node; Node 3 VIN to GND", "No steady near-0 Ohm (may drift up as "
                                                                               "capacitors charge)", "Find the short"],
             ["3V3 isolation", "Node 1 3V3 to Node 2 3V3; any VIN to any 3V3", "Not near 0 Ohm",
              "A rail or jumper joins them: remove"],
             ["CANH continuity", "TRX1 CANH - TRX2 CANH - TRX3 CANH", "About 0 Ohm", "Broken trunk"],
             ["CANL continuity", "TRX1 CANL - TRX2 CANL - TRX3 CANL", "About 0 Ohm", "Broken trunk"],
             ["Polarity / isolation", "CANH or CANL to GND, 3V3, VIN, any ESP32 pin", "No continuity",
              "Mis-wire: fix before power"],
             ["Termination", "CANH to CANL anywhere", "About 60 Ohm (57-63)", "120: one missing; 40: three; "
                                                                             "open: broken; 0: short"],
             ["Ground", "GND of Node 1, 2, 3 to each other", "About 0 Ohm", "B-03 / B-06 missing"],
             ["Buzzer isolation", "D13 to BZ1 + and -", "No continuity (only via Q1)", "Remove the direct path"],
             ["Strapping pin", "D12 (GPIO12)", "Nothing inserted", "Remove"]], [30, 55, 50, 45]))
    A(P("16. First power-up sequence", "h1"))
    for t in ["The bus stays isolated from any vehicle or external network.",
              "Plug in Node 1 only. Serial monitor at 115200 baud: banner lines start with '#'; expect "
              "'# CAN init: OK - controller running'. Measure TRX1 3V3-GND: 3.0-3.6 V. Watch for heat, smell, "
              "resets. Unplug.",
              "Repeat for Node 2 (it will report transmit errors alone: no node is powered to ACK; expected).",
              "Repeat for Node 3, and also measure VIN-GND (gate G12, 4.4-5.25 V). Unplug.",
              "Unpowered SN65HVD230 nodes do not disturb the bus (TI SLOS346O section 10.3), so the trunk stays wired.",
              "N3-35 (buzzer supply) is NOT installed while Q1 is BLOCKED. When unblocked, install it with all power "
              "off, after G10, G11 and G12.",
              "Never change a wire while any USB cable is plugged in. Unplug at once on heat, smell or repeated "
              "resets."]:
        A(P("- " + t))
    A(PageBreak())
    A(P("17. One-, two- and three-node bring-up", "h1"))
    A(table([["Stage", "Powered", "Evidence that counts", "Not evidence"],
             ["1 node", "One at a time", "Banner shows the expected pins (GPIO17/16), 500 kbit/s, CAN init OK; "
                                         "TRX 3V3 in range", "Upload succeeded"],
             ["2 nodes", "Node 1 + Node 2", "Node 1 prints JSON lines with \"type\":\"frame\" and canId 0x201, 0x202, "
                                           "0x203 (~1 s) and 0x210 (~0.5 s); error counters stay low; no "
                                           "'# ALERT: BUS-OFF'", "Node 2 printing 'Sent CAN ID' (only queued)"],
             ["3 nodes", "all three", "Node 3 (monitor, listen-only) prints the same IDs; terminators unchanged",
              "OLED/LED/button activity (no firmware yet)"]], [18, 26, 90, 46]))
    A(P("The legacy test IDs carry fixed, unverified values (0x201 = 480, 0x202 = 120, 0x203 = 85, 0x210 = 1). "
        "They prove frames move; they are not motor or battery signals. Record the actual output in TASK.md and "
        "captures/."))
    A(P("Firmware support today", "h2"))
    for t in led["firmware_gaps"]:
        A(P("- " + t))
    A(P("18. Common wiring mistakes and troubleshooting", "h1"))
    A(table([["Symptom", "Likely cause", "Safe response (power off first)"],
             ["No frames at Node 1", "TX/RX swapped (CTX must get TX2); Rs high (standby); CANH/CANL swapped at one "
                                     "node; missing GND; wrong firmware", "Check N1-03/04, N2-03/04, G5, polarity"],
             ["Node 2 errors persist with Node 1 powered", "Node 1 not ACKing: Rs standby, RX/TX mis-wired, "
                                                          "bit rate mismatch", "Compare banners; continuity"],
             ["Bus reads ~40 Ohm", "Third terminator (onboard)", "Repeat G6 per module"],
             ["Bus reads ~120 Ohm", "One terminator missing", "Check RT1/RT2 or onboard parts"],
             ["Board will not boot", "Something on D12 (strapping) or a short", "Remove D12 wire; check rails"],
             ["Button always pressed", "Legs on the same contact", "Use diagonal legs, re-check G8"],
             ["LED never lights", "Reversed LED, or no firmware drives it yet", "Diode test; note firmware gap"],
             ["OLED blank", "No firmware yet; or VCC/GND swapped by position", "Re-read labels (G7)"],
             ["Hot part / smell", "Short, reversed supply, 5 V on 3V3", "Unplug everything; inspect before reuse"]],
            [38, 76, 66]))
    A(PageBreak())
    A(P("19. Final wire-by-wire sign-off", "h1"))
    A(P("Fill in on paper with all power off. A BLOCKED row must be physically empty. The electronic version, with "
        "coverage columns, is <font face='Mono'>validation/wire_coverage_checklist.md</font>."))
    rows = [["ID", "From -> To", "Status", "Gates passed", "Ends + meter", "Init."]]
    for c in led["connections"]:
        rows.append([c["id"], f"{ep(led, c['from'])} -> {ep(led, c['to'])}", c["status"],
                     "n/a" if c["status"] == "BLOCKED" else "[  ]", "[ ] empty" if c["status"] == "BLOCKED" else "[  ]",
                     ""])
    A(table(rows, [13, 95, 20, 20, 20, 12], status_col=2))
    A(Spacer(1, 4 * mm))
    A(table([["Record", "Value"],
             ["ESP32 shield marking N1 / N2 / N3 (G1)", ""], ["Transceiver IC marking and labels N1 / N2 / N3 (G4)", ""],
             ["Rs state per module (G5)", ""], ["Onboard CANH-CANL reading per module (G6)", ""],
             ["OLED label order and address (G7)", ""], ["Transistor part number and E-B-C (G10)", ""],
             ["Buzzer type / rating / current (G11)", ""], ["Node 3 VIN voltage (G12)", ""],
             ["Bus CANH-CANL resistance, unpowered", ""], ["Two-node result (IDs seen at Node 1)", ""],
             ["Three-node result (IDs seen at Node 3)", ""], ["Photos saved at", ""], ["Checked by / date", ""]],
            [90, 90]))
    A(P("Evidence references", "h2"))
    for k, v in led["evidence"].items():
        A(P(f"<b>{k}</b>: {v}", "small"))

    doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=14 * mm,
                            bottomMargin=16 * mm, title="CANScope Physical Build Manual Rev 2.0-draft",
                            author="CANScope project (generated)")
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print("wrote", OUT)


if __name__ == "__main__":
    build()
