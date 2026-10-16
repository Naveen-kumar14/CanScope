"""Cross-check ledger <-> diagrams <-> video storyboard <-> firmware.

Writes validation/wire_coverage_checklist.md and prints a PASS/FAIL report.
Exit code 1 if any check fails.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "video" / "source"))
import draw as D  # noqa: E402
import ledger as L  # noqa: E402
import scenes  # noqa: E402

OUT = L.REPO / "validation" / "wire_coverage_checklist.md"


def run():
    led = L.load()
    ids = set(L.by_id(led))
    results: list[tuple[str, bool, str]] = []

    def check(name, ok, detail=""):
        results.append((name, bool(ok), detail))

    probs = L.validate(led)
    check("Ledger structure and safety rules (CAN-to-GPIO, GPIO-to-buzzer, 3V3 joins, VIN-to-3V3, "
          "strapping/flash/input-only pins, exactly two end terminators)", not probs, "; ".join(probs))

    fw = L.firmware_check(led)
    bad = [f"{f} {m}: ledger {lg} fw {v}" for f, m, lg, v, ok in fw if not ok]
    check("Ledger CAN GPIOs equal firmware sources (node1, node2, monitor, legacy node2 sketch)", not bad,
          "; ".join(bad) or f"{len(fw)} bindings agree")

    # diagrams
    diagram_of: dict[str, list[str]] = {}
    for n in (1, 2, 3):
        geo = set(D.geometry(led, n))
        node_ids = {c["id"] for c in L.connections(led, n)}
        check(f"Node {n} diagram draws exactly the Node {n} ledger rows", geo == node_ids,
              f"missing {sorted(node_ids - geo)} extra {sorted(geo - node_ids)}")
        for i in geo:
            diagram_of.setdefault(i, []).append(f"node{n}")
    bus = set(D.bus_geometry())
    check("Bus diagram ids all exist in the ledger", bus <= ids, f"unknown {sorted(bus - ids)}")
    bus_rows = {c["id"] for c in L.connections(led, 0)}
    check("Bus diagram draws every trunk row (B-01..B-06) and both terminators",
          bus_rows <= bus and {"N1-05", "N1-06", "N3-08", "N3-09"} <= bus, "")
    for i in bus:
        diagram_of.setdefault(i, []).append("bus")
    check("Every ledger row appears in at least one diagram", ids <= set(diagram_of),
          f"undrawn {sorted(ids - set(diagram_of))}")

    # video
    steps = scenes.build(led)
    shown = scenes.wires_shown(steps)
    check("Every ledger row is a highlighted video wiring step", ids <= set(shown),
          f"not shown {sorted(ids - set(shown))}")
    check("No ledger row is shown as a wiring step more than once", all(len(v) == 1 for v in shown.values()),
          str({k: v for k, v in shown.items() if len(v) > 1}))
    check("Video wiring steps only reference ledger rows", set(shown) <= ids, str(sorted(set(shown) - ids)))
    mism = []
    for st in steps:
        p = st["panel"]
        if p and p["type"] == "wire":
            conn = L.by_id(led)[p["conn"]]
            v = st["visual"]
            if v["type"] == "node" and v["node"] != conn["node"]:
                mism.append(f"step {st['seq']}: {conn['id']} on node {v['node']} diagram")
            for s in ("from", "to"):
                ep = L.parse_ep(conn[s])
                if ep.comp.startswith("ESP"):
                    g = L.esp_pin(led, ep.pin)["gpio"]
                    text = " ".join(st["narration"])
                    if g is not None and f"GPIO {g}" not in text:
                        mism.append(f"step {st['seq']}: narration lacks GPIO {g}")
    check("Video wire steps use the same node and GPIO as the ledger (no GPIO drift between scenes)",
          not mism, "; ".join(mism))
    blocked_ok = all(any("BLOCKED" in s for s in st["narration"]) for st in steps
                     if st["panel"] and st["panel"]["type"] == "wire"
                     and L.by_id(led)[st["panel"]["conn"]]["status"] == "BLOCKED")
    check("Every BLOCKED row is narrated as BLOCKED (drawn dashed red, STOP banner in panel)", blocked_ok, "")

    # gates introduced before use; safety before first wire
    explained: set[str] = set()
    late = []
    first_wire = None
    for st in steps:
        p = st["panel"]
        if p and p["type"] == "wire":
            first_wire = first_wire or st["seq"]
            for g in L.by_id(led)[p["conn"]]["gates"]:
                if g not in explained:
                    late.append(f"{p['conn']} uses {g} before it is explained")
        # A gate counts as explained only by a gate panel or an explicit "Gate Gn" sentence.
        if p and p["type"] == "gates":
            explained |= set(p["gates"])
        for s in st["narration"]:
            explained |= set(re.findall(r"[Gg]ate (G\d+)", s))
    check("Every gate is explained before the first step that depends on it", not late, "; ".join(late))
    safety_seq = next(st["seq"] for st in steps if st["title"] == "Safety")
    check("Safety card precedes the first wiring step", safety_seq < (first_wire or 10 ** 6),
          f"safety step {safety_seq}, first wire step {first_wire}")
    unsafe_power = [st["seq"] for st in steps if st["panel"] and st["panel"]["type"] == "wire"
                    and not st["power"].startswith("ALL POWER OFF")]
    check("Every wiring step is shown with ALL POWER OFF", not unsafe_power, str(unsafe_power))

    # termination at physical ends of the bus order
    order = [o.split()[0] for o in led["bus"]["order"]]
    term = sorted({L.parse_ep(c["to"]).comp for c in led["connections"] if L.parse_ep(c["from"]).comp in ("RT1", "RT2")})
    check("Terminators sit on the first and last transceiver of the bus order", term == sorted([order[0], order[-1]]),
          f"order {order}, terminators on {term}")

    write_checklist(led, diagram_of, shown)
    return results


def write_checklist(led, diagram_of, shown):
    rows = ["# Wire coverage checklist and sign-off", "",
            f"Generated by `tools/hwdocs/validate.py` from `docs/wiring/pin_ledger.json` ({led['meta']['revision']}). "
            "Do not edit by hand.", "",
            "Use it twice: (1) the coverage columns prove that every ledger row is drawn and shown in the video; "
            "(2) the last three columns are the builder's sign-off, filled in on paper with **all power off**.", "",
            "Status: **CONFIRMED** documents support it · **PROVISIONAL** wire only after its gates pass · "
            "**BLOCKED** leave empty.", "",
            "| ID | From | To | Signal | Wire | Status | Gates | Check (power off) | Diagram | Video step | "
            "Gates passed | Both ends + meter | Initials |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for c in led["connections"]:
        wire = "lead" if c["kind"] == "lead" else c["color"]
        rows.append(
            f"| {c['id']} | {L.describe_ep(led, L.parse_ep(c['from']))} | {L.describe_ep(led, L.parse_ep(c['to']))} | "
            f"{c['signal']} | {wire} | **{c['status']}** | {', '.join(c['gates'])} | {c['verify']} | "
            f"{', '.join(diagram_of.get(c['id'], []))} | {', '.join(map(str, shown.get(c['id'], [])))} | "
            f"{'n/a - do not wire' if c['status'] == 'BLOCKED' else '☐'} | "
            f"{'☐ empty' if c['status'] == 'BLOCKED' else '☐'} | |")
    rows += ["", "## Conditional rows (apply only if the condition is true)", "",
             "| ID | Applies when | From | To | Signal | Status | Gates |", "|---|---|---|---|---|---|---|"]
    for c in led["conditional_connections"]:
        rows.append(f"| {c['id']} | {c['applies']} | {c['from']} | {c['to']} | {c['signal']} | **{c['status']}** | "
                    f"{', '.join(c['gates'])} |")
    rows += ["", "## Gate record", "", "| Gate | Title | Pass condition | Result / value | Date | Initials |",
             "|---|---|---|---|---|---|"]
    for g, v in led["gates"].items():
        rows.append(f"| {g} | {v['title']} | {v['pass']} | | | |")
    OUT.write_text("\n".join(rows) + "\n", encoding="utf-8")


def main():
    res = run()
    for name, ok, detail in res:
        print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    print(f"\n{sum(ok for _, ok, _ in res)}/{len(res)} checks passed; wrote {OUT}")
    sys.exit(0 if all(ok for _, ok, _ in res) else 1)


if __name__ == "__main__":
    main()
