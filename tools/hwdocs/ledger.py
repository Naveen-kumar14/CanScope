"""Load and validate docs/wiring/pin_ledger.json, the canonical wiring contract.

Everything that shows a wire (diagrams, manual, video, checklists) goes through
this module so that a pin can only ever come from one place.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LEDGER_PATH = REPO / "docs" / "wiring" / "pin_ledger.json"
STATUSES = ("CONFIRMED", "PROVISIONAL", "BLOCKED")


@dataclass(frozen=True)
class Endpoint:
    comp: str
    pin: str

    @property
    def text(self) -> str:
        return f"{self.comp}:{self.pin}"


def load(path: Path = LEDGER_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def parse_ep(s: str) -> Endpoint:
    comp, _, pin = s.partition(":")
    return Endpoint(comp, pin)


def esp_pin(ledger: dict, pin: str) -> dict:
    """Resolve an ESP32 silk label to side, 1-based position from USB end and GPIO.

    "GND" means the GND on the 3V3 side; "GND@VIN" the GND on the VIN side.
    """
    rows = ledger["esp32_header"]["rows"]
    if pin == "GND@VIN":
        side, label = "VIN-side", "GND"
    else:
        side = "3V3-side" if pin in rows["3V3-side"]["silk"] else "VIN-side"
        label = pin
    silk = rows[side]["silk"]
    if label not in silk:
        raise KeyError(f"ESP32 pin {pin!r} not on the 30-pin header")
    i = silk.index(label)
    return {"side": side, "pos": i + 1, "silk": label, "gpio": rows[side]["gpio"][i]}


def describe_ep(ledger: dict, ep: Endpoint) -> str:
    """Human description used identically in manual, video and checklists."""
    comps = ledger["components"]
    if comps.get(ep.comp, {}).get("kind") == "esp32":
        p = esp_pin(ledger, ep.pin)
        gpio = f" (GPIO{p['gpio']})" if p["gpio"] is not None else ""
        return f"{ep.comp} {p['silk']}{gpio}, {p['side']} pin {p['pos']} from USB"
    if ep.comp == "RAIL3":
        return {"3V3+": "Board B bottom + rail (3V3_N3)", "GND-": "Board B bottom - rail (GND)",
                "GNDtop": "Board B top - rail (GND)"}[ep.pin]
    return f"{ep.comp} {ep.pin}"


def connections(ledger: dict, node: int | None = None) -> list[dict]:
    rows = ledger["connections"]
    return [c for c in rows if node is None or c["node"] == node]


def by_id(ledger: dict) -> dict[str, dict]:
    return {c["id"]: c for c in ledger["connections"]}


def validate(ledger: dict) -> list[str]:
    """Structural checks. Returns a list of problems (empty = OK)."""
    problems: list[str] = []
    comps = ledger["components"]
    gates = ledger["gates"]
    ev = ledger["evidence"]
    seen: set[str] = set()
    for c in ledger["connections"] + ledger["conditional_connections"]:
        cid = c["id"]
        if cid in seen:
            problems.append(f"{cid}: duplicate id")
        seen.add(cid)
        if c["status"] not in STATUSES:
            problems.append(f"{cid}: bad status {c['status']}")
        for g in c.get("gates", []):
            if g not in gates:
                problems.append(f"{cid}: unknown gate {g}")
        for e in c.get("design_evidence", []):
            if e not in ev:
                problems.append(f"{cid}: unknown evidence {e}")
    for c in ledger["connections"]:
        for side in ("from", "to"):
            ep = parse_ep(c[side])
            if ep.comp not in comps:
                problems.append(f"{c['id']}: unknown component {ep.comp}")
                continue
            comp = comps[ep.comp]
            if comp["kind"] == "esp32":
                try:
                    p = esp_pin(ledger, ep.pin)
                except KeyError as e:
                    problems.append(f"{c['id']}: {e}")
                    continue
                g = p["gpio"]
                av = ledger["esp32_header"]["avoid"]
                for k in ("flash", "strapping", "usb_serial"):
                    if g in av[k]:
                        problems.append(f"{c['id']}: GPIO{g} is a {k} pin")
                if g in av["input_only"] and "input" not in c["domain"]:
                    problems.append(f"{c['id']}: GPIO{g} is input-only")
            elif ep.pin not in comp.get("pins", []):
                problems.append(f"{c['id']}: {ep.comp} has no pin {ep.pin}")
        # Safety rules from the brief.
        ends = {parse_ep(c["from"]).pin, parse_ep(c["to"]).pin}
        comps_in = {parse_ep(c["from"]).comp, parse_ep(c["to"]).comp}
        if ends & {"CANH", "CANL"} and any(comps.get(x, {}).get("kind") == "esp32" for x in comps_in):
            problems.append(f"{c['id']}: CANH/CANL wired to an ESP32 pin")
        if "VIN" in ends and ("3V3" in ends or "3V3+" in ends):
            problems.append(f"{c['id']}: 5 V VIN joined to a 3V3 point")
    # A GPIO carries one signal: at most one row that is not BLOCKED per ESP32 GPIO.
    gpio_rows: dict[tuple[str, int], list[str]] = {}
    for c in ledger["connections"]:
        if c["status"] == "BLOCKED":
            continue
        for side in ("from", "to"):
            ep = parse_ep(c[side])
            if comps.get(ep.comp, {}).get("kind") != "esp32":
                continue
            try:
                g = esp_pin(ledger, ep.pin)["gpio"]
            except KeyError:
                continue
            if g is not None:
                gpio_rows.setdefault((ep.comp, g), []).append(c["id"])
    for (comp, g), ids in sorted(gpio_rows.items()):
        if len(ids) > 1:
            problems.append(f"{comp} GPIO{g} used by more than one wire: {', '.join(ids)}")
    # 3V3 of different nodes must never meet.
    nets = _nets(ledger)
    for net in nets:
        owners = {comps[e.comp]["node"] for e in net
                  if comps[e.comp]["kind"] == "esp32" and e.pin == "3V3"}
        if len(owners) > 1:
            problems.append(f"3V3 pins of nodes {sorted(owners)} are joined")
        if any(e.pin == "VIN" for e in net) and any(e.pin in ("3V3", "3V3+") for e in net):
            problems.append("VIN and 3V3 are on the same net")
    # Exactly two terminators, on the bus end transceivers.
    term_nodes = sorted({parse_ep(c["to"]).comp for c in ledger["connections"]
                         if parse_ep(c["from"]).comp in ("RT1", "RT2")})
    if term_nodes != ["TRX1", "TRX3"]:
        problems.append(f"terminators on {term_nodes}, expected the bus ends TRX1 and TRX3")
    return problems


def _nets(ledger: dict) -> list[set[Endpoint]]:
    """Union-find over connections. Component-internal links are NOT assumed,
    except the transceiver/breadboard strip identity (an endpoint is its own node)."""
    parent: dict[Endpoint, Endpoint] = {}

    def find(x: Endpoint) -> Endpoint:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for c in ledger["connections"]:
        a, b = parse_ep(c["from"]), parse_ep(c["to"])
        parent[find(a)] = find(b)
    groups: dict[Endpoint, set[Endpoint]] = {}
    for x in list(parent):
        groups.setdefault(find(x), set()).add(x)
    return list(groups.values())


def firmware_check(ledger: dict) -> list[tuple[str, str, int, int | None, bool]]:
    """Compare ledger GPIOs with the values in firmware sources.

    Returns (file, macro, ledger_gpio, firmware_gpio, ok).
    """
    out = []
    for b in ledger["firmware_bindings"]:
        text = (REPO / b["file"]).read_text(encoding="utf-8", errors="replace")
        m = re.search(rf"#define\s+{b['macro']}\s+(?:GPIO_NUM_)?(\d+)", text)
        fw = int(m.group(1)) if m else None
        conn = by_id(ledger)[b["ledger"]]
        p = esp_pin(ledger, parse_ep(conn["from"]).pin)
        ok = fw == p["gpio"] == b["gpio"]
        out.append((b["file"], b["macro"], p["gpio"], fw, ok))
    return out


if __name__ == "__main__":
    L = load()
    probs = validate(L)
    for row in firmware_check(L):
        print(("OK  " if row[4] else "BAD ") + f"{row[0]} {row[1]}: ledger GPIO{row[2]} firmware {row[3]}")
    print("\n".join(probs) if probs else "ledger: no structural problems")
