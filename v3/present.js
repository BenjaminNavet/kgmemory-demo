/* KGmemory glass box — presenter mode.
   How KGmemory works, in five beats on a fixed 1920×1080 canvas, for a shared screen: an overview, the three
   steps (write, find, answer) followed on one LoCoMo question, and the result. Each beat has one headline in plain
   words, one lede that gives the context or the definitions needed, and one picture or diagram. Keyboard driven,
   no scrolling, no animation. Headlines and ledes are narration; every number, sentence and identifier still
   comes from window.KGDEMO. Design: docs/superpowers/specs/2026-11-22-kgmemory-demo-v3-presenter-design.md */
(function () {
  "use strict";

  const APP = window.KGAPP;
  if (!APP) return;
  const { DATA, meta, h, num, plural, ms, shortDate } = APP;

  const CANVAS = { width: 1920, height: 1080 };
  const WORDS_PER_MINUTE = 115; // a speaker on a video call, not reading at full speed
  const PAUSE_SECONDS = 2; // the cut between two beats
  const HALO_IDLE_MS = 2500;
  const MOVE_GUARD_MS = 400; // a remote that sends the key twice must not skip a beat
  const DEMO_URL = ["benjaminnavet.github.io", "/kgmemory-demo"];
  const tour = { active: false, question: 0, beat: 0, clock: false, startedAt: null, ticker: null, haloTimer: null, lastMove: -Infinity, guardMs: MOVE_GUARD_MS, left: null };

  // ---------- small helpers ----------
  const clip = (text, max) => {
    const clean = String(text || "").trim();
    if (clean.length <= max) return clean;
    const cut = clean.slice(0, max - 1);
    const space = cut.lastIndexOf(" ");
    return cut.slice(0, space > max - 24 ? space : cut.length).trimEnd() + "…";
  };
  const words = (text) => String(text).trim().split(/\s+/).filter(Boolean).length;
  const spokenSeconds = (text) => Math.ceil((words(text) / WORDS_PER_MINUTE) * 60) + PAUSE_SECONDS;
  const tech = (...children) => h("div", { class: "tech" }, ...children);
  const setting = (name) => ((meta.settings || []).find((row) => row.name === name) || {}).value;
  // "*term*" in a sentence marks a term being defined: set in bold on the canvas, read plain everywhere else.
  const rich = (text) => String(text).split(/\*([^*]+)\*/).map((part, index) => (index % 2 ? h("b", {}, part) : part));
  const plain = (text) => String(text || "").replace(/\*/g, "");

  // The memory followed from what was said to the answer: the first served one whose anchored quote is found verbatim in its passage.
  function spotlight(question) {
    const hasQuote = (id) => {
      const memory = DATA.memories[id];
      return memory && memory.quote && (memory.turns || []).some((turn) => turn.text.includes(memory.quote));
    };
    return DATA.memories[question.served.find(hasQuote) || question.served[0]];
  }

  // The passage around the anchored quote: [before, <mark>quote</mark>, after], trimmed on word boundaries.
  function excerpt(text, quote, radius) {
    const at = quote ? text.indexOf(quote) : -1;
    if (at < 0) return [clip(text, radius * 2)];
    let start = Math.max(0, at - radius);
    let end = Math.min(text.length, at + quote.length + radius);
    if (start > 0) start = text.indexOf(" ", start) + 1;
    if (end < text.length) end = Math.max(text.lastIndexOf(" ", end), at + quote.length);
    return [(start > 0 ? "… " : "") + text.slice(start, at), h("mark", {}, quote), text.slice(at + quote.length, end) + (end < text.length ? " …" : "")];
  }

  // ---------- drawing helpers ----------
  const SVG_NS = "http://www.w3.org/2000/svg";
  function s(tag, attrs, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value);
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const COLOURS = { graph: "#6941eb", shared: "#b79cf7", ink: "#00284b", memory: "#b8661a", grey: "#7a8490" };

  // Line icons on a 48 × 48 grid, drawn in the current colour: [tag, attributes] per stroke.
  const DOT = { fill: "currentColor" };
  const ICONS = {
    chat: [["path", { d: "M8 12a5 5 0 0 1 5-5h22a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H22l-9 8v-8a5 5 0 0 1-5-5z" }]],
    graph: [["path", { d: "M15 30 21.5 17M33 30 26.5 17M17.5 34h13" }], ["circle", { cx: 12, cy: 34, r: 5.5 }], ["circle", { cx: 36, cy: 34, r: 5.5 }], ["circle", { cx: 24, cy: 12, r: 5.5 }]],
    check: [["circle", { cx: 24, cy: 24, r: 17 }], ["path", { d: "M15.5 24.5 21.5 30.5 33 18" }]],
    pen: [["path", { d: "M9 39l3-11L31 9l8 8-19 19z" }], ["path", { d: "M27 13l8 8" }]],
    search: [["circle", { cx: 21, cy: 21, r: 12 }], ["path", { d: "M30 30l10 10" }], ["circle", { cx: 21, cy: 21, r: 1.5, ...DOT }]],
  };
  const icon = (name, size) => s("svg", { viewBox: "0 0 48 48", width: size || 48, height: size || 48, class: "dicon", fill: "none", stroke: "currentColor",
    "stroke-width": "3.4", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, ICONS[name].map(([tag, attrs]) => s(tag, attrs)));

  // ---------- pictures ----------
  // A person as a plain silhouette on a coloured disc: no likeness is claimed.
  let clipCount = 0;
  function avatar(colour, size) {
    const id = `dclip${(clipCount += 1)}`;
    return s("svg", { viewBox: "0 0 120 120", width: size, height: size, class: "davatar", "aria-hidden": "true" },
      s("defs", {}, s("clipPath", { id }, s("circle", { cx: 60, cy: 60, r: 58 }))),
      s("circle", { cx: 60, cy: 60, r: 58, fill: colour }),
      s("g", { "clip-path": `url(#${id})`, fill: "#fff" }, s("circle", { cx: 60, cy: 47, r: 21 }), s("path", { d: "M16 124c2-32 20-46 44-46s42 14 44 46z" })));
  }
  const speakerColour = (name) => (meta.corpus.speakers.indexOf(name) === 1 ? COLOURS.memory : COLOURS.ink);

  // The assistant; with its memory it carries a small graph.
  function robot(withMemory, size) {
    const line = withMemory ? COLOURS.ink : COLOURS.grey;
    const stroke = { fill: "#fff", stroke: line, "stroke-width": 7, "stroke-linejoin": "round" };
    return s("svg", { viewBox: "0 0 170 170", width: size, height: size, class: "drobot", "aria-hidden": "true" },
      s("path", { d: "M80 36V20", stroke: line, "stroke-width": 7, "stroke-linecap": "round" }),
      s("circle", { cx: 80, cy: 15, r: 9, fill: withMemory ? "#ffeb6e" : "#fff", stroke: line, "stroke-width": 6 }),
      s("path", { d: "M54 118v12a12 12 0 0 0 12 12h28a12 12 0 0 0 12-12v-12", ...stroke }),
      s("rect", { x: 8, y: 62, width: 20, height: 32, rx: 8, fill: line }),
      s("rect", { x: 132, y: 62, width: 20, height: 32, rx: 8, fill: line }),
      s("rect", { x: 24, y: 36, width: 112, height: 84, rx: 26, ...stroke }),
      s("circle", { cx: 59, cy: 72, r: 10, fill: line }), s("circle", { cx: 101, cy: 72, r: 10, fill: line }),
      s("path", { d: withMemory ? "M62 96q18 12 36 0" : "M64 99h32", fill: "none", stroke: line, "stroke-width": 6, "stroke-linecap": "round" }),
      withMemory ? [
        s("circle", { cx: 132, cy: 132, r: 34, fill: "#fff", stroke: COLOURS.graph, "stroke-width": 6 }),
        s("path", { d: "M118 144 132 116 148 142z", fill: "none", stroke: COLOURS.graph, "stroke-width": 4 }),
        s("circle", { cx: 132, cy: 116, r: 8, fill: COLOURS.graph }), s("circle", { cx: 118, cy: 144, r: 7, fill: COLOURS.memory }), s("circle", { cx: 148, cy: 142, r: 7, fill: COLOURS.memory }),
      ] : null);
  }

  // A pictogram of a graph of memories (orange) around concepts (purple); with "picked", a few memories stand out
  // and the others fade. Not data.
  function clusterPicture(picked) {
    const concepts = [[150, 108], [64, 58], [240, 62], [228, 170]];
    const memories = [[108, 66, 0, 1], [28, 112, 1], [88, 138, 0, 1], [150, 190, 0], [196, 104, 0, 2], [272, 118, 2, 3], [196, 30, 2], [184, 204, 3, 0], [284, 196, 3], [22, 38, 1], [112, 14, 1], [62, 196, 0]];
    const chosen = (index) => picked && index % 3 === 0;
    const faded = picked ? 0.3 : null;
    return s("svg", { viewBox: "0 0 300 220", class: "dcluster", "aria-hidden": "true" },
      memories.map(([x, y, ...linked], index) => linked.map((at) => s("path", { d: `M${x} ${y}L${concepts[at][0]} ${concepts[at][1]}`, stroke: COLOURS.shared, "stroke-width": 3, opacity: chosen(index) ? null : faded }))),
      memories.map(([x, y], index) => s("circle", { cx: x, cy: y, r: chosen(index) ? 14 : 11, fill: chosen(index) ? "#ffeb6e" : "#f6c98b", stroke: COLOURS.memory, "stroke-width": chosen(index) ? 5 : 3, opacity: chosen(index) ? null : faded })),
      concepts.map(([x, y], index) => s("circle", { cx: x, cy: y, r: index ? 17 : 22, fill: COLOURS.graph, opacity: faded && 0.55 })));
  }

  // ---------- what the recording says ----------
  // The first sentence of a recorded answer, set apart so that it can be emphasised: [lead, rest].
  function leadSentence(text) {
    const stop = text.search(/[.!?](\s|$)/);
    return stop < 0 ? [text, ""] : [text.slice(0, stop + 1), text.slice(stop + 1)];
  }

  // The memories given to the model, counted, never assumed.
  function served(question) {
    const memories = question.served.map((id) => DATA.memories[id]).filter(Boolean);
    const count = (test) => memories.filter(test).length;
    return {
      total: question.served.length,
      quoted: count((memory) => memory.quote && (memory.turns || []).some((turn) => turn.text.includes(memory.quote))),
      passed: count((memory) => memory.shacl && memory.shacl.violations === 0),
      recorded: count((memory) => Boolean(DATA.activities[memory.activity])),
      fromGraph: (question.ranking.rows || []).filter((row) => row.via === "graph").length,
    };
  }
  const share = (part, whole) => (part === whole ? `all ${num(whole)}` : `${num(part)} of the ${num(whole)}`);
  const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
  const stampLine = () => `Recording of ${shortDate(meta.recorded_on)}: nothing runs live · Data: ${meta.corpus.name} benchmark, conversation of ${meta.corpus.speakers.join(" and ")}`;

  // Where the candidates and the kept memories came from. The recording tells which kept memories were in the pool of
  // the graph query; those added through a shared topic are counted but not listed, so the share found by meaning is
  // exact only when that count is zero or when every candidate was kept. Never say more than this.
  function origins(question) {
    const pool = APP.candidates(question);
    const keptGraph = served(question).fromGraph;
    const keptShared = Math.min(pool.bridge, pool.kept - keptGraph);
    const keptMeaning = Math.max(0, pool.kept - keptGraph - keptShared);
    const allKept = pool.total <= pool.kept;
    return { pool, keptGraph, keptShared, keptMeaning, allKept, exact: pool.bridge === 0 || allKept };
  }

  // ---------- step 1, write: what was said, the memory written from it, the concepts it is filed under ----------
  // Fixed geometry on a 1728 × 400 stage: the boxes are HTML, the edges are drawn under them.
  const WRITE = { height: 400, said: { left: 0, width: 590 }, memory: { left: 740, top: 55, width: 540, height: 290 }, about: { left: 1420, width: 308, height: 76, pitch: 92 } };
  function writeDiagram(memory, quoteTurn, speaker) {
    const about = (memory.subjects || []).slice(0, 3);
    const middle = WRITE.memory.top + WRITE.memory.height / 2;
    const saidRight = WRITE.said.left + WRITE.said.width, right = WRITE.memory.left + WRITE.memory.width;
    const aboutY = (index) => middle + (index - (about.length - 1) / 2) * WRITE.about.pitch;
    const edge = (d) => s("path", { class: "dprov-edge", d, "marker-end": "url(#dtip)" });
    return h("div", { class: "dprov" },
      s("svg", { viewBox: `0 0 1728 ${WRITE.height}`, class: "dprov-edges", "aria-hidden": "true" },
        s("defs", {}, s("marker", { id: "dtip", viewBox: "0 0 12 12", refX: 9, refY: 6, markerWidth: 5, markerHeight: 5, orient: "auto" }, s("path", { d: "M1 1 11 6 1 11z", fill: COLOURS.ink }))),
        edge(`M${saidRight + 10} ${middle}H${WRITE.memory.left - 12}`),
        about.map((_, index) => edge(`M${right} ${middle} C ${right + 70} ${middle}, ${WRITE.about.left - 70} ${aboutY(index)}, ${WRITE.about.left - 10} ${aboutY(index)}`)),
        s("text", { class: "dprov-name", x: (saidRight + WRITE.memory.left) / 2, y: middle - 20, "text-anchor": "middle" }, "written as"),
        about.length ? s("text", { class: "dprov-head", x: WRITE.about.left + WRITE.about.width / 2, y: aboutY(0) - WRITE.about.height / 2 - 20, "text-anchor": "middle" }, about.length === 1 ? "Its concept" : "Its concepts") : null),
      h("div", { class: "dnode said", style: `left:${WRITE.said.left}px;top:${middle}px;width:${WRITE.said.width}px` },
        h("div", { class: "dwho" }, avatar(speakerColour(speaker), 64), h("span", {}, speaker ? `${speaker} said` : "Said"), h("small", {}, shortDate(memory.said_on))),
        h("p", {}, quoteTurn ? excerpt(quoteTurn.text, memory.quote, 30) : memory.quote)),
      h("div", { class: "dnode memory", style: `left:${WRITE.memory.left}px;top:${WRITE.memory.top}px;width:${WRITE.memory.width}px;height:${WRITE.memory.height}px` },
        h("div", { class: "dwho" }, icon("graph", 52), h("span", {}, "Memory")),
        h("p", {}, memory.content)),
      about.map((subject, index) => h("div", { class: "dnode about", style: `left:${WRITE.about.left}px;top:${aboutY(index) - WRITE.about.height / 2}px;width:${WRITE.about.width}px;height:${WRITE.about.height}px` }, h("span", {}, clip(subject.label, 34)))));
  }

  // ---------- step 2, find: the question, the memories of the store, the ones handed to the model ----------
  const MAX_NAMED_CONCEPTS = 3; // concepts of the question named on the canvas
  const SHOWN_MEMORIES = 3; // memories handed to the model that are written out; the others are counted
  const flowArrow = () => h("div", { class: "dflow-arrow", "aria-hidden": "true" }, s("svg", { viewBox: "0 0 64 44" }, s("path", { d: "M4 22H56M38 6 58 22 38 38" })));
  // One square per memory of the store: the ones handed to the model, the others considered for this question, the
  // rest. The squares are counts, not positions.
  function findDiagram(question, asked) {
    const everything = meta.counts.memories, kept = question.served.length;
    const considered = Math.max(0, APP.candidates(question).total - kept), rest = Math.max(0, everything - kept - considered);
    const first = question.served.slice(0, SHOWN_MEMORIES).map((id) => DATA.memories[id]).filter(Boolean);
    const key = (cls, count, label) => (count ? h("span", {}, h("i", { class: cls }), h("b", {}, num(count)), label) : null);
    return h("div", { class: "dfind" },
      h("div", { class: "dfind-box ask" },
        h("div", { class: "dwho" }, avatar("#5a6b7b", 60), h("span", {}, "The question")),
        h("p", { class: "dfind-q" }, question.text),
        asked.length ? [h("p", { class: "dfind-label" }, asked.length === 1 ? "Concept found in it:" : "Concepts found in it:"),
          h("div", { class: "dfind-pills" }, asked.map((label) => h("span", { class: "ppill" }, label)))] : null),
      flowArrow(),
      h("div", { class: "dfind-box store" },
        h("div", { class: "dwho" }, icon("graph", 52), h("span", {}, `The ${num(everything)} memories`)),
        h("div", { class: "dsquares", "aria-hidden": "true" }, Array.from({ length: everything }, (_, index) => h("i", { class: index < kept ? "kept" : index < kept + considered ? "seen" : "" }))),
        h("div", { class: "dfind-key" }, key("kept", kept, "handed to the model"), key("seen", considered, "also considered"), key("", rest, "left aside"))),
      flowArrow(),
      h("div", { class: "dfind-box kept" },
        h("div", { class: "dwho" }, robot(true, 60), h("span", {}, "Handed to the model")),
        first.map((memory) => h("p", { class: "dfind-card" }, h("span", {}, memory.content))),
        kept > first.length ? h("p", { class: "dfind-more" }, `… and ${num(kept - first.length)} more`) : null));
  }

  // ---------- answers ----------
  const knowsAlone = (item) => !/\b(don't|do not) know\b/i.test(item.answer_without);
  const MARKS = { unknown: "?", match: "✓", trap: "✓", miss: "✕" };
  const mark = (kind) => h("span", { class: "dmark " + kind, "aria-hidden": "true" }, MARKS[kind]);

  // ---------- the five beats: how KGmemory works, on one LoCoMo question ----------
  // An overview, the three steps (write, find, answer) and the result. scope "demo" beats are the same whatever the
  // question; scope "question" beats follow the question shown, which keys 1 to 6 change without leaving the beat.
  // A beat is a headline (one fact, in plain words), a lede (the context and the definitions needed to read the
  // picture: "*term*" marks a term being defined) and the picture.

  // What a viewer needs and the recording does not carry: what the benchmark is (Maharana et al., 2024), and how the
  // questions shown were chosen (twelve were recorded, the only miss among them; six were kept, one per kind).
  const BENCHMARK = { authors: "Maharana et al.", year: 2024, recorded: 12 };
  const VERDICT_WORDS = { match: "right answer", trap: "trap avoided", miss: "missed" };
  const VERDICT_SENTENCES = { match: "same as the expected answer", trap: "does not fall for the trap", miss: "misses the expected answer" };

  function buildBeats(question) {
    const total = question.served.length;
    const corpus = meta.corpus, counts = meta.counts;
    const everyone = DATA.questions;
    const people = corpus.speakers.join(" and ");
    const limit = setting("RETRIEVE_K") || Math.max(...everyone.map((item) => item.served.length));
    const memory = spotlight(question);
    const activity = DATA.activities[memory.activity] || {};
    const quoteTurn = (memory.turns || []).find((turn) => memory.quote && turn.text.includes(memory.quote)) || (memory.turns || [])[0];
    const speaker = quoteTurn && /^[A-Za-z]/.test(quoteTurn.speaker) ? quoteTurn.speaker : null;
    // The note of the recording, in the words of the tour: "the memory" for the store, "handed to the model" for served.
    const note = (question.note || "").replace(/^Missed\.\s*/, "").replace(/\bstore\b/g, "memory").replace(/\bserved\b/g, "handed to the model");
    const aloneUnknown = !knowsAlone(question);
    const beats = [];
    const add = (beat) => beats.push({ ...beat, seconds: spokenSeconds(beat.say) });

    // Counts over every recorded question.
    const tally = (verdict) => everyone.filter((item) => item.verdict === verdict).length;
    const matches = tally("match"), traps = tally("trap"), misses = tally("miss");
    const aloneAnswered = everyone.filter(knowsAlone).length;
    const alone = aloneAnswered ? num(aloneAnswered) : "none";
    const few = (count, one, many) => (count === 1 ? `one ${one}` : `${num(count)} ${many}`);
    const months = (span) => span.replace(" and ", " to ").replace(/([A-Z][a-z]{2})[a-z]+ (\d{4})/g, "$1 $2");

    // 1. Overview: what KGmemory is, the data it is shown on, and the three steps the next beats take one by one.
    const card = (cls, number, title, picture, big, label) => h("div", { class: "dstep " + cls },
      h("div", { class: "dstep-top" }, number ? h("b", {}, number) : null, h("span", {}, title)),
      h("div", { class: "dpicture" }, picture), h("div", { class: "dcount" }, h("b", {}, big), h("span", {}, label)));
    const chatPicture = () => h("div", { class: "dchat" }, [0, 1, 0].map((who, row) => h("div", { class: "dturn" + (who ? " right" : "") },
      avatar(speakerColour(corpus.speakers[who]), 52), h("span", { class: "dlines" }, h("i", {}), row === 1 ? null : h("i", { class: "short" })))));
    add({
      id: "overview", step: "Overview", scope: "demo", anchor: "store", focus: ".dsteps",
      headline: "KGmemory gives an AI assistant a memory, in three steps",
      lede: `We show it on *${corpus.name}*, a public research benchmark (${BENCHMARK.year}) that tests whether an assistant remembers long conversations: one conversation between two fictional people, ${people}, then questions about it, each with its expected answer.`,
      say: `A recording; nothing runs live. KGmemory gives an AI assistant a memory, in three steps: write, find, answer. We show it on ${corpus.name}, a public benchmark: one long conversation between two fictional people, then questions about it.`,
      body: () => [
        h("div", { class: "dsteps" },
          card("data", null, `The ${corpus.name} conversation`, chatPicture(), num(corpus.turns), `messages in ${num(corpus.sessions)} chats, ${months(corpus.span)}`),
          flowArrow(),
          card("write", 1, "Write", [icon("pen", 84), clusterPicture()], num(counts.memories), "memories: short facts, one sentence each"),
          flowArrow(),
          card("find", 2, "Find", [icon("search", 84), clusterPicture(true)], num(limit), "memories at most, picked for each question"),
          flowArrow(),
          card("answer", 3, "Answer", [robot(true, 170), h("span", { class: "dsays" }, h("span", { class: "dlines" }, h("i", {}), h("i", { class: "short" })))],
            `${num(matches)} of ${num(everyone.length)}`, `questions shown answered right; alone, ${alone}`)),
        tech(h("p", { class: "dtech" }, `${num(counts.quads)} RDF quads · ${num(counts.shapes)} SHACL shapes · ${num(counts.activities_total)} PROV activities · ${corpus.name}: ${BENCHMARK.authors}, ${BENCHMARK.year}, item ${corpus.item}, ${corpus.licence}`)),
      ],
    });

    // 2. Write: one real message, the memory written from it and its concepts, then the counts for the whole conversation.
    add({
      id: "write", step: "1 · Write", scope: "question", anchor: "provenance", focus: ".dprov",
      headline: "Step 1 · Write: each fact said becomes a memory",
      lede: "A language model reads the conversation and writes each fact as one sentence: a *memory*. KGmemory keeps the exact words it was written from, and files it under what it is about: its *concepts*. Memories linked to their concepts form the *graph*.",
      say: "Step one, write. Each fact said becomes one sentence, a memory, kept with the exact words it comes from and filed under its concepts.",
      body: () => [
        writeDiagram(memory, quoteTurn, speaker),
        h("p", { class: "dnote" }, "In all: ", h("b", {}, num(corpus.turns)), " messages → ", h("b", {}, num(counts.memories)), ` memories (${num(counts.anchors)} source quotes kept), filed under `, h("b", {}, num(counts.concepts)), " concepts"),
        tech(h("p", { class: "dtech" }, `${memory.iri} · ${activity.operation || "write"} ${activity.iri || ""} · extraction by ${meta.models.extraction}`)),
      ],
    });

    // 3. Find: the question, what the search keeps of the store, and the first memories handed to the model.
    const asked = APP.recognisedTopics(question).slice(0, MAX_NAMED_CONCEPTS).map((row) => row.label);
    const pool = APP.candidates(question);
    add({
      id: "find", step: "2 · Find", scope: "question", anchor: "read", focus: ".dfind-box.kept",
      headline: `Step 2 · Find: ${plural(total, "memory is", "memories are")} picked for the question`,
      lede: `KGmemory looks for the memories about the same people and topics as the question, or worded like it. It hands the best ones to the model: at most ${num(limit)}. No large language model is needed for this: here it took ${ms(question.ms).replace(" ", "\u00a0")}.`,
      say: "Step two, find. For a question, KGmemory picks the memories about the same people and topics, or worded like it, and hands the best ones to the model.",
      body: () => [
        findDiagram(question, asked),
        tech(h("p", { class: "dtech" }, `Candidates: ${num(pool.graph)} from the graph query, ${num(pool.meaning)} added by embedding (${meta.models.embedding})${pool.bridge ? `, ${num(pool.bridge)} by a shared topic` : ""} · RRF k = ${question.ranking.rrf_k} · reranked by ${question.ranking.model}`)),
      ],
    });

    // 4. Answer: the same model alone and with the memories handed to it.
    const [answerLead, answerRest] = leadSentence(question.answer_with);
    const twice = "The same language model is asked twice: alone, then with the memories KGmemory handed it.";
    add({
      id: "ask", step: "3 · Answer", scope: "question", anchor: "ask", focus: ".danswer.with .dbubble",
      headline: {
        match: "Step 3 · Answer: with these memories, the model is right",
        trap: "Step 3 · Answer: a trick question, and the trap is avoided",
        miss: "Step 3 · Answer: a miss, the fact was not handed over",
      }[question.verdict] || "Step 3 · Answer: the same question, without and with memory",
      lede: {
        match: `${twice} *Right* means the same as the expected answer of the benchmark; we compared them by hand.`,
        trap: `${note} With its memory, the model also says what it does know.`,
        miss: note,
      }[question.verdict] || twice,
      say: {
        match: "Step three, answer. Alone, the model does not know; with these memories, it gives the expected answer.",
        trap: `Step three, answer. This one is a trick question. ${leadSentence(note)[0]} ${aloneUnknown ? "Neither answer falls for it" : "With its memory, the model does not fall for it"}.`,
        miss: "Step three, answer. This one is the miss: the expected fact was in the memory, but not among the memories handed to the model.",
      }[question.verdict] || "Step three, answer: the same model answers alone, then with its memory.",
      body: () => [
        h("div", { class: "dasker" }, avatar("#5a6b7b", 92), h("div", { class: "dbubble question" }, question.text)),
        h("div", { class: "danswers" },
          h("div", { class: "danswer" }, robot(false, 130),
            h("div", { class: "dbubble" }, h("div", { class: "dwho" }, h("span", {}, "The model alone")), h("p", {}, question.answer_without))),
          h("div", { class: "danswer with" }, robot(true, 130),
            h("div", { class: "dbubble" },
              h("div", { class: "dwho" }, h("span", {}, "With KGmemory"),
                VERDICT_SENTENCES[question.verdict] ? h("span", { class: "pverdict " + question.verdict }, VERDICT_SENTENCES[question.verdict] + (question.verdict === "trap" && aloneUnknown ? " either" : "")) : null),
              h("p", {}, h("strong", {}, answerLead), answerRest)))),
        h("p", { class: "dnote" }, h("b", {}, "Expected answer, from the benchmark: "), question.reference,
          question.note && question.verdict === "match" ? h("span", { class: "tech" }, ` · ${question.note}`) : null),
      ],
    });

    // 5. Result: every question shown, where they come from and what they are not, and the address.
    add({
      id: "result", step: "Result", scope: "demo", anchor: "ask", focus: ".dboard",
      headline: `With its memory, the model answers ${num(matches)} of ${num(everyone.length)}; alone, ${alone}`,
      lede: `The questions are ${corpus.name}'s, not ours: we recorded ${num(BENCHMARK.recorded)} of its ${num(corpus.questions)} and show ${num(everyone.length)}, one per kind of difficulty${misses === 1 ? ", the only miss included" : ""}. They show how KGmemory works: they are not a score.`,
      say: `On the ${num(everyone.length)} questions shown, the model answers ${num(matches)} with its memory and ${alone} alone. ${capital(few(traps, "trick question", "trick questions"))} avoided, ${few(misses, "miss", "misses")} left in on purpose: they show how it works, they are not a score.`,
      body: () => [
        h("div", { class: "dboard" }, everyone.map((item, index) => h("div", { class: "dcard" + (item === question ? " now" : ""), onclick: () => showQuestion(index) },
          h("div", { class: "dcard-top" }, h("b", {}, index + 1), h("span", {}, item.text)),
          item.tag ? h("p", { class: "dcard-tag" }, item.tag.replace(/ (\S+)$/, " $1")) : null,
          h("div", { class: "dcard-row" },
            h("span", { class: "dduo" }, robot(false, 60), mark(knowsAlone(item) ? "match" : "unknown")),
            h("span", { class: "darrow", "aria-hidden": "true" }, "→"),
            h("span", { class: "dduo" }, robot(true, 60), mark(item.verdict)),
            VERDICT_WORDS[item.verdict] ? h("span", { class: "pverdict " + item.verdict }, VERDICT_WORDS[item.verdict]) : null)))),
        h("div", { class: "dkey" },
          h("span", {}, robot(false, 44), "the model alone"), h("span", {}, robot(true, 44), "with KGmemory"),
          h("span", {}, h("i", { class: "dmark unknown" }, MARKS.unknown), "does not know"), h("span", {}, h("i", { class: "dmark match" }, MARKS.match), "right"), h("span", {}, h("i", { class: "dmark miss" }, MARKS.miss), "wrong"),
          h("span", {}, h("i", { class: "dkey-now" }), "followed in steps 1 to 3")),
        h("p", { class: "dopen" }, "Open every step yourself: ", h("a", { class: "purl", href: `https://${DEMO_URL.join("")}/`, tabindex: "-1" }, DEMO_URL.join(""))),
        tech(h("p", { class: "dtech" }, `Answers: ${meta.models.answer} · verdicts set by hand against the reference`)),
      ],
    });

    return beats;
  }

  // Questions the demo leaves the presenter exposed to, each with the answer the recording supports (run sheet only).
  function expectedQuestions(question) {
    const facts = served(question);
    const from = origins(question);
    const every = DATA.questions.map(origins);
    const sum = (key) => every.reduce((total, item) => total + item[key], 0);
    const counts = meta.counts;
    return [
      ["What does the graph add over a vector search?",
        `On this question ${num(from.keptGraph)} of the ${num(from.pool.kept)} memories kept came through the graph (the graph query)${from.keptShared ? `, and ${from.exact ? "" : "at most "}${num(from.keptShared)} through a topic shared with the first candidates, which is also a link followed in the graph` : ""}. Over the ${DATA.questions.length} recorded questions: ${num(sum("keptGraph"))} of ${num(every.reduce((total, item) => total + item.pool.kept, 0))} from the graph query, at most ${num(sum("keptShared"))} through a shared topic. Beyond that, the graph holds the concept layer, the source anchors, the checks and the operation records.`],
      ["Why these questions, and what is the score?",
        `They are taken from the ${num(meta.corpus.questions)} benchmark questions of this conversation: ${num(BENCHMARK.recorded)} were recorded and ${DATA.questions.length} are shown, one per kind of difficulty, the only miss included. No aggregate score is on this page: say where it is, or that it is not shown here.`],
      [`Does the form check (${counts.shapes} rules) verify the facts?`,
        "No. It checks that a record is well formed before it is written; only a violation blocks a write. Truth is checked by going back to the quote."],
      ["What do the squares on the Find beat show?",
        `Counts, not positions: one square per memory of the store (${num(counts.memories)}), with the candidates of the question and the memories given to the model coloured. The small graphs on the first beat are pictograms, not data.`],
      ["No language model at all?",
        `No large language model during the search. Two small models are used: ${meta.models.embedding} to match words to concepts and compare meaning, ${meta.models.cross_encoder} to put the kept memories in order. The answers themselves come from ${meta.models.answer}.`],
      ["Are all memories anchored, or only the one shown?",
        `${capital(share(facts.quoted, facts.total))} memories given to the model on this question carry a quote found word for word in their passage. In the whole store, ${num(counts.anchors)} quote anchors for ${num(counts.memories)} memories.`],
    ];
  }

  // ---------- canvas ----------
  let root = null;
  function ensureRoot() {
    if (root) return root;
    root = h("div", { id: "present", hidden: true, role: "region", "aria-label": "Presenter mode" },
      h("div", { class: "pcanvas" }),
      h("div", { class: "phalo", "aria-hidden": "true" }));
    document.body.append(root);
    root.addEventListener("mousemove", moveHalo);
    return root;
  }

  function fit() {
    if (!root) return;
    const scale = Math.min(window.innerWidth / CANVAS.width, window.innerHeight / CANVAS.height);
    root.style.setProperty("--pscale", scale.toFixed(4));
  }

  function moveHalo(event) {
    const halo = root.querySelector(".phalo");
    halo.style.left = `${event.clientX}px`;
    halo.style.top = `${event.clientY}px`;
    halo.classList.add("on");
    clearTimeout(tour.haloTimer);
    tour.haloTimer = setTimeout(() => halo.classList.remove("on"), HALO_IDLE_MS);
  }

  function clockText() {
    if (!tour.startedAt) return "0:00";
    const seconds = Math.floor((Date.now() - tour.startedAt) / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function render() {
    const question = DATA.questions[tour.question];
    const beats = buildBeats(question);
    tour.beat = Math.min(beats.length - 1, Math.max(0, tour.beat));
    const beat = beats[tour.beat];
    const first = tour.beat === 0;
    const canvas = root.querySelector(".pcanvas");
    canvas.dataset.beat = beat.id;
    canvas.replaceChildren(
      h("header", { class: "phead" },
        h("div", { class: "pkicker" }, h("b", {}, `${tour.beat + 1} / ${beats.length}`),
          beats.map((item, index) => h("span", { class: "pstep" + (index === tour.beat ? " now" : index < tour.beat ? " done" : "") }, item.step))),
        h("h1", { class: "pheadline" }, beat.headline),
        beat.lede ? h("p", { class: "plede" }, rich(beat.lede)) : null),
      h("div", { class: "pbody" }, beat.body().flat(Infinity).filter(Boolean)),
      h("footer", { class: "pfoot" },
        h("span", { class: "pcontext" }, beat.scope === "question"
          ? [h("b", { class: "pwhich" }, `Question ${tour.question + 1} of ${DATA.questions.length}`), `“${clip(question.text, 64)}”`]
          : [h("i", { class: "pdot", "aria-hidden": "true" }), stampLine()]),
        beat.scope === "question" ? h("span", { class: "phint" }, `keys 1 to ${DATA.questions.length}: another question`) : null,
        h("span", { class: "pclock", hidden: !tour.clock || null }, clockText()),
        h("span", { class: "pnav" },
          h("button", { type: "button", tabindex: "-1", "aria-label": "Previous beat", disabled: first || null, onclick: () => go(tour.beat - 1) }, "‹"),
          h("button", { type: "button", tabindex: "-1", "aria-label": "Next beat", disabled: tour.beat === beats.length - 1 || null, onclick: () => go(tour.beat + 1) }, "›"))));
    writeHash();
  }

  // "#q5-3" is question 5, beat 3: a reload, or a second window, lands on the same beat.
  function writeHash() {
    const hash = tour.active ? `#q${tour.question + 1}-${tour.beat + 1}` : `#q${tour.question + 1}`;
    try { history.replaceState(null, "", hash); } catch (error) { location.replace(hash); }
  }

  function go(beat) {
    if (!tour.startedAt && beat > 0) tour.startedAt = Date.now();
    tour.beat = beat;
    render();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); // keys keep driving the tour
  }

  // Another question, same beat: the tour is of the whole demo, any of its questions can be the one worked through.
  function showQuestion(index) {
    if (!tour.active || index === tour.question || !DATA.questions[index]) return;
    tour.question = index;
    APP.selectQuestion(index, false);
    render();
  }

  // Re-entering after leaving by mistake (Esc on a remote) lands on the beat that was left.
  function reopen() {
    const question = APP.state.question;
    open(question, tour.left && tour.left.question === question ? tour.left.beat : 0);
  }

  function open(questionIndex, beat) {
    ensureRoot();
    tour.active = true;
    tour.question = questionIndex;
    tour.beat = beat || 0;
    tour.startedAt = null;
    if (APP.state.question !== questionIndex) APP.selectQuestion(questionIndex, false);
    document.body.dataset.mode = "present";
    root.hidden = false;
    fit();
    render();
    clearInterval(tour.ticker);
    tour.ticker = setInterval(() => {
      const clock = root.querySelector(".pclock");
      if (clock && tour.clock) clock.textContent = clockText();
    }, 1000);
  }

  function close() {
    if (!tour.active) return;
    const anchor = buildBeats(DATA.questions[tour.question])[tour.beat].anchor;
    tour.left = { question: tour.question, beat: tour.beat };
    tour.active = false;
    clearInterval(tour.ticker);
    root.hidden = true;
    delete document.body.dataset.mode;
    writeHash();
    const target = document.getElementById(anchor);
    if (target) target.scrollIntoView({ block: "start", behavior: "auto" });
  }

  // One beat per press: an auto-repeat, or a second press within the guard, is ignored.
  function step(delta) {
    const now = performance.now();
    if (now - tour.lastMove < tour.guardMs) return;
    tour.lastMove = now;
    go(tour.beat + delta);
  }
  const KEYS = {
    ArrowRight: () => step(1), ArrowDown: () => step(1), PageDown: () => step(1), " ": () => step(1), Enter: () => step(1),
    ArrowLeft: () => step(-1), ArrowUp: () => step(-1), PageUp: () => step(-1), Backspace: () => step(-1),
    Home: () => go(0), End: () => go(Infinity),
    t: () => { APP.setLevel(APP.state.level === "technical" ? "simple" : "technical", true); render(); },
    c: () => { tour.clock = !tour.clock; if (tour.clock && !tour.startedAt) tour.startedAt = Date.now(); render(); },
    Escape: close,
  };

  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (!tour.active) {
      if (key === "p" && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) { event.preventDefault(); reopen(); }
      return;
    }
    const action = KEYS[key] || (/^[1-9]$/.test(key) ? () => showQuestion(Number(key) - 1) : null); // 1 to 6: another question
    if (!action) return;
    event.preventDefault();
    if (!event.repeat) action();
  });
  window.addEventListener("resize", fit);

  const button = document.getElementById("present-btn");
  if (button) button.addEventListener("click", reopen);

  // Run sheet and stills are produced from this (tools/export_tour.py).
  window.KGTOUR = {
    open, close, state: tour, wordsPerMinute: WORDS_PER_MINUTE, pauseSeconds: PAUSE_SECONDS,
    expect: (questionIndex) => expectedQuestions(DATA.questions[questionIndex]),
    beats: (questionIndex) => buildBeats(DATA.questions[questionIndex]).map(({ id, step, scope, headline, lede, say, seconds, focus }) => ({ id, step, scope, headline, lede: plain(lede), say, seconds, focus })),
  };

  // ---------- boot ----------
  const fromHash = /^#q(\d+)-(\d+)$/.exec(location.hash);
  if (fromHash) open(APP.state.question, Number(fromHash[2]) - 1);
  else if (new URLSearchParams(location.search).has("present")) open(APP.state.question, 0);
})();
