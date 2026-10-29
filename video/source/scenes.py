"""Storyboard for the CANScope physical build video.

Every wiring step is generated from docs/wiring/pin_ledger.json, so the video,
the manual and the diagrams cannot disagree about a pin. Hand-written text is
limited to explanations, gates and test procedures.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools" / "hwdocs"))
import ledger as L  # noqa: E402

ORD = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
       "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth"]
COLOR_WORD = {"component": "No jumper: this is a component lead"}
OFF = "ALL POWER OFF - every USB cable unplugged"


def ep_words(led, text):
    ep = L.parse_ep(text)
    comps = led["components"]
    if comps.get(ep.comp, {}).get("kind") == "esp32":
        p = L.esp_pin(led, ep.pin)
        g = f", GPIO {p['gpio']}" if p["gpio"] is not None else ""
        return (f"{ep.comp} pin {p['silk']}{g}: the {ORD[p['pos']]} pin from the USB end on the "
                f"{p['side'].replace('-side', '')} side header")
    if ep.comp == "RAIL3":
        return {"3V3+": "the bottom plus rail of breadboard B, which is 3V3 for Node 3",
                "GND-": "the bottom minus rail of breadboard B, which is ground",
                "GNDtop": "the top minus rail of breadboard B, which is ground"}[ep.pin]
    name = comps[ep.comp]["name"]
    pin = {"A": "anode", "K": "cathode", "+": "plus", "-": "minus", "B": "base", "C": "collector",
           "E": "emitter"}.get(ep.pin, ep.pin)
    if comps[ep.comp]["kind"] == "transceiver":
        return f"the {ep.comp} pin printed {ep.pin}"
    if comps[ep.comp]["kind"] == "oled":
        return f"the OLED pin printed {ep.pin}"
    if comps[ep.comp]["kind"] == "resistor":
        return f"{ep.comp}, the {name}, end {ep.pin}"
    return f"{ep.comp} {pin}"


def wire_narration(led, conn):
    gates = conn["gates"]
    gtxt = ", ".join(gates[:-1]) + (" and " if len(gates) > 1 else "") + gates[-1] if gates else ""
    s = [f"Connection {conn['id']}."]
    if conn["kind"] == "lead":
        s.append("This is a component lead, not a jumper wire.")
    else:
        s.append(f"Take a {conn['color']} jumper.")
    s.append(f"One end goes to {ep_words(led, conn['from'])}.")
    s.append(f"The other end goes to {ep_words(led, conn['to'])}.")
    s.append(f"Signal: {conn['signal']}.")
    if conn["status"] == "BLOCKED":
        s.append(f"Status: BLOCKED. Do not make this connection. Gate {gtxt} must be resolved and the ledger "
                 "updated first.")
    elif conn["status"] == "PROVISIONAL":
        s.append(f"Status: provisional. Make it only after gate{'s' if len(gates) > 1 else ''} {gtxt} "
                 "have passed and you have recorded the results.")
    else:
        s.append("Status: confirmed by documents.")
    s.append(f"Check: {conn['verify']}")
    return s


def wire_step(led, conn, scene, title, visual, power=OFF, extra=None):
    nar = wire_narration(led, conn) + (extra or [])
    return {"scene": scene, "title": title, "visual": visual, "panel": {"type": "wire", "conn": conn["id"]},
            "narration": nar, "power": power}


def card(scene, title, heading, lines, narration, power=OFF, tone="info"):
    return {"scene": scene, "title": title, "visual": {"type": "card", "heading": heading, "lines": lines,
                                                         "tone": tone},
            "panel": None, "narration": narration, "power": power}


def sheet(scene, title, name, panel, narration, power=OFF):
    return {"scene": scene, "title": title, "visual": {"type": "sheet", "name": name}, "panel": panel,
            "narration": narration, "power": power}


def gates_panel(*g):
    return {"type": "gates", "gates": list(g)}


def bullets(title, items, tone="info"):
    return {"type": "bullets", "title": title, "items": items, "tone": tone}


SCENES = {
    1: "Introduction and safety",
    2: "Identify the hardware",
    3: "Assemble Node 1 - Motor ECU",
    4: "Assemble Node 2 - Battery ECU",
    5: "Assemble Node 3 - CANScope monitor",
    6: "Build the CAN bus",
    7: "Inspect before powering",
    8: "First power-up",
    9: "Three-node bring-up",
    10: "Final inspection and handover",
}


def build(led=None):
    led = led or L.load()
    C = L.by_id(led)
    steps = []
    add = steps.append

    # ------------------------------------------------------------------ scene 1
    add(card(1, "Title", "CANScope: building the three-node CAN bench",
             [("Two breadboards, three ESP32 nodes, one CAN bus", "info"),
              ("Every picture is a SCHEMATIC ILLUSTRATION drawn from the pin ledger", "warn"),
              ("It is not a photograph of your modules", "warn"),
              (f"Wiring contract {led['meta']['revision']} - not final: see the blocked items", "stop")],
             ["This video shows how to build the three CANScope nodes, one connection at a time.",
              "Every picture is a schematic illustration generated from the project's pin ledger.",
              "It is not a photograph of your modules, so always read the labels printed on your own parts.",
              "Pause the video whenever you need to. Each step stays on screen until its narration ends."]))
    add({"scene": 1, "title": "Architecture", "visual": {"type": "bus", "all": False, "done": []},
         "panel": bullets("Three nodes, one bus", [
             "Node 1: Motor ECU simulator (ESP1 + TRX1)",
             "Node 2: Battery ECU simulator (ESP2 + TRX2)",
             "Node 3: CANScope monitor (ESP3 + TRX3, OLED, status LEDs)",
             "One straight bus: end A - Node 1 - Node 2 - Node 3 - end B",
             "120 Ohm terminator at each physical end only"]),
         "narration": [
             "Node one is the motor ECU simulator. Node two is the battery ECU simulator.",
             "Node three is the CANScope monitor, with an OLED display and status LEDs.",
             "Each ESP32 talks to the bus through its own SN65HVD230 transceiver.",
             "The bus is one straight line: end A, Node one, Node two, Node three, end B.",
             "There is a 120 ohm terminator at each physical end, and nowhere else."], "power": OFF})
    add(card(1, "What is and is not verified", "Honest status before you start",
             [("Nothing here has been physically inspected or measured by Claude", "stop"),
              ("PROVISIONAL wires: allowed only after their bench gates pass", "warn"),
              ("Firmware today: CAN bring-up only. No OLED or LED code yet", "warn"),
              ("No motor/battery simulation or fault injection in firmware yet", "warn"),
              ("A successful compile never proves the hardware works", "info")],
             ["Here is the honest status.",
              "No board, module or wire in this video has been physically inspected or measured.",
              "Most connections are provisional. You may make a provisional connection only after the bench "
              "checks, called gates, listed for it have passed.",
              "The current firmware only brings up CAN. It does not drive the OLED or LEDs, and it "
              "does not simulate the motor or battery or inject faults yet.",
              "So this video builds and checks the hardware. It does not claim the peripherals work."],
             tone="warn"))
    add(card(1, "Inventory", "Inventory and tools",
             [("3 x ESP32 DevKit V1 30-pin (ESP-WROOM-32)  |  3 x SN65HVD230 module", "info"),
              ("1 x SSD1306 0.96 in I2C OLED, 4-pin  |  1 each green, yellow, red LED", "info"),
              ("3 x 220 Ohm (LEDs)  |  2 x 120 Ohm (bus ends)", "info"),
              ("2 x 830-point breadboard  |  Dupont jumpers", "info"),
              ("3 x USB DATA cable (charge-only cables will not work)", "info"),
              ("REQUIRED TOOL: digital multimeter with continuity and diode test", "stop")],
             ["Here is the inventory. Three ESP32 DevKit V1 thirty-pin boards and three SN65HVD230 transceiver "
              "modules.",
              "One SSD1306 I2C OLED, three LEDs, three 220 ohm resistors and two 120 ohm resistors.",
              "Two breadboards, jumper wires and three USB data cables.",
              "You also need a digital multimeter. Every gate in this video uses it."]))
    add(card(1, "Safety", "Safety rules - read before touching a wire",
             [("All USB cables unplugged while wiring, measuring resistance or changing anything", "stop"),
              ("No external 5 V supply is used anywhere in this build", "stop"),
              ("Never connect CANH or CANL to an ESP32 pin", "stop"),
              ("Never put 5 V on a 3V3 pin or rail. Never join 3V3 of two nodes", "stop"),
              ("Bench only: never connect this bus to a vehicle or a real network", "stop"),
              ("A BLOCKED step means STOP. Do not guess", "stop")],
             ["Safety rules. Unplug every USB cable before you wire, measure resistance, or change anything.",
              "There is no external five volt supply in this build.",
              "Never connect CAN high or CAN low to an ESP32 pin. Only the transceiver touches the bus.",
              "Never put five volts on a three volt three pin, and never join the three volt three pins of two "
              "different nodes.",
              "This is a bench simulator. Never connect it to a vehicle or to a real network.",
              "If a step is marked blocked, stop. Do not guess."], tone="stop"))
    add(card(1, "Status legend and gates", "How to read every wiring step",
             [("CONFIRMED - supported by a named document; still check the printed labels", "ok"),
              ("PROVISIONAL - wire it only after the listed gates (G1..G14) pass", "warn"),
              ("BLOCKED - dashed red line: do NOT wire; information is missing", "stop"),
              ("Each step shows: wire ID, FROM pin, TO pin, signal, colour, status, check", "info"),
              ("Record every gate result and every check on the sign-off sheet", "info")],
             ["Every wiring step shows a wire number, where it starts, where it ends, the signal and the status.",
              "Confirmed means a named document supports it. You still read the printed labels.",
              "Provisional means you must first pass the listed gates. Gates are short bench checks, numbered G1 "
              "to G14.",
              "Blocked, shown as a dashed red line, means do not wire it.",
              "Write every gate result on the sign-off sheet in the manual."]))
    add(card(1, "Flash before wiring", "Before any wire: flash each BARE board",
             [("Boards may arrive with unknown firmware that drives random pins", "warn"),
              ("ESP1 (Node 1): pio run -d firmware/node1 -e node1 -t upload", "info"),
              ("ESP2 (Node 2): pio run -d firmware/node2 -e legacy_sketch -t upload", "info"),
              ("ESP3 (Node 3): pio run -d firmware/monitor -e monitor -t upload", "info"),
              ("Nothing connected except USB. One board at a time. Label each board", "stop"),
              ("All three use CAN TX = GPIO17, RX = GPIO16, 500 kbit/s (matches the ledger)", "ok")],
             ["Before any wire, flash each bare board, with nothing connected except its USB cable.",
              "A new board may already run unknown firmware that drives random pins, which could fight the "
              "transceiver later.",
              "Node one gets the node1 firmware. It listens in normal mode and acknowledges frames, but does not "
              "transmit.",
              "Node two gets the legacy test sketch. It is the only firmware that transmits, sending fixed test "
              "frames.",
              "Node three gets the monitor firmware, which is listen-only.",
              "All three use GPIO seventeen for CAN transmit and GPIO sixteen for receive, at 500 kilobits per "
              "second, matching the ledger.",
              "Unplug the board, then label it Node one, two or three."],
             power="One bare board on USB at a time, nothing else connected"))

    # ------------------------------------------------------------------ scene 2
    add(sheet(2, "ESP32 pin locator", "01_esp32_pin_locator", gates_panel("G1", "G2"),
              ["Hold each ESP32 with the components up and the USB connector pointing left.",
               "Gate G1: read the marking on the metal shield. It must say ESP-WROOM-32, not WROVER. On a "
               "WROVER, GPIO sixteen and seventeen are used by memory and cannot be CAN pins.",
               "Gate G2: read all thirty pin labels. Pin one of each header is the pin next to the USB connector.",
               "The top row in these diagrams is the VIN side. The bottom row is the 3V3 side.",
               "If your labels are in a different order, stop and send a photo. Do not count pins from the "
               "drawing.",
               "Pins shaded dark red are flash, strapping or USB serial pins. CANScope never uses them."]))
    add(sheet(2, "Transceiver identity", "02_transceiver_identification", gates_panel("G4", "G5"),
              ["This is the SN65HVD230 transceiver, marked VP230 on the chip.",
               "Gate G4: check the chip marking, and check that the module's supply pin is labelled 3V3 or VCC "
               "with no five volt marking. The chip runs from three point zero to three point six volts.",
               "CTX, also called TXD or D, is the transmit input. It connects to the ESP32 transmit pin. This "
               "is not crossed like a UART.",
               "CRX, also called RXD or R, is the receive output. It connects to the ESP32 receive pin.",
               "Gate G5 checks the Rs mode pin. It must be pulled to ground for high-speed mode. If it is "
               "high, the chip is in standby and cannot transmit or acknowledge.",
               "If your module exposes a pin labelled RS, S or STB, wire it to ground. Leave Vref unconnected."]))
    add(sheet(2, "Onboard termination", "02_transceiver_identification", gates_panel("G6"),
              ["Gate G6: many of these modules already have a 120 ohm resistor between CAN high and CAN low.",
               "With the module unpowered and connected to nothing, measure CAN high to CAN low.",
               "Above ten kilo-ohms means no onboard terminator. About 120 ohms means there is one.",
               "If the Node one or Node three module has one, leave out that end's external resistor.",
               "If the Node two module has one, stop. That resistor must be removed, so send a photo first.",
               "The aim is exactly two terminators on the whole bus."]))
    add(sheet(2, "OLED and LEDs", "03_parts_identification", gates_panel("G7", "G9"),
              ["Gate G7: read the four OLED labels. G N D, V C C, S C L, S D A is common, but some modules swap "
               "ground and V C C. Always connect by the printed name.",
               "The OLED is powered from three volt three only, so its pull-ups keep the data lines at three "
               "volt three.",
               "Gate G9: the LED's long leg is the anode. The short leg, next to the flat edge, is the cathode. "
               "Confirm with the meter's diode test."]))
    add(sheet(2, "Resistors", "03_parts_identification", gates_panel("G13"),
              ["Gate G13: measure every resistor before you insert it. Colour bands are easy to misread."]))
    add(card(2, "Unresolved items", "Resolve or record these before wiring",
             [("Photo of each ESP32 shield marking and both headers (G1, G2)", "warn"),
              ("Photo of each transceiver, front and back, with labels (G4, G5)", "warn"),
              ("Onboard terminator reading of each transceiver (G6)", "warn"),
              ("OLED label order and address (G7)", "warn")],
             ["Before wiring, record or photograph these items.",
              "The ESP32 shield marking and headers, both sides of each transceiver, the onboard terminator "
              "reading and the OLED labels."], tone="warn"))

    # ------------------------------------------------------------------ scenes 3 and 4
    for node, scene in ((1, 3), (2, 4)):
        name = "Motor ECU" if node == 1 else "Battery ECU"
        cols = "1 to 15" if node == 1 else "32 to 46"
        trx = "18 to 24" if node == 1 else "49 to 55"
        intro = [f"Node {node} goes on breadboard A. Seat ESP{node} across the centre trench in columns {cols}.",
                 "Gate G3: every pin must still have at least one free hole beside it on both sides. If not, "
                 "do not force it.",
                 f"Place TRX{node} in the lower half, around columns {trx}.",
                 "Everything stays unplugged."]
        if node == 2:
            intro.insert(0, "Node two repeats Node one exactly: the same four pins and the same colours.")
            intro.append("What is different: Node two is in the middle of the bus, so it has no terminator, "
                         "and its 3V3 must never touch Node one's 3V3.")
        add(sheet(scene, f"Place ESP{node} and TRX{node}", "04_breadboard_placement", gates_panel("G3", "G14"),
                  intro))
        add({"scene": scene, "title": f"Node {node} pin plan",
             "visual": {"type": "node", "node": node, "done": [], "current": None},
             "panel": bullets(f"Node {node} uses four ESP32 pins", [
                 "3V3-side pin 1: 3V3 -> TRX 3V3 (red)",
                 "3V3-side pin 2: GND -> TRX GND (black)",
                 "3V3-side pin 6: RX2 = GPIO16 <- TRX CRX (brown)",
                 "3V3-side pin 7: TX2 = GPIO17 -> TRX CTX (white)",
                 "Every other pin stays empty"]),
             "narration": [f"Node {node} uses only four ESP32 pins, all on the 3V3-side header.",
                           "Three volt three, ground, RX2 which is GPIO sixteen, and TX2 which is GPIO seventeen.",
                           "Every other pin stays empty."], "power": OFF})
        done = []
        for conn in L.connections(led, node):
            if conn["stage"] != f"node{node}":
                continue
            add(wire_step(led, conn, scene, conn["id"],
                          {"type": "node", "node": node, "done": list(done), "current": conn["id"]}))
            done.append(conn["id"])
        add({"scene": scene, "title": f"Node {node} complete",
             "visual": {"type": "node", "node": node, "done": list(done), "current": None},
             "panel": bullets("Check before moving on (power off)", [
                 f"{c}: {C[c]['verify']}" for c in done], "warn"),
             "narration": [f"Node {node} is wired. Compare your board with this diagram, wire by wire.",
                           "With the meter in continuity mode, check each wire end to end, and check that transmit "
                           "and receive are not swapped.",
                           "The terminator and bus wires come later, in the bus scene."], "power": OFF})

    # ------------------------------------------------------------------ scene 5
    s = 5
    add(sheet(s, "Place Node 3", "04_breadboard_placement", gates_panel("G3", "G14"),
              ["Node three has breadboard B to itself. Seat ESP3 in columns one to fifteen.",
               "Put TRX3 and the OLED in the lower half and the LEDs in the upper half.",
               "Gate G14: check each rail with the meter from end to end. Some breadboards split their rails in "
               "the middle.",
               "On breadboard B, the bottom plus rail is 3V3 for Node three only. Both minus rails are ground."]))
    done3: list[str] = []

    def n3(cid, title=None, extra=None):
        conn = C[cid]
        add(wire_step(led, conn, s, title or cid,
                      {"type": "node", "node": 3, "done": list(done3), "current": cid}, extra=extra))
        done3.append(cid)

    for cid in ("N3-01", "N3-02", "N3-03"):
        n3(cid)
    for cid in ("N3-04", "N3-05", "N3-06", "N3-07"):
        n3(cid)
    add({"scene": s, "title": "OLED", "visual": {"type": "node", "node": 3, "done": list(done3), "current": None},
         "panel": gates_panel("G7"),
         "narration": ["Now the OLED. Its pins are wired by printed name, not by position.",
                       "SDA goes to GPIO twenty-one and SCL to GPIO twenty-two. These are the standard I2C pins in "
                       "the Arduino ESP32 core.",
                       "That is also why Node three does not use twenty-one and twenty-two for CAN."], "power": OFF})
    for cid in ("N3-10", "N3-11", "N3-12", "N3-13"):
        n3(cid)
    add({"scene": s, "title": "LED circuits", "visual": {"type": "node", "node": 3, "done": list(done3),
                                                         "current": None},
         "panel": bullets("Three separate LED circuits", [
             "GPIO -> its own 220 Ohm -> LED anode; cathode -> GND",
             "Yellow GPIO26, red GPIO27; green: no verified pin (N3-14 BLOCKED)",
             "Current about (3.3 - 2.0) / 220 = 6 mA each",
             "Never share one resistor between LEDs"]),
         "narration": ["Each LED gets its own 220 ohm resistor. Never share one resistor between LEDs.",
                       "The GPIO drives the resistor, the resistor feeds the anode, and the cathode goes to ground.",
                       "The current is about six milliamps, well within the pin's limit."], "power": OFF})
    for cid in ("N3-14", "N3-15", "N3-16", "N3-17", "N3-18", "N3-19", "N3-20", "N3-21", "N3-22"):
        n3(cid)
    add({"scene": s, "title": "Node 3 complete",
         "visual": {"type": "node", "node": 3, "done": list(done3), "current": None},
         "panel": bullets("State of Node 3", [
             "All PROVISIONAL wires placed (after their gates)",
             "Dashed red: N3-14 (green LED) NOT wired (BLOCKED, no verified pin)",
             "No buttons and no buzzer on this build",
             "Terminator RT2 comes in the bus scene"], "warn"),
         "narration": ["Node three is wired, except for the green LED, whose pin is not verified.",
                       "This build has no buttons and no buzzer."], "power": OFF})

    # ------------------------------------------------------------------ scene 6
    s = 6
    add({"scene": s, "title": "Bus topology", "visual": {"type": "bus", "all": False, "done": []},
         "panel": bullets("Why a line, not a star", [
             "CAN is a transmission line: reflections from branches corrupt bits",
             "Terminators absorb the signal at the two ends only",
             "Keep each node's tap short; twist CANH with CANL",
             "Ground wire runs beside the pair: one common reference"]),
         "narration": ["The bus is one straight line: end A at Node one, through Node two, to end B at Node three.",
                       "A star or Y-shaped branch makes reflections that corrupt bits, so every node sits directly on "
                       "the line with a short tap.",
                       "The two terminators absorb the signal at the ends. Twist each CAN high and CAN low pair "
                       "together, and run the ground wire beside it."], "power": OFF})
    add({"scene": s, "title": "Terminator decision", "visual": {"type": "bus", "all": False, "done": []},
         "panel": gates_panel("G6", "G13"),
         "narration": ["Use your gate G6 readings now.",
                       "If no module has an onboard terminator, fit RT1 at Node one and RT2 at Node three, exactly "
                       "as shown.",
                       "If the Node one or Node three module already has one, leave out that external resistor.",
                       "If the Node two module has one, stop until it is removed."], "power": OFF})
    busdone: list[str] = []
    for cid in ("N1-05", "N1-06", "B-01", "B-02", "B-03", "B-04", "B-05", "B-06", "N3-08", "N3-09"):
        conn = C[cid]
        extra = []
        if cid in ("B-04", "B-05"):
            extra = ["This wire crosses from breadboard A to breadboard B. Keep it short and twisted with its "
                     "partner."]
        add(wire_step(led, conn, s, cid, {"type": "bus", "all": False, "done": list(busdone), "current": cid},
                      extra=extra))
        busdone.append(cid)
    add({"scene": s, "title": "Bus complete", "visual": {"type": "bus", "all": True, "done": busdone},
         "panel": bullets("The finished bus", [
             "Two terminators: RT1 at end A (Node 1), RT2 at end B (Node 3)",
             "None at Node 2",
             "CANH always meets CANH; CANL always meets CANL",
             "Common GND: B-03 and B-06"]),
         "narration": ["The bus is complete. There are two terminators, one at each physical end, and none at Node "
                       "two.",
                       "CAN high only ever meets CAN high, and CAN low only ever meets CAN low."], "power": OFF})

    # ------------------------------------------------------------------ scene 7
    s = 7
    add(card(s, "Ledger walk-through", "Check every wire against the ledger",
             [("Open validation/wire_coverage_checklist.md (or manual section 19)", "info"),
              ("For each row: both ends in the right hole, colour, status, gate recorded", "info"),
              ("Tick only what you have checked with your own eyes and meter", "warn"),
              ("BLOCKED rows must be EMPTY on the breadboard", "stop")],
             ["With everything unplugged, check every wire against the ledger checklist, both ends, one row at a "
              "time.",
              "Tick a row only after you have looked at it and tested it with the meter.",
              "Every blocked row must be empty on the breadboard."]))
    add({"scene": s, "title": "Rail short check", "visual": {"type": "measure", "kind": "rails"},
         "panel": bullets("Supply short check (power off)", [
             "Meter on resistance. Black probe on GND",
             "Red on 3V3 of Node 1, Node 2, Node 3 (B+ rail)",
             "Red on VIN of Node 3",
             "PASS: not near 0 Ohm (reading may drift up as capacitors charge)",
             "FAIL: about 0 Ohm -> find the short before any USB"], "stop"),
         "narration": ["Check the supplies for shorts, with all power removed.",
                       "Measure from three volt three to ground on each node, and from Node three's VIN to ground.",
                       "The reading may start low and climb as capacitors charge. That is normal.",
                       "A steady reading near zero ohms is a short. Find it before any cable is plugged in."],
         "power": OFF})
    add({"scene": s, "title": "CAN continuity and polarity", "visual": {"type": "measure", "kind": "canpol"},
         "panel": bullets("CANH / CANL continuity (power off)", [
             "TRX1 CANH to TRX2 CANH to TRX3 CANH: about 0 Ohm",
             "TRX1 CANL to TRX2 CANL to TRX3 CANL: about 0 Ohm",
             "CANH or CANL to any GND, 3V3 or VIN: NOT near 0",
             "CANH or CANL to any ESP32 pin: no direct connection"], "warn"),
         "narration": ["Check CAN high from Node one to Node two to Node three. It should read almost zero ohms.",
                       "Do the same for CAN low.",
                       "Then check that neither line connects to ground, a supply, or any ESP32 pin."], "power": OFF})
    add({"scene": s, "title": "Termination resistance", "visual": {"type": "measure", "kind": "term"},
         "panel": bullets("CANH to CANL, whole bus, power off", [
             "About 60 Ohm: two 120 Ohm in parallel - PASS",
             "About 120 Ohm: one terminator missing",
             "About 40 Ohm: a third terminator (onboard?)",
             "Open: broken pair or no terminators",
             "Near 0: short - do not power"], "warn"),
         "narration": ["Now measure CAN high to CAN low anywhere on the bus.",
                       "Two 120 ohm resistors in parallel give 120 times 120 divided by 240, which is 60 ohms.",
                       "About 120 means one terminator is missing. About 40 means there is a third, probably an "
                       "onboard one.",
                       "Record the value. Do not add resistors to fix a reading until you know why it is wrong."],
         "power": OFF})
    add({"scene": s, "title": "5 V checks", "visual": {"type": "node", "node": 3, "done": list(done3),
                                                       "current": None},
         "panel": bullets("Final safety checks", [
             "VIN has no wire at all (nothing uses 5 V)",
             "VIN has no wire to any 3V3 pin or rail",
             "Node 1 3V3 and Node 2 3V3: no continuity to each other",
             "D12 (strapping) and all unused pins empty"], "stop"),
         "narration": ["Last checks. Nothing is wired to VIN, and VIN must have no wire to any three volt three "
                       "point.",
                       "And the three volt three pins of Node one and Node two must not be connected to each "
                       "other."], "power": OFF})

    # ------------------------------------------------------------------ scene 8
    s = 8
    add(card(s, "Power-up rules", "First power-up: one node at a time",
             [("The bus stays isolated: no vehicle, no external network", "stop"),
              ("Plug in ONE USB cable. The other two stay unplugged", "warn"),
              ("Unpowered SN65HVD230 nodes do not disturb the bus (TI SLOS346O 10.3)", "info"),
              ("Watch for heat, smell, repeated resets. Any of these: unplug at once", "stop"),
              ("Never change a wire while any USB is plugged in", "stop")],
             ["Power up one node at a time. The bus stays isolated from any vehicle or network.",
              "The other two nodes stay unplugged. TI's datasheet says an unpowered SN65HVD230 does not disturb "
              "the bus, so the bus wires can stay in place.",
              "Watch and feel for heat, smell or repeated resets. If you notice any, unplug at once.",
              "Never change a wire while a cable is plugged in."], tone="warn"))
    for node in (1, 2, 3):
        fw = {1: "node1 (normal mode, ACKs, TX disabled)", 2: "legacy_sketch (transmits 0x201/0x202/0x203/0x210)",
              3: "monitor (listen-only)"}[node]
        items = [f"Plug in Node {node} USB only",
                 "Serial monitor 115200 baud: banner lines start with #",
                 "Expect '# CAN init: OK - controller running'",
                 f"Firmware: {fw}",
                 f"Measure TRX{node} 3V3 to GND: 3.0 - 3.6 V",
                 "Unplug before the next node"]
        nar = [f"Plug in Node {node} only, and open a serial monitor at 115200 baud.",
               "The banner lines start with a hash sign. Look for CAN init OK, controller running.",
               f"Measure the transceiver supply. It must be between three point zero and three point six volts."]
        if node == 2:
            nar.append("Node two alone will report transmit errors, because no other node is powered to "
                       "acknowledge its frames. That is expected at this stage.")
        nar.append("Then unplug it.")
        add({"scene": s, "title": f"Node {node} alone", "visual": {"type": "measure", "kind": f"power{node}"},
             "panel": bullets(f"Node {node} single power-up", items, "warn"), "narration": nar,
             "power": f"Node {node} USB ONLY"})

    # ------------------------------------------------------------------ scene 9
    s = 9
    add(card(s, "Compile is not communication", "What counts as evidence",
             [("Compiles / uploads OK: proves only that the code built", "warn"),
              ("'Sent CAN ID 0x201' on Node 2: frame QUEUED, not proven delivered", "warn"),
              ("Node 1 or Node 3 printing a frame line with canId 0x201: real bus traffic", "ok"),
              ("txErrorCount / rxErrorCount stay low, no '# ALERT: BUS-OFF'", "ok")],
             ["A successful compile only proves the code built.",
              "When Node two prints sent CAN ID, the frame was queued. That alone does not prove it reached the bus.",
              "The evidence is another node printing a frame line with that CAN ID, while the error counters stay "
              "low and no bus-off alert appears."]))
    add({"scene": s, "title": "Two-node test", "visual": {"type": "bus", "all": True, "done": busdone},
         "panel": bullets("Node 1 + Node 2 (Node 3 unplugged)", [
             "Plug in Node 1, then Node 2",
             "Node 1 serial: JSON lines with \"type\":\"frame\"",
             "Look for canId 0x201, 0x202, 0x203 every 1 s, 0x210 every 0.5 s",
             "Node 2 transmit errors should stop once Node 1 ACKs",
             "Record what you SEE. These IDs are test data, units unverified"], "warn"),
         "narration": ["Plug in Node one, then Node two. Node three stays unplugged.",
                       "On Node one's serial monitor, look for lines of JSON with type frame.",
                       "You should see CAN IDs 0x201, 0x202 and 0x203 about once a second, and 0x210 twice a second.",
                       "Node one acknowledges the frames, so Node two's transmit errors should stop.",
                       "Write down exactly what you see. If nothing arrives, unplug everything and go to the "
                       "troubleshooting table."], "power": "Node 1 + Node 2 USB"})
    add({"scene": s, "title": "Three-node test", "visual": {"type": "bus", "all": True, "done": busdone},
         "panel": bullets("Add Node 3 (monitor, listen-only)", [
             "Plug in Node 3 last. No wiring change",
             "Both terminators stay where they are",
             "Node 3 serial: the same frame IDs",
             "Node 3 never transmits and never ACKs",
             "OLED / LEDs stay dark: no firmware yet"], "warn"),
         "narration": ["Now plug in Node three. Nothing is rewired, and both terminators stay at the two ends.",
                       "Node three's monitor firmware is listen-only. It should print the same frame IDs.",
                       "The OLED and LEDs will do nothing yet, because no firmware drives them. That is "
                       "expected, not a fault."], "power": "All three USB"})

    # ------------------------------------------------------------------ scene 10
    s = 10
    add(sheet(s, "All nodes", "07_node3_wiring", bullets("Handover", [
        "Node 1, Node 2, Node 3 diagrams = ledger",
        "Bus: RT1 at end A, RT2 at end B",
        "Sign-off sheet completed and photographed"]),
              ["Here is the finished build. Compare all three nodes and the bus with the manual one last time.",
               "Photograph each node and the whole bus, and keep the photos with the sign-off sheet."],
              power="Unplug before handling"))
    add(card(s, "Tested vs untested", "What has actually been verified",
             [("Done by Claude: datasheet review, ledger + firmware pin agreement check, diagrams, this video",
               "info"),
              ("NOT done by Claude: any physical inspection, measurement or power-up", "stop"),
              ("Verified only by YOU, when recorded: gates G1-G14, 60 Ohm reading, frame capture", "warn"),
              ("Still BLOCKED: green LED N3-14 (no verified pin)", "stop"),
              ("Firmware still missing: OLED, LEDs, simulations, fault injection", "warn")],
             ["To be clear about what has been tested.",
              "The documents, the pin ledger and the firmware pin settings were checked against each other. No "
              "hardware was inspected, measured or powered by Claude.",
              "Each gate, the 60 ohm reading and the frame capture become verified only when you record them.",
              "The green LED connection is still blocked, and the peripheral firmware still has to be "
              "written.",
              "Thank you for building carefully."], tone="warn"))
    for i, st in enumerate(steps):
        st["seq"] = i + 1
    return steps


def wires_shown(steps):
    """Map ledger id -> list of step seq numbers where it is the current wire."""
    out: dict[str, list[int]] = {}
    for st in steps:
        if st["panel"] and st["panel"]["type"] == "wire":
            out.setdefault(st["panel"]["conn"], []).append(st["seq"])
    return out


if __name__ == "__main__":
    st = build()
    print(len(st), "steps;", sum(len(x["narration"]) for x in st), "sentences")
