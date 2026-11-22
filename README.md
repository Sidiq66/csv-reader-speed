# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Sidiq66/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Sidiq66/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast, dependency-free CSV reader in a single ES module (`solve.js`): a drop-in replacement for csv-reader 1.0.0 that returns identical answers on broken CSV — the same columns, rows and broken-row errors (short_row, long_row, stray_cr, quote_junk, unterminated_quote) — while reading in a fraction of the CPU time. Where csv-reader builds every field one character at a time, this reader scans with charCodeAt loops over a special-character table and slices clean fields out whole; only the broken constructs (a stray CR, a doubled quote, a CR inside quotes) fall back to a segment-by-segment read of just that field. On the competition's practice set (6 cases, 10.2M characters) it answers about 6x faster than the house baseline, byte-identical output. `main.ts` is the harness driver: it reads every case from /input/cases.json and writes /output/answers.json.

## Run it

```sh
mkdir -p input output   # put a cases.json in input/
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=output node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=x9j98tfg&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
