# Run: python3 research/pricing_sim.py  (see the Pricing section of the plan doc)
# Cohort simulation: 1,000 paying users, 36 months. All inputs are assumptions, stated below.
import sys
MONTHS = 36
COST = 1.50          # variable cost per active user per month (snapshot storage, compute, LLM summaries)
def base_churn(m):   # monthly churn at month m (1-based): 14% in month 1, decaying to a 4% floor
    return max(0.04, 0.14 * (0.85 ** (m - 1)))

def run(price_fn, churn_mult=1.0):
    alive, rev, cost, active = 1000.0, 0.0, 0.0, []
    for m in range(1, MONTHS + 1):
        p = price_fn(m)
        rev += alive * p
        cost += alive * COST
        active.append(alive)
        alive *= 1 - min(0.95, base_churn(m) * churn_mult)
    return rev, rev - cost, active[11], active[35]

plans = {
  "Flat $9/mo":                         (lambda m: 9, 1.00),
  "Your ladder: $9 -> $0 (free from month 10)": (lambda m: max(0, 10 - m), 0.70),
  "Ladder with $5 floor":               (lambda m: max(5, 10 - m), 0.80),
  "Yearly ladder: $9 / $7 / $5 (JetBrains-style)": (lambda m: 9 if m <= 12 else 7 if m <= 24 else 5, 0.85),
  "Streak credits: $9, every 4th month free while unbroken": (lambda m: 0 if m % 4 == 0 else 9, 0.80),
}
print(f"{'Plan':58s} {'36-mo revenue':>14s} {'36-mo margin':>13s} {'paying @m12':>11s} {'@m36':>6s}")
for name, (fn, cm) in plans.items():
    r, g, a12, a36 = run(fn, cm)
    print(f"{name:58s} {r:14,.0f} {g:13,.0f} {a12:11,.0f} {a36:6,.0f}")
# break-even: how much must the ladder cut churn to match flat $9 margin?
flat = run(lambda m: 9)[1]
for cm in [0.7, 0.5, 0.3, 0.1]:
    print("ladder churn x", cm, "margin", round(run(lambda m: max(0, 10 - m), cm)[1]), "vs flat", round(flat))
print()
q = lambda m: max(5, 9 - (m - 1) // 3)   # $1 off every 3 consecutive months, $5 floor
for cm in [1.0, 0.85, 0.8]:
    r, g, a12, a36 = run(q, cm)
    print(f"Quarterly $1 steps to $5 floor, churn x{cm}: revenue {r:,.0f} margin {g:,.0f} paying@12 {a12:.0f} @36 {a36:.0f}")
print("ladder months 1-12:", [max(0,10-m) for m in range(1,13)], "sum to free =", sum(range(1,10)))
print("quarterly ladder months 1-15:", [q(m) for m in range(1,16)])
