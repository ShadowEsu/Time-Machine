# ADR 0002: Pricing, "The Ladder"

Status: superseded by ADR 0013 (one-time price for the web app). Kept for the record.

Date: 14 October 2026. Was accepted; superseded on 22 October 2026 by ADR 0013. Never built.

## Decision

Pro gets cheaper the longer you stay, with a floor.

| | Monthly | Annual | Students |
|---|---|---|---|
| Start | $9 | $79 | half of every step |
| Step 2 | $8 from month 7 | $69 in year 2 | |
| Step 3 | $7 from month 13 | $59 from year 3 | |
| Floor | $6 from month 25 | $59 | |

- After 12 paid months in a row, the version you have is yours to keep.
- 30 day grace and up to 3 months of pause a year keep your step.
- The first 500 subscribers start at step 2.
- Restores are never paywalled. The CLI is free.

## Alternatives considered

- $1 off every month until free (founder's first idea). Caps lifetime revenue at $45 per subscriber and makes most loyal users free. Rejected.
- Flat $9 with perks only. Kept as the perk layer on top of the ladder.

## Rules

- Never say "free forever", "for life" or "guaranteed".
- Disclose the ladder before checkout. Email 7 to 30 days before each price change (California AB 2863).
- Cancel takes the same steps as sign-up. No exit-intent discounts.
- Ladder changes apply to new subscribers only. Earned steps stay.

## Cost

About 8% to 15% less revenue than flat pricing over two to five years if churn does not improve. Pays for itself if monthly churn drops about 24%. Review at 12 months; raise the floor to $7 for new subscribers if needed.
