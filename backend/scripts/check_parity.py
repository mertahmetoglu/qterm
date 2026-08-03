"""Parity check, Python side. Run check_parity.mjs first to produce
parity_cases.json, then run this. Exits non-zero with a diff list on any
mismatch between signal_engine.compute_signal and the frontend's
indicators.js, across every generated test series.
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from signal_engine import compute_signal

HERE = Path(__file__).resolve().parent


def close(a, b, tol=1e-6):
    if a is None or b is None:
        return a == b
    return math.isclose(a, b, rel_tol=tol, abs_tol=tol)


def diff_case(js, py):
    mismatches = []

    for key in ["signal", "color", "strength", "total"]:
        if js[key] != py[key]:
            mismatches.append(f"{key}: js={js[key]!r} py={py[key]!r}")

    for key in ["e9", "e21", "rsi", "macdHist", "bbUpper", "bbLower", "bbMid", "price"]:
        if not close(js[key], py[key]):
            mismatches.append(f"{key}: js={js[key]!r} py={py[key]!r}")

    for key in ["ema", "rsi", "macd", "bb"]:
        if js["scores"][key] != py["scores"][key]:
            mismatches.append(f"scores.{key}: js={js['scores'][key]!r} py={py['scores'][key]!r}")

    for arr_key in ["ema9", "ema21", "rsiArr", "macdLine", "signalLine", "histogram"]:
        a, b = js[arr_key], py[arr_key]
        if len(a) != len(b):
            mismatches.append(f"{arr_key}: length mismatch {len(a)} vs {len(b)}")
            continue
        for i, (x, y) in enumerate(zip(a, b)):
            if not close(x, y):
                mismatches.append(f"{arr_key}[{i}]: js={x!r} py={y!r}")
                break

    for i, (x, y) in enumerate(zip(js["bb"], py["bb"])):
        for k in ["upper", "middle", "lower"]:
            if not close(x[k], y[k]):
                mismatches.append(f"bb[{i}].{k}: js={x[k]!r} py={y[k]!r}")
                break

    return mismatches


def main():
    cases = json.loads((HERE / "parity_cases.json").read_text())

    total_mismatches = 0
    signals_seen = set()
    for name, case in cases.items():
        closes = case["closes"]
        js = case["result"]
        py = compute_signal(closes)
        mismatches = diff_case(js, py)
        signals_seen.add(py["signal"])
        if mismatches:
            total_mismatches += len(mismatches)
            print(f"[FAIL] {name}: {len(mismatches)} mismatches")
            for m in mismatches[:10]:
                print("    -", m)
        else:
            print(f"[ OK ] {name}: signal={py['signal']} strength={py['strength']} total={py['total']}")

    print()
    print(f"distinct signals exercised: {sorted(signals_seen)}")
    if total_mismatches:
        print(f"PARITY FAILED -- {total_mismatches} total mismatches across {len(cases)} cases")
        sys.exit(1)

    print(f"PARITY OK -- {len(cases)}/{len(cases)} cases match exactly")


if __name__ == "__main__":
    main()
