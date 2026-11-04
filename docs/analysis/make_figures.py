"""
Generates the data figures and numbers used in the project report.

1. Live KPIs / carrier scorecard from the deployed SmartDock API
2. API response-time measurements against the live deployment
3. Discrete-event simulation: unscheduled arrivals vs. SmartDock appointments

Usage:  python make_figures.py [base_url]
Outputs: ../figures/fig_*.png and results.json (numbers quoted in the report)
"""
import json
import random
import statistics
import sys
import time
import urllib.request
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://smartdock.onrender.com"
OUT = Path(__file__).resolve().parent.parent / "figures"
OUT.mkdir(exist_ok=True)

# Reference palette (light mode, for printed report): categorical slots 1-2, text tokens
BLUE, ORANGE = "#2a78d6", "#eb6834"
INK, INK2, GRID = "#0b0b0b", "#52514e", "#e4e3df"

plt.rcParams.update({
    "font.size": 10, "axes.edgecolor": GRID, "axes.labelcolor": INK2, "xtick.color": INK2,
    "ytick.color": INK2, "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6, "axes.axisbelow": True,
    "savefig.dpi": 200, "savefig.bbox": "tight",
})


def api(path, token=None, body=None):
    req = urllib.request.Request(BASE + path, method="POST" if body else "GET")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body else None
    with urllib.request.urlopen(req, data=data, timeout=120) as r:
        return json.loads(r.read())


results = {}

# ---------------------------------------------------------------- 1. live KPIs
print("Fetching live analytics from", BASE)
api("/health")  # wake the free-tier instance
token = api("/api/auth/login", body={"email": "admin@smartdock.demo", "password": "Demo@123"})["token"]
an = api("/api/analytics", token)
results["kpis"] = an["kpis"]
results["range"] = an["range"]
results["byStatus"] = an["byStatus"]
results["busiestHours"] = an["busiestHours"]
results["perDock"] = [{k: d[k] for k in ("dockName", "utilization", "appointments", "capacity", "avgDockMinutes")} for d in an["perDock"]]
results["carriers"] = [{k: c[k] for k in ("name", "appointments", "onTimeRate", "noShows", "reliabilityScore", "tier")} for c in an["carriers"]]

# Carrier reliability (single series, sorted, direct value labels)
cs = sorted(an["carriers"], key=lambda c: c["reliabilityScore"] or 0)
fig, ax = plt.subplots(figsize=(6.4, 2.8))
bars = ax.barh([c["name"] for c in cs], [c["reliabilityScore"] or 0 for c in cs], color=BLUE, height=0.55)
for b, c in zip(bars, cs):
    ax.text(b.get_width() + 1, b.get_y() + b.get_height() / 2, f'{c["reliabilityScore"]} ({c["tier"]})', va="center", color=INK, fontsize=9)
ax.set_xlim(0, 110)
ax.set_xlabel("Reliability score (0-100)")
ax.grid(axis="y", visible=False)
ax.set_title("Carrier reliability score, last 30 days", loc="left", color=INK, fontsize=11)
fig.savefig(OUT / "fig_carrier_reliability.png")
plt.close(fig)

# Per-dock utilization
docks = an["perDock"]
fig, ax = plt.subplots(figsize=(6.4, 2.6))
bars = ax.barh([d["dockName"] for d in docks][::-1], [d["utilization"] or 0 for d in docks][::-1], color=BLUE, height=0.55)
for b in bars:
    ax.text(b.get_width() + 0.8, b.get_y() + b.get_height() / 2, f"{b.get_width():.1f}%", va="center", color=INK, fontsize=9)
ax.set_xlim(0, 60)
ax.set_xlabel("Utilization (% of offered truck-slots)")
ax.grid(axis="y", visible=False)
ax.set_title("Dock utilization by door, last 30 days", loc="left", color=INK, fontsize=11)
fig.savefig(OUT / "fig_dock_utilization.png")
plt.close(fig)

# ------------------------------------------------------- 2. API response times
print("Measuring live API response times ...")
wh = api("/api/warehouses/my", token)["warehouse"]
tomorrow = time.strftime("%Y-%m-%d", time.localtime(time.time() + 86400))
endpoints = {
    "Health check": "/health",
    "Slot availability (1 day)": f"/api/bookings/availability?warehouseId={wh['_id']}&date={tomorrow}",
    "Yard schedule (1 day)": "/api/bookings?from=%s&to=%s" % (
        time.strftime("%Y-%m-%dT00:00:00Z", time.gmtime()), time.strftime("%Y-%m-%dT23:59:59Z", time.gmtime())),
    "Analytics (30 days)": "/api/analytics",
}
latency = {}
for label, path in endpoints.items():
    api(path, token)  # warm-up
    samples = []
    for _ in range(15):
        t0 = time.perf_counter()
        api(path, token)
        samples.append((time.perf_counter() - t0) * 1000)
    samples.sort()
    latency[label] = {"median_ms": round(statistics.median(samples)), "p90_ms": round(samples[int(0.9 * len(samples)) - 1])}
    print(f"  {label}: {latency[label]}")
results["latency"] = latency

# ------------------------------------------------------------ 3. simulation
# One DC day 07:00-19:00, 6 identical dock doors, 60 trucks/day.
# Dock handling time ~ triangular(25, 55, 40) min + 5 min turnover.
# Without appointments carriers arrive when it suits them (morning and afternoon peaks).
# With SmartDock each truck books the free 60-min slot nearest its preferred time
# (max 6 per slot = one per door) and arrives around the slot start with the punctuality
# mix observed in the demo data (80% within -15..+12 min, 15% late 16-55 min, 5% no-show).
print("Running simulation ...")
DOCKS, TRUCKS, OPEN, CLOSE, DAYS = 6, 60, 7 * 60, 19 * 60, 60


def preferred_time(rng):
    t = rng.gauss(9.5 * 60, 60) if rng.random() < 0.55 else rng.gauss(14.5 * 60, 75)
    return min(max(t, OPEN - 30), CLOSE - 60)


def service(rng):
    return rng.triangular(25, 55, 40) + 5


def run_day(rng, scheduled):
    trucks = []
    if not scheduled:
        for _ in range(TRUCKS):
            trucks.append((preferred_time(rng), service(rng)))
    else:
        slots = {h: 0 for h in range(OPEN, CLOSE, 60)}
        for _ in range(TRUCKS):
            pref = preferred_time(rng)
            for slot in sorted(slots, key=lambda s: abs(s + 30 - pref)):
                if slots[slot] < DOCKS:
                    slots[slot] += 1
                    break
            r = rng.random()
            if r < 0.05:
                continue  # no-show
            offset = rng.uniform(-15, 12) if r < 0.85 else rng.uniform(16, 55)
            trucks.append((slot + offset, service(rng)))
    trucks.sort()
    free = [OPEN] * DOCKS
    waits, events = [], []
    for arrival, svc in trucks:
        i = min(range(DOCKS), key=lambda k: free[k])
        start = max(arrival, free[i], OPEN)
        waits.append(start - max(arrival, OPEN))
        events.append((max(arrival, OPEN), start))
        free[i] = start + svc
    return waits, events


def summarize(scheduled):
    rng = random.Random(42)
    all_w, queue_profile = [], [0.0] * ((CLOSE - OPEN) // 15 + 4)
    overtime = []
    for _ in range(DAYS):
        w, ev = run_day(rng, scheduled)
        all_w += w
        for k in range(len(queue_profile)):
            t = OPEN + 15 * k
            queue_profile[k] += sum(1 for a, s in ev if a <= t < s) / DAYS
    all_w.sort()
    return {
        "mean_wait_min": round(statistics.mean(all_w), 1),
        "p90_wait_min": round(all_w[int(0.9 * len(all_w))], 1),
        "max_wait_min": round(all_w[-1], 1),
        "share_wait_over_30_pct": round(100 * sum(1 for x in all_w if x > 30) / len(all_w), 1),
        "peak_avg_queue": round(max(queue_profile), 1),
    }, queue_profile


before, q_before = summarize(False)
after, q_after = summarize(True)
results["simulation"] = {"before": before, "after": after, "params": {"docks": DOCKS, "trucks_per_day": TRUCKS, "days": DAYS}}
print("  before:", before)
print("  after: ", after)

# Grouped bars: wait metrics (same unit), two scenarios
fig, ax = plt.subplots(figsize=(6.4, 3))
labels = ["Mean wait", "90th percentile wait"]
x = range(len(labels))
w = 0.36
b1 = ax.bar([i - w / 2 - 0.01 for i in x], [before["mean_wait_min"], before["p90_wait_min"]], w, color=ORANGE, label="Without appointments")
b2 = ax.bar([i + w / 2 + 0.01 for i in x], [after["mean_wait_min"], after["p90_wait_min"]], w, color=BLUE, label="With SmartDock")
for bars in (b1, b2):
    for b in bars:
        ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 1, f"{b.get_height():.0f}", ha="center", color=INK, fontsize=9)
ax.set_xticks(list(x), labels)
ax.set_ylabel("Minutes from arrival to dock")
ax.grid(axis="x", visible=False)
ax.legend(frameon=False, loc="upper left")
ax.set_title("Truck yard waiting time (simulation, 60 days)", loc="left", color=INK, fontsize=11)
fig.savefig(OUT / "fig_sim_wait.png")
plt.close(fig)

# Queue profile over the day
fig, ax = plt.subplots(figsize=(6.4, 3))
hours = [(OPEN + 15 * k) / 60 for k in range(len(q_before))]
ax.plot(hours, q_before, color=ORANGE, lw=2, label="Without appointments")
ax.plot(hours, q_after, color=BLUE, lw=2, label="With SmartDock")
ax.text(hours[q_before.index(max(q_before))], max(q_before) + 0.3, f"peak {max(q_before):.1f}", color=INK, fontsize=9, ha="center")
ax.set_xticks(range(7, 20, 2), [f"{h:02d}:00" for h in range(7, 20, 2)])
ax.set_ylabel("Trucks waiting in yard (avg)")
ax.legend(frameon=False)
ax.set_title("Yard queue through the day (simulation)", loc="left", color=INK, fontsize=11)
fig.savefig(OUT / "fig_sim_queue.png")
plt.close(fig)

(Path(__file__).resolve().parent / "results.json").write_text(json.dumps(results, indent=2))
print("Done. Figures in", OUT)
