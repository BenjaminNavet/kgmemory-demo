/* KGmemory glass box — renders the recordings in window.KGDEMO (see data/runs.js).
   No artefact is typed here: every number, query, triple and sentence of the store comes from the data file. */
(function () {
  "use strict";

  const DATA = window.KGDEMO;
  const meta = DATA.meta;
  const state = { level: "simple", question: 0, memory: null, showAll: false };

  // ---------- small helpers ----------
  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "html") node.innerHTML = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }
  const $ = (id) => document.getElementById(id);
  const fill = (id, ...children) => { const node = $(id); node.replaceChildren(...children.flat(Infinity).filter(Boolean)); return node; };
  const esc = (text) => String(text).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const num = (value) => Number(value).toLocaleString("en-US");
  const plural = (count, word, many) => `${num(count)} ${count === 1 ? word : (many || word + "s")}`;
  const ms = (value) => (value === null || value === undefined ? "" : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`);
  const shortDate = (iso) => {
    if (!iso) return "";
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  };
  const simple = (...children) => h("div", { class: "simple" }, ...children);
  const tech = (...children) => h("div", { class: "tech" }, ...children);
  const sub = (text) => h("div", { class: "sub" }, text);
  const p = (text, cls) => h("p", { class: cls || null }, text);

  // Light highlighter. RDF languages get keywords, IRIs, strings and comments; JSON gets strings;
  // anything else (the prompt block, a command) is shown as plain text. Everything is escaped first.
  const RDF_PATTERN = /(#[^\n]*$)|("""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*")|(<[^<>\s]*>)|\b(PREFIX|SELECT|CONSTRUCT|WHERE|FILTER|OPTIONAL|UNION|ORDER BY|GROUP BY|LIMIT|VALUES|BIND|NOT EXISTS|EXISTS|DISTINCT|GRAPH)\b/gm;
  const JSON_PATTERN = /()("(?:[^"\\\n]|\\.)*")/gm;
  function highlight(source, lang) {
    const pattern = lang === "sparql" || lang === "turtle" ? RDF_PATTERN : lang === "json" ? JSON_PATTERN : null;
    if (!pattern) return esc(source);
    let out = "";
    let last = 0;
    for (const match of source.matchAll(pattern)) {
      out += esc(source.slice(last, match.index));
      const cls = match[1] ? "cm" : match[2] ? "str" : match[3] ? "iri" : "kw";
      out += `<span class="${cls}">${esc(match[0])}</span>`;
      last = match.index + match[0].length;
    }
    return out + esc(source.slice(last));
  }
  const code = (text, lang, wrap) => h("pre", { class: "code" + (wrap ? " wrap-code" : ""), "data-lang": lang, tabindex: "0", html: highlight(text || "", lang) });
  const kv = (rows) => h("dl", { class: "kv" }, rows.filter((row) => row && row[1] !== null && row[1] !== undefined && row[1] !== "").map(([key, value]) => [h("dt", {}, key), h("dd", {}, value)]));
  const curie = (iri) => h("code", {}, iri);

  // ---------- reading level ----------
  function setLevel(level, remember) {
    state.level = level;
    document.body.dataset.level = level;
    document.querySelectorAll(".seg button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.level === level)));
    if (remember) { try { localStorage.setItem("kgdemo-level", level); } catch (error) { /* private mode: not remembered */ } }
  }

  // ---------- header ----------
  function renderHeader() {
    const corpus = meta.corpus;
    fill("stamp",
      h("span", { class: "dot", "aria-hidden": "true" }),
      h("span", {}, h("b", {}, "Recorded run"), ` · ${shortDate(meta.recorded_on)}`),
      h("span", { class: "tech" }, "commit ", h("code", {}, meta.commit)),
      h("span", {}, `${corpus.name} ${corpus.item}: ${corpus.speakers.join(" & ")}, ${corpus.sessions} sessions`));
    const counts = meta.counts;
    const tile = (value, label) => h("div", { class: "tile" }, h("b", {}, num(value)), h("span", {}, label));
    fill("tiles",
      tile(counts.memories, "memories written"),
      tile(counts.concepts, "concepts linking them"),
      tile(counts.segments, "conversation passages kept as sources"),
      tile(counts.activities_total, "recorded operations"));
    fill("ask-intro",
      `These memories were written by the real system while it read ${num(corpus.turns)} messages exchanged by ${corpus.speakers.join(" and ")} between ${corpus.span}, a conversation from the ${corpus.name} benchmark. The questions are the benchmark's own.`);
  }

  // ---------- 1. Ask ----------
  function renderQuestions() {
    fill("questions", DATA.questions.map((question, index) =>
      h("button", {
        type: "button", class: "q", role: "radio", "aria-checked": String(index === state.question),
        onclick: () => selectQuestion(index, true),
      }, h("span", { class: "n" }, index + 1), h("span", {}, question.text, question.tag ? h("small", {}, question.tag) : null))));
  }

  function renderAnswers(question) {
    const withMemory = h("div", { class: "answer with" },
      h("h3", {}, "With KGmemory",
        VERDICTS[question.verdict] ? h("span", { class: "verdict " + question.verdict }, VERDICTS[question.verdict]) : null),
      p(question.answer_with),
      h("div", { class: "ref" }, h("b", {}, "Benchmark reference: "), question.reference,
        question.note ? h("div", { class: "refnote" }, question.note) : null));
    const without = h("div", { class: "answer" },
      h("h3", {}, "Same model, no memory"),
      p(question.answer_without));
    fill("answers", without, withMemory);
  }

  function memoryButton(memoryId, verbatim) {
    const memory = DATA.memories[memoryId];
    if (!memory) return null;
    return h("button", {
      type: "button", class: "mem", "data-mem": memoryId, "aria-current": String(memoryId === state.memory),
      onclick: () => selectMemory(memoryId, true),
    },
      memory.content,
      verbatim ? h("span", { class: "quote" }, `“${verbatim}”`) : null,
      h("span", { class: "meta" },
        h("span", { class: `badge ${memory.kind}` }, memory.kind),
        memory.said_on ? h("span", {}, `said ${shortDate(memory.said_on)}`) : null,
        memory.event_date ? h("span", {}, `about ${memory.event_date}`) : null));
  }

  function renderServed(question) {
    const total = question.served.length;
    const head = h("div", { class: "served-head" },
      h("h3", {}, "What the assistant was handed"),
      h("div", { class: "meter" }, `${plural(total, "memory", "memories")} · ${num(question.block_chars)} characters`));
    const lead = [
      h("p", { class: "note simple" }, `Before the model answers, KGmemory slips these ${total} memories into its prompt, grouped by topic and trimmed to a fixed size so the prompt stays small. The best ones carry the exact words that were said. Tap one to see where it comes from.`),
      h("p", { class: "note tech" }, `${total} statements packed under RETRIEVE_CONTEXT_BUDGET_CHARS = ${num(meta.budget_chars)}, grouped by subject, host render (no scores). Verbatim source excerpts are added for the head of the list. The Hermes provider wraps the block in <kgmemory>…</kgmemory> and injects it before the turn.`),
    ];
    const limit = state.showAll ? Infinity : 6;
    let shown = 0;
    const groups = [];
    for (const group of question.groups) {
      if (shown >= limit) break;
      const ids = group.memories.slice(0, limit - shown);
      shown += ids.length;
      groups.push(h("div", { class: "topic" }, h("h4", {}, `About: ${group.topic}`), h("div", { class: "memlist" }, ids.map((id) => memoryButton(id, question.quotes[id])))));
    }
    const toggle = total > 6 ? h("button", { type: "button", class: "more", onclick: () => { state.showAll = !state.showAll; renderServed(question); } },
      state.showAll ? "Show fewer" : `Show all ${total} memories`) : null;
    const raw = tech(h("div", { style: "margin-top:14px" }, sub("The block, verbatim"),
      h("p", { class: "note", style: "margin-bottom:8px" }, "The template of this deployment is written in French; the memories keep the language of the conversation."),
      code(question.block, "prompt injection", true)));
    fill("served", head, lead, groups, toggle, raw);
  }

  // ---------- 2. Read ----------
  function stage(number, name, duration, result, body, open) {
    return h("details", { class: "stage", open: open || null },
      h("summary", {},
        h("span", { class: "num" }, number),
        h("span", { class: "name" }, name, h("span", { class: "chev", "aria-hidden": "true" }, "›")),
        h("span", { class: "ms" }, ms(duration)),
        h("span", { class: "result" }, result)),
      h("div", { class: "body" }, body));
  }

  function conceptPill(topic) {
    return h("span", { class: "pill" }, topic.label,
      topic.score !== undefined && topic.score !== null ? h("span", { class: "score tech" }, Number(topic.score).toFixed(2)) : null,
      topic.match ? h("a", { href: topic.match.iri, rel: "noopener", target: "_blank", title: `Same thing as this ${topic.match.scheme} entry` }, `${topic.match.scheme} ↗`) : null);
  }

  const VERDICTS = { match: "matches the reference", trap: "avoids the trap", miss: "misses the reference" };

  const GATE_REASONS = {
    forced_empty_buffer: "nothing was in play yet in this conversation, so the long-term memory was searched for every topic",
    delta_retrieved: "most topics were already in play; only the new one was fetched from the long-term memory",
    covered: "the memories already in play cover the question, so the long-term memory was not searched again",
  };

  function bipartite(question, maxMemories) {
    const graph = question.graph;
    if (!graph.edges || !graph.edges.length) return null;
    const memories = [...new Set(graph.edges.map((edge) => edge[1]))].slice(0, maxMemories || Infinity);
    const edges = graph.edges.filter((edge) => memories.includes(edge[1]));
    const concepts = [...new Set(edges.map((edge) => edge[0]))];
    const rowHeight = 30, leftWidth = 150, rightX = 250, width = 640;
    const height = Math.max(concepts.length, memories.length) * rowHeight + 16;
    const y = (index, count) => 8 + (index + 0.5) * (height - 16) / count;
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Graph links from ${concepts.length} concepts to ${memories.length} memories`);
    const add = (name, attrs, text) => {
      const node = document.createElementNS(svgNS, name);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      if (text) node.textContent = text;
      svg.append(node);
      return node;
    };
    for (const [concept, memoryId] of edges) {
      const y1 = y(concepts.indexOf(concept), concepts.length), y2 = y(memories.indexOf(memoryId), memories.length);
      add("path", { d: `M${leftWidth} ${y1} C ${leftWidth + 50} ${y1}, ${rightX - 50} ${y2}, ${rightX} ${y2}`, fill: "none", stroke: "#6941eb", "stroke-opacity": "0.35", "stroke-width": "1.4" });
    }
    concepts.forEach((concept, index) => {
      const cy = y(index, concepts.length);
      add("rect", { x: 2, y: cy - 11, width: leftWidth - 4, height: 22, rx: 11, fill: "#f1edfd", stroke: "#d9cffa" });
      add("text", { x: leftWidth / 2, y: cy + 4, "text-anchor": "middle", "font-size": "12", fill: "#3d2a94", "font-weight": "600" }, concept.length > 20 ? concept.slice(0, 19) + "…" : concept);
    });
    memories.forEach((memoryId, index) => {
      const cy = y(index, memories.length);
      const memory = DATA.memories[memoryId];
      const label = memory ? memory.content : memoryId;
      add("rect", { x: rightX, y: cy - 11, width: width - rightX - 2, height: 22, rx: 5, fill: "#fff4e6", stroke: "#f0d9b8" });
      add("rect", { x: rightX, y: cy - 11, width: 4, height: 22, fill: "#b8661a" });
      add("text", { x: rightX + 10, y: cy + 4, "font-size": "12", fill: "#16242f" }, label.length > 58 ? label.slice(0, 57) + "…" : label);
    });
    return h("div", { class: "graph", "data-memories": memories.length }, svg);
  }

  // Concepts recognised in the question, best match first, one row per concept.
  function recognisedTopics(question) {
    const topics = question.topics;
    const recognised = [];
    for (const hit of topics.terms.filter((term) => term.kept).sort((a, b) => b.score - a.score)) {
      if (!recognised.some((row) => row.label === hit.label)) recognised.push(hit);
    }
    if (!recognised.length) topics.items.forEach((topic) => recognised.push({ term: topic.term, label: topic.label, score: topic.score }));
    return recognised;
  }

  // Where the candidates of the ranking stage come from. The bridge (memories filed under the other topics of the
  // best candidates) is traced as P1i_bridge and joins the pool before the reading model.
  function candidates(question) {
    const ranking = question.ranking;
    const bridge = (ranking.raw && ranking.raw.P1i_bridge && ranking.raw.P1i_bridge.admitted) || 0;
    return { graph: ranking.pool, meaning: ranking.admitted, bridge, total: ranking.fused + bridge, window: ranking.window, kept: ranking.kept };
  }

  // One sentence on what the working-memory gate did for this question.
  function gateSummary(question) {
    const gateEvent = question.gate.raw && question.gate.raw.P1f_gate;
    if (!gateEvent) return "Not engaged: this question was asked outside a conversation session";
    if (!gateEvent.should_retrieve) return `Nothing fetched: the memories in play already cover the ${gateEvent.topics} topics`;
    if (gateEvent.covered) return `${gateEvent.covered} of ${gateEvent.topics} topics already in play, ${gateEvent.topics - gateEvent.covered} fetched from long-term memory`;
    return `Empty buffer: all ${plural(gateEvent.topics, "topic")} fetched from long-term memory`;
  }

  function renderStages(question) {
    const { gate, topics, graph, ranking, packing, prov } = question;
    const stages = [];
    const gateEvent = gate.raw && gate.raw.P1f_gate;
    const working = gate.raw && gate.raw.P1g_working;

    // 1. Gate
    stages.push(stage(1, "Working-memory gate", null, gateSummary(question), [
      simple(p("The assistant keeps a short list of the memories already in play in the current conversation. A new question only sends it back to the long-term store for what that list does not cover.")),
      tech(p("The gate engages when the host passes a session id. It compares the query's topics with the session buffer (capacity 48, activation decaying at each turn) and fetches only the uncovered topics. The host receives the rendered buffer.")),
      gateEvent ? kv([
        ["Decision", gateEvent.should_retrieve ? "fetch from the long-term memory" : "serve from the session buffer"],
        ["Why", GATE_REASONS[gateEvent.reason] || gateEvent.reason],
        ["Topics of the question", gateEvent.topics],
        ["Already in play", gateEvent.covered],
        ["Buffer after this turn", working ? `${working.buffer_size} memories in play, ${working.evicted} left the buffer` : null],
      ]) : null,
      gate.raw ? tech(sub("Trace events"), code(JSON.stringify(gate.raw, null, 2), "json")) : null,
    ]));

    // 2. Topics
    const fetched = new Set(topics.items.map((topic) => topic.label));
    const matches = Object.fromEntries(topics.items.map((topic) => [topic.label, topic.match]));
    const recognised = recognisedTopics(question);
    const partial = recognised.some((row) => !fetched.has(row.label));
    stages.push(stage(2, "Topics", topics.ms, `${plural(recognised.length, "topic")} recognised: ${recognised.map((row) => row.label).join(", ")}`, [
      simple(p("The words of the question are compared, by meaning, with every concept the memory knows. The closest concepts become the entry points into the graph.")),
      tech(p(`The query and its terms are embedded (${meta.models.embedding}) and matched against the concept collection. A concept is kept at cosine ≥ ${topics.threshold}.`)),
      h("div", { class: "tablewrap" }, h("table", { class: "t" },
        h("thead", {}, h("tr", {}, h("th", {}, "In the question"), h("th", {}, "Concept in memory"), partial ? h("th", {}, "This turn") : null, h("th", { class: "tech" }, "Cosine"))),
        h("tbody", {}, recognised.map((row) => h("tr", {},
          h("td", {}, row.term ? `“${row.term}”` : "whole question"),
          h("td", {}, conceptPill({ label: row.label, match: matches[row.label] })),
          partial ? h("td", {}, fetched.has(row.label) ? "fetched" : "already in play") : null,
          h("td", { class: "num tech" }, row.score !== null && row.score !== undefined ? Number(row.score).toFixed(3) : "")))))),
      topics.items.some((topic) => topic.match) ? h("p", { class: "note" }, "A link next to a concept means it was aligned with Wikidata, so memories about the same thing meet on the same node whatever words were used.") : null,
      tech(sub("Trace event"), code(JSON.stringify(topics.raw, null, 2), "json")),
    ]));

    // 3. Graph
    stages.push(stage(3, "Graph query", graph.ms, `${num(graph.pool)} memories reached from those topics`, [
      simple(p("From each topic, the store follows the links of the graph to the memories filed under it and under closely related concepts, and keeps the most important ones.")),
      tech(p(`One SPARQL CONSTRUCT walks at most ${graph.hops} SKOS hops from the topics, reaches memories through dcterms:subject, skips archived, abstracted and superseded ones, and returns the ${graph.pool} best by importance. It returned ${num(graph.triples)} triples in ${ms(graph.construct_ms)}.`)),
      bipartite(question),
      graph.edges && graph.edges.length ? h("p", { class: "note" }, "Shown: the first memories served and the topics they are filed under.") : null,
      graph.sparql ? tech(sub("Query sent to the triple store"), code(graph.sparql, "sparql")) : null,
    ]));

    // 4. Ranking
    const rows = (ranking.rows || []).slice(0, 10);
    const pool = candidates(question);
    const funnel = [
      [pool.graph, "reached through the graph", null],
      [pool.meaning, "added because they are close in meaning", "+"],
      pool.bridge ? [pool.bridge, "added because they share a topic with the best ones", "+"] : null,
      [pool.total, "candidates", "="],
      [pool.window, "read against the question", "→"],
      [pool.kept, "kept", "→"],
    ].filter((step) => step && step[0] !== undefined && step[0] !== null);
    stages.push(stage(4, "Ranking", ranking.ms, `${num(pool.total)} candidates, ${num(pool.kept)} kept`, [
      simple(p("The graph is not the only way in: memories whose wording is close to the question are added too. All candidates are then ordered together by importance, recency and use, and the best are kept. A small reading model then compares the kept ones with the question, to put first those that bear on it.")),
      tech(p(`The graph pool is fused with a dense content channel (${num(ranking.content_hits)} hits, ${num(ranking.admitted)} new) by reciprocal rank fusion (k = ${ranking.rrf_k}), ordered by salience and topic affinity${pool.bridge ? `, joined by ${num(pool.bridge)} memories filed under the other topics of the best candidates (bridge)` : ""}, then a cross-encoder (${ranking.model}) scores a window of ${ranking.window} and elects ${ranking.kept}.`)),
      h("div", { class: "flow" }, funnel.flatMap((step, index) => [
        index ? h("span", { class: "arr", "aria-hidden": "true" }, step[2]) : null,
        h("span", { class: "box" }, num(step[0]), h("small", {}, step[1])),
      ])),
      rows.length ? h("div", { class: "tablewrap" }, h("table", { class: "t" },
        h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "Memory"), h("th", {}, "Found by"), h("th", { class: "tech" }, "Rank before"))),
        h("tbody", {}, rows.map((row, index) => h("tr", {},
          h("td", { class: "num" }, index + 1),
          h("td", {}, (DATA.memories[row.mem] || {}).content || row.mem),
          h("td", {}, row.via === "meaning" && pool.bridge ? "meaning or shared topic" : row.via),
          h("td", { class: "num tech" }, row.before))),
        ranking.kept > rows.length ? h("tr", { class: "cut" }, h("td", { colspan: "4" }, `and ${num(ranking.kept - rows.length)} more kept`)) : null))) : null,
      rows.length ? h("p", { class: "note tech" }, "“Rank before” is the position before the cross-encoder: it shows how far the reading model moved each memory.") : null,
      tech(sub("Trace events"), code(JSON.stringify(ranking.raw, null, 2), "json")),
    ]));

    // 5. Packing
    stages.push(stage(5, "Packing", packing.ms, `${num(packing.served)} memories written in ${num(question.block_chars)} characters`, [
      simple(p("The kept memories are written out as short lines grouped by topic. The first ones also carry the exact words from the conversation, so the model can rely on what was said rather than on a paraphrase.")),
      tech(p(`A Jinja template renders the statements under the character budget (${num(packing.budget)}). The head of the list gets an excerpt of its source passage (raw escalation and annex), which is why the block is longer than the budget.`)),
      kv([
        ["Memories written", packing.served],
        ["With the exact words said", packing.quotes],
        ["Size of the block", `${num(question.block_chars)} characters`],
      ]),
      tech(sub("Trace events"), code(JSON.stringify(packing.raw, null, 2), "json")),
    ]));

    // 6. Record
    stages.push(stage(6, "The recall is itself recorded", null, `Written to the graph as an operation that used ${prov.used} items`, [
      simple(p("Reading the memory leaves a trace too: which topics were used, which memories were served, and when. That is what lets someone check later why the assistant said something.")),
      tech(p("Each retrieval mints a mem:Retrieval activity (a prov:Activity) in its own named graph. It prov:used the topics and the served memories; a mem:Compression activity records the packing. kg-bridge explain replays both from the graph alone.")),
      kv([["Operation", curie(prov.iri)], ["Used", `${prov.used} topics and memories`], ["Whole recall", ms(question.ms)]]),
      prov.turtle ? tech(sub("The activity, as stored"), code(prov.turtle, "turtle")) : null,
    ]));

    fill("stages", stages);
  }

  // ---------- 3. Provenance ----------
  function link(number, title, what, ...box) {
    const content = box.flat().filter(Boolean);
    return h("div", { class: "link" },
      h("span", { class: "knob", "aria-hidden": "true" }, number),
      h("h3", {}, title),
      h("p", { class: "what" }, what),
      content.length ? h("div", { class: "box" }, content) : null);
  }

  function markQuote(text, quote) {
    if (!quote) return [text];
    const at = text.indexOf(quote);
    if (at < 0) return [text];
    return [text.slice(0, at), h("mark", {}, quote), text.slice(at + quote.length)];
  }

  function renderMemory() {
    const memory = DATA.memories[state.memory];
    if (!memory) { fill("memory", h("p", { class: "note" }, "No memory selected.")); return; }
    const segment = DATA.segments[memory.segment];
    const activity = DATA.activities[memory.activity] || {};
    const chain = [];

    if (memory.turns && memory.turns.length) {
      chain.push(link(1, "What was said",
        `The memory was written from this passage of the conversation${segment && segment.date ? ` (${segment.date})` : ""}. The highlighted words are the exact quote it is anchored to.`,
        h("div", { class: "turns" }, memory.turns.map((turn) => h("div", { class: "turn" }, h("b", {}, `${turn.speaker}: `), markQuote(turn.text, memory.quote)))),
        memory.turns_clipped ? h("p", { class: "note" }, `Excerpt: ${plural(memory.turns_clipped, "other message")} of this passage not shown.`) : null,
        tech(kv([["Passage", segment ? curie(segment.iri) : null], ["Anchor", memory.quote ? "oa:Annotation → oa:TextQuoteSelector (W3C Web Annotation)" : null]]))));
    }

    chain.push(link(2, "What the language model extracted",
      "A language model read that passage and proposed facts. It only writes text and labels: identifiers, links and types are produced by code, never by the model.",
      kv([
        ["Statement", memory.content],
        ["About", memory.subjects && memory.subjects.length ? h("span", { class: "pills" }, memory.subjects.map(conceptPill)) : null],
        ["Importance", memory.importance !== null ? Number(memory.importance).toFixed(2) : null],
        ["Kind of fact", memory.fact_kind],
        ["Relation", memory.predicate],
        ["Date of the event", memory.event_date],
        ["Question it answers", memory.cues && memory.cues.length ? memory.cues.join(" · ") : null],
      ]),
      tech(kv([["Model", activity.model], ["Prompt template", activity.template], ["Temperature", activity.temperature]]))));

    const shacl = memory.shacl;
    chain.push(link(3, "The check before writing",
      "Before anything is stored, the proposed facts are checked against a set of rules. A fact that breaks a rule is sent back to the model with the reason, and is never written as is.",
      h("div", { class: "callout " + (shacl.violations ? "bad" : "ok") },
        shacl.violations ? `${plural(shacl.violations, "violation")} on this memory.` : `This memory passes: 0 violations${shacl.warnings ? `, ${plural(shacl.warnings, "warning")} kept as audit signals` : ""}.`),
      h("p", { class: "note" }, meta.build.shacl_note),
      tech(p(`Re-validated at export time with the pipeline's validator (pyshacl, RDFS inference) against the ${meta.counts.shapes} node shapes. Only sh:Violation blocks a write; sh:Warning is an audit signal.`),
        kv([["Shapes targeting this node", shacl.shapes.join(", ")]]),
        code(shacl.report, "validation result"))));

    chain.push(link(4, "The memory in the graph",
      `It is stored as a small set of statements. Code typed it ${memory.kind} from the kind of fact, and filed it under its concepts.`,
      simple(kv([
        ["Type", memory.kind],
        ["Filed under", (memory.subjects || []).map((subject) => subject.label).join(", ")],
        ["Said on", shortDate(memory.said_on)],
        ["State", memory.state],
        ["Fades at rate", memory.decay_rate],
      ])),
      tech(kv([["IRI", curie(memory.iri)]]), code(memory.turtle, "turtle"))));

    chain.push(link(5, "The write is recorded",
      "Writing a memory is an operation with an author, a time and inputs. The memory points to that operation, and the operation points to the passage it read.",
      kv([
        ["Operation", activity.operation],
        ["When", activity.started ? activity.started.replace("T", " ").slice(0, 19) + " UTC" : null],
        ["Status", activity.status],
        ["Memories written by it", activity.generated],
      ]),
      tech(kv([["Activity", activity.iri ? curie(activity.iri) : null]]), activity.turtle ? code(activity.turtle, "turtle") : null)));

    if (memory.history && memory.history.length) {
      chain.push(link(6, "What the graph can answer about it",
        "Because all of this is in the graph, questions about a memory are answered by queries rather than by trusting a log.",
        h("dl", { class: "qa" }, memory.history.map((row) => [h("dt", {}, row.question), h("dd", {}, row.answer)]))));
    }

    fill("memory",
      h("div", { class: "selected-mem" }, p(memory.content),
        h("span", { class: "meta" }, h("span", { class: `badge ${memory.kind}` }, memory.kind))),
      h("div", { class: "chain" }, chain));
  }

  // ---------- 4. Later ----------
  const PASSES = {
    revision: {
      title: "Revision",
      simple: "When someone says something that replaces an earlier fact, the old memory is not erased: it is marked as replaced by the new one, and stops being served.",
      technical: "Offline pass over pairs of memories that share a subject and can be ordered in time. An LLM answers SUPERSEDES, DUPLICATE or INDEPENDENT; code picks the winner by date, the edge is SHACL-gated, then mem:supersedes is written and the older memory becomes Superseded.",
    },
    contradiction: {
      title: "Contradiction detection",
      simple: "Two lasting facts that cannot both be true are flagged, so a person can settle the matter. Nothing is changed automatically.",
      technical: "Semantic memories only. Symmetric mem:contradicts edges; detection only, no state change.",
    },
    forgetting: {
      title: "Forgetting",
      simple: "A memory that is never used fades. Below a threshold it is archived: kept, but no longer served unless someone digs for it. Being recalled makes a memory last longer.",
      technical: "Retention R = importance · exp(−Δt · rate / (F̂ + 1)): Δt in days since the last access (or since the write), a decay rate per kind of memory, F̂ the normalised access frequency. R is written as mem:relevanceScore. Below the threshold the state goes Active → Archived with prov:invalidatedAtTime; nothing is deleted.",
    },
    abstraction: {
      title: "Abstraction",
      simple: "Several memories about the same thing over the same period are condensed into one summary. The summary points to the memories it was built from.",
      technical: "Groups of Active memories sharing a subject and an utterance window are summarized by an LLM into a mem:AbstractedMemory (a subclass of mem:SemanticMemory), linked by prov:wasDerivedFrom to its sources.",
    },
    associations: {
      title: "Associations between concepts",
      simple: "Concepts that keep appearing together become linked, so asking about one can lead to memories filed under the other.",
      technical: "Co-occurrence seeds a mem:Association at 0.1; above 0.3 it is projected as skos:related, which the graph query follows. Associations decay and are pruned.",
    },
  };

  function renderMaintenance() {
    const cards = DATA.maintenance.map((pass) => {
      const prose = PASSES[pass.key] || { title: pass.key, simple: "", technical: "" };
      return h("div", { class: "op", "data-pass": pass.key },
        h("h3", {}, prose.title),
        h("p", { class: "simple" }, prose.simple),
        h("p", { class: "tech" }, prose.technical),
        h("div", { class: "callout" }, h("b", {}, "On this store: "), pass.outcome),
        pass.facts && pass.facts.length ? kv(pass.facts) : null,
        (pass.pairs || []).map((pair) => h("div", { class: "pair" },
          h("div", { class: "old" }, pair.old, pair.old_date ? h("span", { class: "note" }, ` (${shortDate(pair.old_date)})`) : null),
          h("div", { class: "arrow" }, `↓ ${pair.relation}`),
          h("div", {}, pair.new, pair.new_date ? h("span", { class: "note" }, ` (${shortDate(pair.new_date)})`) : null))),
        (pass.examples || []).length ? h("div", { class: "memlist" }, pass.examples.map((example) => h("div", { class: "mem", style: "cursor:default" }, example.text, example.note ? h("span", { class: "meta" }, example.note) : null))) : null,
        pass.command ? tech(code(pass.command, "command")) : null);
    });
    fill("maintenance", cards);
  }

  // ---------- 5. Store ----------
  function renderStore() {
    const counts = meta.counts;
    const corpus = meta.corpus;
    fill("store-intro", `No fact, query or statement shown on this page was typed by hand. The store was built by running the system on the conversation, and an export script read everything back from it.`);
    const activities = Object.entries(counts.activities).sort((a, b) => b[1] - a[1]);
    const max = Math.max(...activities.map((entry) => entry[1]));
    const operations = h("div", { class: "op" },
      h("h3", {}, "Every operation is in the graph"),
      h("p", { class: "simple" }, "Writing, indexing, recalling, revising and forgetting are all recorded as operations. This is the count for this store."),
      h("p", { class: "tech" }, "Count of prov:Activity by mem: class. Every mutation goes through one wrapper that mints the activity into a tier-scoped named graph."),
      h("div", { class: "bars" }, activities.map(([name, count]) => h("div", { class: "row" }, h("span", {}, name), h("i", { style: `width:${Math.max(1, (100 * count) / max).toFixed(1)}%` }), h("b", {}, num(count))))));
    const contents = h("div", { class: "op" },
      h("h3", {}, "Contents"),
      kv([
        ["Memories", `${num(counts.memories)} (${num(counts.episodic)} episodic, ${num(counts.semantic)} semantic${counts.abstracted ? `, ${num(counts.abstracted)} summaries` : ""})`],
        ["Concepts", `${num(counts.concepts)}, of which ${num(counts.aligned)} aligned with Wikidata`],
        ["Source passages", `${num(counts.segments)}, with ${num(counts.anchors)} quote anchors`],
        ["Concept associations", num(counts.associations)],
        ["Statements (quads)", num(counts.quads)],
        ["Validation rules", `${counts.shapes} SHACL shapes`],
      ]));
    const build = h("div", { class: "op" },
      h("h3", {}, "How it was built"),
      kv([
        ["Conversation", h("span", {}, h("a", { href: corpus.url, rel: "noopener", target: "_blank" }, `${corpus.name} ${corpus.item}`), `, ${corpus.sessions} sessions, ${num(corpus.turns)} messages`)],
        ["Past", meta.build.past],
        ["Present", meta.build.present],
        ["Extraction model", meta.models.extraction],
        ["Answers on this page", meta.models.answer],
        ["Embeddings", meta.models.embedding],
        ["Code", h("span", {}, "commit ", h("code", {}, meta.commit), ` (${shortDate(meta.commit_date)})`)],
      ]),
      tech(sub("Settings in force"), kv(meta.settings.map((setting) => [h("code", {}, setting.name), String(setting.value)]))));
    const hosts = h("div", { class: "op" },
      h("h3", {}, "How an assistant plugs in"),
      h("p", { class: "simple" }, "The memory runs next to the assistant as a small local service. The assistant asks it for memories before answering and hands it the conversation afterwards."),
      h("p", { class: "tech" }, "A Python sidecar speaking MCP over stdio. A host either calls the tools itself, or a provider drives recall before the turn and storage after it."),
      h("div", { class: "tools" }, meta.tools.map((tool) => h("code", {}, tool))),
      h("p", { class: "note" }, "Triple store: Apache Jena Fuseki. Vector index: Qdrant. Standards: RDF, OWL 2 RL, SKOS, SHACL, PROV-O, OWL-Time, Web Annotation."));
    fill("storegrid", contents, operations, build, hosts);
    fill("credits", `Conversation data: ${corpus.name} (Maharana et al., 2024), licence ${corpus.licence}, shown here for research and teaching. `,
      `Answers generated by ${meta.models.answer}; they can be wrong, and the benchmark reference is shown next to each one.`);
  }

  // ---------- selection ----------
  function selectMemory(memoryId, scroll) {
    state.memory = memoryId;
    document.querySelectorAll(".mem[data-mem]").forEach((button) => button.setAttribute("aria-current", String(button.dataset.mem === memoryId)));
    renderMemory();
    if (scroll) $("provenance").scrollIntoView({ block: "start" });
  }

  function selectQuestion(index, userAction) {
    state.question = index;
    state.showAll = false;
    const question = DATA.questions[index];
    document.querySelectorAll(".q").forEach((button, position) => button.setAttribute("aria-checked", String(position === index)));
    state.memory = question.served[0] || null;
    renderAnswers(question);
    renderServed(question);
    renderStages(question);
    renderMemory();
    if (userAction) {
      try { history.replaceState(null, "", `#q${index + 1}`); } catch (error) { /* file:// in some browsers */ }
      // On a phone the six questions fill the screen: bring the answer into view.
      if (window.innerWidth < 720) $("answers").scrollIntoView({ block: "start" });
    }
  }

  // ---------- boot ----------
  document.querySelectorAll(".seg button").forEach((button) => button.addEventListener("click", () => setLevel(button.dataset.level, true)));
  let level = "simple";
  try { level = localStorage.getItem("kgdemo-level") || level; } catch (error) { /* storage unavailable */ }
  if (new URLSearchParams(location.search).get("level") === "technical") level = "technical";
  setLevel(level === "technical" ? "technical" : "simple", false);
  renderHeader();
  renderQuestions();
  renderMaintenance();
  renderStore();
  // "#q5" selects a question; "#q5-3" also names a beat of the presenter mode (read by present.js).
  const fromHash = /^#q(\d+)(?:-\d+)?$/.exec(location.hash);
  const start = fromHash ? Math.min(DATA.questions.length, Math.max(1, Number(fromHash[1]))) - 1 : 0;
  selectQuestion(start, false);

  // Shared with present.js, which renders the same recordings on a 16:9 canvas.
  window.KGAPP = {
    DATA, meta, state, h, num, plural, ms, shortDate, code, kv, conceptPill, bipartite, markQuote,
    recognisedTopics, gateSummary, candidates, VERDICTS, PASSES, setLevel, selectQuestion,
  };
})();
