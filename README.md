# KGmemory — Glass-Box Memory (demo)

A scripted, self-contained walk-through of a knowledge-graph memory for an LLM-based
scientific assistant. Over 15 steps it covers the six memory operations — consolidation,
indexing, updating, forgetting, retrieval and compression — on example memories about
glucose: concept resolution, working-memory gate, SPARQL retrieval with RRF ranking,
budget compression and verbalization into a `<kgmemory>` context block, schema-guided
extraction, SHACL validation with a bounded repair loop, access reinforcement, revision
(supersedes / contradicts), abstraction, NPMI association (Hebbian ranking opt-in),
decay-based archiving and PROV-O provenance — on an RDF / OWL 2 RL / SHACL / PROV-O memory.

**Live: <https://benjaminnavet.github.io/kgmemory-demo/>** — or open `index.html` in a browser and step through with the › button or the arrow keys.

This is a **static mock-up replaying recorded steps**: there is no live backend, LLM or
triple store behind the page.

It accompanies the ISWC 2026 Doctoral Consortium paper *Knowledge Graphs as External
Memory for LLM-based Scientific Assistants* (Benjamin Navet) —
HAL: <https://hal.science/hal-05747244>.
