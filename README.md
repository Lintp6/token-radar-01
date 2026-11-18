# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Lintp6/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Lintp6/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, ranks the 198 pre-token protocols by an implied value, and gives each one a six-step farm plan. The dashboard is a static dark-themed page with a sortable, filterable board, a detail view per protocol, and a model sandbox.

## The model (radar-2)

```
implied = round( TVL × category_multiple × growth_multiplier × maturity_multiplier × youth_multiplier )
```

- **category_multiple**: the median market-cap-to-TVL ratio of the live-token protocols in the same category, each ratio capped at 2.0. Categories with fewer than 5 live samples use the fallback: the median of all 129 live ratios (0.2049).
- **growth_multiplier**: `1 + clamp(change_7d − market median 7d change, −40, +60) / 100 × 0.8`. The market median week (−8.23%) is the zero line, so a protocol that fell less than the market still gains.
- **maturity_multiplier**: `0.55 + min(age_days, 1095) / 1095 × 0.45`; an unlisted age uses 365 days.
- **youth_multiplier**: 0.85 when the protocol is under 180 days old, else 1.0.

Everything is computed from the snapshot at run time: the market median, every multiple, and the fallback. No protocol name is special-cased. The board excludes exchanges, bridges, wrapped and staked products, and versioned pools — the products whose token already trades — and covers all 40 watchlist protocols plus every other protocol that passes the same rule.

The page recomputes each row from the snapshot figures and checks the number `board.json` carries, so the screenshots and the code agree.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

Node 22 or later, standard library only. `main.ts` reads the snapshot, writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. Open `out/dashboard/index.html` in a browser; no network is needed.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ad8dyw21&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
