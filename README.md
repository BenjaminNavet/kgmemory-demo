# KGmemory — Glass-Box Memory (demo)

A scripted, self-contained walk-through of a knowledge-graph memory for an LLM-based
scientific assistant. Over 10 steps it replays the store-and-retrieve loop on five example
memories about glucose: concept resolution, SPARQL retrieval and verbalization into a
`<kgmemory>` context block, schema-guided extraction, SHACL validation with a bounded
repair loop, PROV-O provenance, association and forgetting — on an RDF / OWL 2 RL /
SHACL / PROV-O memory.

**Live: <https://benjaminnavet.github.io/kgmemory-demo/>** — or open `index.html` in a browser and step through with the › button or the arrow keys.

This is a **static mock-up replaying recorded steps**: there is no live backend, LLM or
triple store behind the page.

It accompanies the ISWC 2026 Doctoral Consortium paper *Knowledge Graphs as External
Memory for LLM-based Scientific Assistants* (Benjamin Navet) —
HAL: <https://hal.science/hal-05747244>.
