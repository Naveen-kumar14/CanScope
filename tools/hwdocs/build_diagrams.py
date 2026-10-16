"""Render every wiring diagram to docs/wiring/diagrams/*.png from the ledger."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import draw as D  # noqa: E402
import ledger as L  # noqa: E402

OUT = L.REPO / "docs" / "wiring" / "diagrams"

SHEETS = {
    "01_esp32_pin_locator": lambda c, led: D.draw_pin_locator(c, led),
    "02_transceiver_identification": lambda c, led: D.draw_trx_id(c),
    "03_parts_identification": lambda c, led: D.draw_parts_id(c),
    "04_breadboard_placement": lambda c, led: D.draw_placement(c),
    "05_node1_wiring": lambda c, led: D.draw_node(c, led, 1),
    "06_node2_wiring": lambda c, led: D.draw_node(c, led, 2),
    "07_node3_wiring": lambda c, led: D.draw_node(c, led, 3),
    "08_can_bus_trunk": lambda c, led: D.draw_bus(c, led),
    "09_power_ground_domains": lambda c, led: D.draw_power(c),
}

TITLES = {
    "05_node1_wiring": "Node 1 (Motor ECU) wiring - ledger N1-01..N1-06",
    "06_node2_wiring": "Node 2 (Battery ECU) wiring - ledger N2-01..N2-04",
    "07_node3_wiring": "Node 3 (CANScope monitor) wiring - ledger N3-01..N3-35",
    "08_can_bus_trunk": "CAN bus trunk and termination - ledger B-01..B-06, RT1, RT2",
}


def render(name, scale=2.0):
    led = L.load()
    c = D.Canvas(scale=scale)
    SHEETS[name](c, led)
    if name in TITLES:
        c.text(640, 22, TITLES[name], 20, D.INK, bold=True, anchor="mm")
        c.text(640, 48, f"{led['meta']['revision']} | SCHEMATIC ILLUSTRATION - not a photograph | "
                        "status per wire tag colour", 12, D.MUTED, anchor="mm")
    return c.finish()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name in SHEETS:
        render(name).save(OUT / f"{name}.png", optimize=True)
        print("wrote", OUT / f"{name}.png")


if __name__ == "__main__":
    main()
