[![make.fun · news-image-20261123](https://make.fun/badge/news-image-20261123.svg)](https://make.fun/bounty/news-image-20261123?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261123)
[![rank](https://make.fun/badge/news-image-20261123/oy-builds/news-image-20261123/rank.svg)](https://make.fun/bounty/news-image-20261123/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261123)
[![reward](https://make.fun/badge/news-image-20261123/oy-builds/news-image-20261123/reward.svg)](https://make.fun/bounty/news-image-20261123?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261123)

# The World Today — 23 November 2026

A make.fun entry for **news-image-20261123**: a Node 22 program (`main.ts`,
standard library only) that draws one newspaper-style image summing up the
world news of Monday 23 November 2026 and writes it to `/output/entry.png`.

The picture is rendered entirely in code — a hand-rolled rasteriser, a 5×7
pixel font and a PNG encoder, all in `main.ts` — so the output is
deterministic: every run writes byte-identical bytes.

Run it the way the grader does:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Stories and their sources are listed in [SOURCES.md](SOURCES.md).
