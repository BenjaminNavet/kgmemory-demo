# KGmemory demo

Demo pages of KGmemory, a knowledge-graph memory for LLM assistants (RDF, OWL 2 RL, SKOS,
SHACL, PROV-O, OWL-Time, Web Annotation).

**Live: <https://benjaminnavet.github.io/kgmemory-demo/>**

| Version | What it is |
|---|---|
| [`v3/`](https://benjaminnavet.github.io/kgmemory-demo/v3/) | **Glass box on recorded real runs** (opened by the root URL). Pick one of six benchmark questions, compare the answer of the same model with and without memory, open each stage of the recall, and trace any served memory back to the words it came from. Two reading levels: Simple and Technical. |
| [`v2/`](https://benjaminnavet.github.io/kgmemory-demo/v2/) | Short animated story in 8 steps, on an invented example. |
| [`v1/`](https://benjaminnavet.github.io/kgmemory-demo/v1/) | Full 15-step walk-through, on an invented example. |

## Presenting it

`v3/` has a presenter mode for a talk or a screen share: open
<https://benjaminnavet.github.io/kgmemory-demo/v3/?present>, or press `P` on the page. Ten
slides drawn from the same recording go through the whole demo: the data (which benchmark,
which conversation, where the questions come from), how the memory is built, the six
questions and why these, one question worked through (its answers, the memories handed to the
model, how they were found, the source of one memory), the six side by side, the upkeep of
the memory. Each slide states one fact in plain words and defines the terms it uses.

| Key | Effect |
|---|---|
| `→` `Space` / `←` | next / previous slide |
| `1` to `6` | change the question worked through |
| `T` | Simple or Technical level |
| `C` | clock |
| `Esc` | back to the page |

The mode needs no network once the page is loaded; fonts are served with the page
(IBM Plex, SIL Open Font License, `v3/assets/fonts/OFL.txt`).

## Where the v3 data comes from

Everything `v3/` displays is read from `v3/data/runs.js`, which an export script wrote by
calling the unmodified KGmemory pipeline on a dedicated store:

- the store was built by the real write path from one conversation of the LoCoMo benchmark
  (John and Maria, 32 sessions);
- each question is a real retrieval call, with its trace, the SPARQL query it sent and the
  PROV activities it wrote; the two answers are real model calls, with and without the
  recalled block;
- each served memory is read back from the graph with its source passage, its quote anchor
  and its write activity, and is validated again against the SHACL shapes;
- the maintenance passes (revision, contradiction detection, forgetting, abstraction, associations) were
  then run for real, and the page reports what each one did.

The pages are static: there is no live backend, model or triple store behind them, and no
benchmark score is shown. One of the six questions is a miss, left in on purpose.

The conversation comes from the LoCoMo benchmark (Maharana et al., 2024), licence
CC BY-NC 4.0.

## Paper

These pages accompany the ISWC 2026 Doctoral Consortium paper *Knowledge Graphs as External
Memory for LLM-based Scientific Assistants* (Benjamin Navet),
HAL: <https://hal.science/hal-05747244>.
