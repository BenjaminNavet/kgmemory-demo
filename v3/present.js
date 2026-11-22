/* KGmemory glass box — presenter mode.
   A guided tour of the selected question on a fixed 1920×1080 canvas, for a shared screen: nine beats over the
   whole demo (every question, one worked through, the upkeep of the store), one picture, diagram or graph and one
   short headline each, keyboard driven, no scrolling, no animation. Headlines are narration; every number,
   sentence and identifier still comes from window.KGDEMO. Design: docs/superpowers/specs/2026-11-22-kgmemory-demo-v3-presenter-design.md */
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
  const DEMO_URL = ["benjaminnavet.github.io", "/kgmemory-demo"]; // shown on two lines
  const QR_SOURCE = "assets/qr-demo.svg";
  const PREVIEW_SOURCE = "assets/page-preview.jpg"; // a still of the ordinary page (tools/make_preview.py)
  for (const source of [QR_SOURCE, PREVIEW_SOURCE]) new Image().src = source; // loaded up front, so the last beat appears whole
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

  // The memory shown in the provenance beats: the first served one whose anchored quote is found verbatim in its passage.
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

  const COLOURS = { graph: "#6941eb", shared: "#b79cf7", meaning: "#0d7c8c", ink: "#00284b", memory: "#b8661a", grey: "#7a8490", ring: "#e0a800" };

  // Line icons on a 48 × 48 grid, drawn in the current colour: [tag, attributes] per stroke.
  const DOT = { fill: "currentColor" };
  const ICONS = {
    chat: [["path", { d: "M8 12a5 5 0 0 1 5-5h22a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H22l-9 8v-8a5 5 0 0 1-5-5z" }]],
    graph: [["path", { d: "M15 30 21.5 17M33 30 26.5 17M17.5 34h13" }], ["circle", { cx: 12, cy: 34, r: 5.5 }], ["circle", { cx: 36, cy: 34, r: 5.5 }], ["circle", { cx: 24, cy: 12, r: 5.5 }]],
    check: [["circle", { cx: 24, cy: 24, r: 17 }], ["path", { d: "M15.5 24.5 21.5 30.5 33 18" }]],
    pen: [["path", { d: "M9 39l3-11L31 9l8 8-19 19z" }], ["path", { d: "M27 13l8 8" }]],
    search: [["circle", { cx: 21, cy: 21, r: 12 }], ["path", { d: "M30 30l10 10" }], ["circle", { cx: 21, cy: 21, r: 1.5, ...DOT }]],
    refresh: [["path", { d: "M39 24a15 15 0 1 1-5-11.2" }], ["path", { d: "M36 5v9h-9" }]],
    clash: [["circle", { cx: 24, cy: 24, r: 17 }], ["path", { d: "M16 20h16M16 28h16M30 13 18 35" }]],
    clock: [["circle", { cx: 24, cy: 24, r: 17 }], ["path", { d: "M24 13v11l7 5" }]],
    layers: [["path", { d: "M24 7 6 17l18 10 18-10z" }], ["path", { d: "M6 25l18 10 18-10" }], ["path", { d: "M6 33l18 10 18-10" }]],
    link: [["path", { d: "M21 27a8 8 0 0 0 11 0l6-6a8 8 0 0 0-11-11l-3 3" }], ["path", { d: "M27 21a8 8 0 0 0-11 0l-6 6a8 8 0 0 0 11 11l3-3" }]],
  };
  const icon = (name, size) => s("svg", { viewBox: "0 0 48 48", width: size || 48, height: size || 48, class: "dicon", fill: "none", stroke: "currentColor",
    "stroke-width": "3.4", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, ICONS[name].map(([tag, attrs]) => s(tag, attrs)));
  // One small square per memory: a count the eye can take in without reading.
  const tiles = (count, cls) => h("span", { class: "dtiles" + (cls ? " " + cls : ""), "aria-hidden": "true" }, Array.from({ length: count }, () => h("i", {})));

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

  // A pictogram of a graph of memories (orange) around concepts (purple). Not data: the real one is on the Graph beat.
  function clusterPicture() {
    const concepts = [[150, 108], [64, 58], [240, 62], [228, 170]];
    const memories = [[108, 66, 0, 1], [28, 112, 1], [88, 138, 0, 1], [150, 190, 0], [196, 104, 0, 2], [272, 118, 2, 3], [196, 30, 2], [184, 204, 3, 0], [284, 196, 3], [22, 38, 1], [112, 14, 1], [62, 196, 0]];
    return s("svg", { viewBox: "0 0 300 220", class: "dcluster", "aria-hidden": "true" },
      memories.map(([x, y, ...linked]) => linked.map((at) => s("path", { d: `M${x} ${y}L${concepts[at][0]} ${concepts[at][1]}`, stroke: COLOURS.shared, "stroke-width": 3 }))),
      memories.map(([x, y]) => s("circle", { cx: x, cy: y, r: 11, fill: "#f6c98b", stroke: COLOURS.memory, "stroke-width": 3 })),
      concepts.map(([x, y], index) => s("circle", { cx: x, cy: y, r: index ? 17 : 22, fill: COLOURS.graph })));
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
  const stampLine = () => `KGmemory · recorded run · ${shortDate(meta.recorded_on)} · ${meta.corpus.name} ${meta.corpus.item}: ${meta.corpus.speakers.join(" & ")}, ${meta.corpus.sessions} sessions · ${num(meta.counts.memories)} memories`;

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

  // ---------- the graph of the memories given ----------
  const MAX_NAMED_CONCEPTS = 3; // concepts of the question named above the flow; the others are counted
  const MAX_GRAPH_LABELS = 9;
  const LAYOUT_STEPS = 320;

  // Fruchterman–Reingold from a fixed start (nodes on two circles, in order) and a fixed number of steps: the same
  // recording always gives the same drawing, and nothing moves on screen. Returns positions in the unit square.
  function forceLayout(count, links) {
    const nodes = Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * 2 * Math.PI;
      const radius = index % 2 ? 1 : 0.6;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
    const ideal = Math.sqrt(4 / count);
    for (let step = 0; step < LAYOUT_STEPS; step += 1) {
      const heat = 0.2 * (1 - step / LAYOUT_STEPS);
      const push = nodes.map((node) => ({ x: -node.x * 1.1, y: -node.y * 1.1 })); // a pull to the centre keeps loose nodes in
      for (let a = 0; a < count; a += 1) {
        for (let b = a + 1; b < count; b += 1) {
          const dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y;
          const distance = Math.max(Math.hypot(dx, dy), 0.01);
          const force = (ideal * ideal) / (distance * distance);
          push[a].x += dx * force; push[a].y += dy * force;
          push[b].x -= dx * force; push[b].y -= dy * force;
        }
      }
      for (const [a, b] of links) {
        const dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y;
        const force = Math.hypot(dx, dy) / ideal;
        push[a].x -= dx * force; push[a].y -= dy * force;
        push[b].x += dx * force; push[b].y += dy * force;
      }
      nodes.forEach((node, index) => {
        const length = Math.max(Math.hypot(push[index].x, push[index].y), 1e-6);
        const moved = Math.min(length, heat);
        node.x += (push[index].x / length) * moved;
        node.y += (push[index].y / length) * moved;
      });
    }
    const xs = nodes.map((node) => node.x), ys = nodes.map((node) => node.y);
    const left = Math.min(...xs), top = Math.min(...ys);
    const wide = Math.max(...xs) - left || 1, tall = Math.max(...ys) - top || 1;
    return nodes.map((node) => ({ x: (node.x - left) / wide, y: (node.y - top) / tall }));
  }

  // Every memory given to the model and the concepts it is about (its subjects, read back from the graph).
  const graphCache = new Map();
  function servedGraph(question) {
    if (graphCache.has(question.id)) return graphCache.get(question.id);
    const memories = question.served.map((id) => DATA.memories[id]).filter(Boolean);
    const concepts = new Map();
    const links = [];
    memories.forEach((memory, row) => {
      for (const subject of memory.subjects || []) {
        const key = subject.iri || subject.label;
        if (!concepts.has(key)) concepts.set(key, { label: subject.label, degree: 0, index: memories.length + concepts.size });
        const concept = concepts.get(key);
        concept.degree += 1;
        links.push([row, concept.index]);
      }
    });
    const graph = { memories, concepts: [...concepts.values()], links, positions: forceLayout(memories.length + concepts.size, links) };
    graphCache.set(question.id, graph);
    return graph;
  }

  function memoryGraph(question, traced) {
    const graph = servedGraph(question);
    const asked = new Set(APP.recognisedTopics(question).map((row) => row.label));
    const WIDTH = 1728, HEIGHT = 580, PAD_X = 60, PAD_Y = 52, MEMORY_RADIUS = 11;
    const radius = (index) => (index < graph.memories.length ? MEMORY_RADIUS : Math.min(40, 9 + 4.5 * Math.sqrt(graph.concepts[index - graph.memories.length].degree)));
    const points = graph.positions.map((position, index) => ({
      x: PAD_X + position.x * (WIDTH - 2 * PAD_X), y: PAD_Y + position.y * (HEIGHT - 2 * PAD_Y), r: radius(index),
    }));
    // Circles that overlap are pushed apart, inside the frame.
    for (let pass = 0; pass < 40; pass += 1) {
      for (let a = 0; a < points.length; a += 1) {
        for (let b = a + 1; b < points.length; b += 1) {
          const dx = points[b].x - points[a].x, dy = points[b].y - points[a].y;
          const distance = Math.max(Math.hypot(dx, dy), 0.5), room = points[a].r + points[b].r + 5;
          if (distance >= room) continue;
          const shift = (room - distance) / 2;
          points[a].x -= (dx / distance) * shift; points[a].y -= (dy / distance) * shift;
          points[b].x += (dx / distance) * shift; points[b].y += (dy / distance) * shift;
        }
      }
      for (const point of points) {
        point.x = Math.min(WIDTH - point.r - 4, Math.max(point.r + 4, point.x));
        point.y = Math.min(HEIGHT - point.r - 4, Math.max(point.r + 4, point.y));
      }
    }
    const svg = s("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: "dgraph", role: "img",
      "aria-label": `${graph.memories.length} memories linked to ${graph.concepts.length} concepts by ${graph.links.length} links` });
    for (const [a, b] of graph.links) svg.append(s("path", { class: "dedge", d: `M${points[a].x} ${points[a].y}L${points[b].x} ${points[b].y}` }));
    graph.memories.forEach((memory, index) => {
      const point = points[index];
      if (memory === traced) svg.append(s("circle", { class: "dtraced", cx: point.x, cy: point.y, r: point.r + 11 }));
      svg.append(s("circle", { class: "dmemory-node", cx: point.x, cy: point.y, r: point.r }));
    });
    graph.concepts.forEach((concept) => {
      const point = points[concept.index];
      svg.append(s("circle", { class: "dconcept-node" + (asked.has(concept.label) ? " asked" : ""), cx: point.x, cy: point.y, r: point.r }));
    });
    // Names: the concepts of the question first, then the most linked; a name that would cover another is left out.
    const named = [...graph.concepts].sort((a, b) => (asked.has(b.label) - asked.has(a.label)) || b.degree - a.degree).slice(0, MAX_GRAPH_LABELS);
    // A name goes where it covers the fewest circles, and never over another name.
    const placed = [];
    const hits = (box, others) => others.filter((other) => box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom)
      .reduce((sum, other) => sum + (other.weight || 1), 0);
    const circles = points.map((point) => ({ left: point.x - point.r, right: point.x + point.r, top: point.y - point.r, bottom: point.y + point.r, weight: point.r > 18 ? 5 : 1 }));
    for (const concept of named) {
      const point = points[concept.index];
      const label = clip(concept.label, 22), wide = label.length * 16.5 + 16, tall = 36;
      const inside = wide < point.r * 2 - 6;
      const side = point.r + wide / 2 + 8, above = point.r + tall / 2 + 6;
      const spots = inside ? [[0, 0]] : [[0, -above], [0, above], [side, 0], [-side, 0], [side * 0.8, -above * 0.8], [-side * 0.8, -above * 0.8], [side * 0.8, above * 0.8], [-side * 0.8, above * 0.8]];
      let best = null;
      for (const [dx, dy] of spots) {
        const x = Math.min(WIDTH - wide / 2 - 4, Math.max(wide / 2 + 4, point.x + dx)), y = Math.min(HEIGHT - tall / 2 - 2, Math.max(tall / 2 + 2, point.y + dy));
        const box = { left: x - wide / 2, right: x + wide / 2, top: y - tall / 2, bottom: y + tall / 2 };
        if (hits(box, placed)) continue;
        const cost = inside ? 0 : hits(box, circles.filter((_, index) => index !== concept.index));
        if (!best || cost < best.cost) best = { x, y, box, cost };
      }
      if (!best) continue;
      placed.push(best.box);
      svg.append(s("text", { class: "dname" + (inside ? " inside" : ""), x: best.x, y: best.y + 10, "text-anchor": "middle" }, label));
    }
    return svg;
  }

  // ---------- the search, drawn to scale ----------
  // The routes in, the candidates, the kept ones and where they came from.
  function flowDiagram(question) {
    const from = origins(question);
    const { pool } = from;
    const WIDTH = 1728, HEIGHT = 520, TOP = 76, BAR = 120, GAP = 18, MIN = 14, ROW = 62;
    const x = { routes: 430, all: 750, kept: 1050, legend: 1210 };
    const routes = [
      { count: pool.graph, label: "graph query", colour: COLOURS.graph },
      { count: pool.bridge, label: "shared topic", colour: COLOURS.shared },
      { count: pool.meaning, label: "close in meaning", colour: COLOURS.meaning },
    ].filter((route) => route.count > 0);
    const room = HEIGHT - TOP;
    // One scale for every bar. A route too small for its label still gets a full row, taken from the others.
    let scale = (room - GAP * (routes.length - 1)) / pool.total;
    for (let pass = 0; pass < routes.length; pass += 1) {
      const small = routes.filter((route) => route.count * scale < ROW);
      const large = routes.filter((route) => route.count * scale >= ROW).reduce((sum, route) => sum + route.count, 0);
      if (!large) break;
      scale = (room - GAP * (routes.length - 1) - ROW * small.length) / large;
    }
    const rowOf = (route) => Math.max(ROW, route.count * scale);
    const allHeight = pool.total * scale;
    const allTop = TOP + (room - allHeight) / 2;
    const svg = s("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: "dflow", role: "img",
      "aria-label": `${pool.total} candidates from ${routes.length} routes, ${pool.kept} kept` });
    const header = (left, strong, rest) => svg.append(s("text", { x: left + BAR / 2, y: 38, class: "dhead", "text-anchor": "middle" }, s("tspan", { class: "strong" }, strong), rest));
    header(x.all, num(pool.total), " candidates");
    header(x.kept, num(pool.kept), " kept");

    let routeY = TOP + (room - (routes.reduce((sum, route) => sum + rowOf(route), 0) + GAP * (routes.length - 1))) / 2;
    let sliceY = allTop;
    for (const route of routes) {
      const row = rowOf(route), tall = Math.max(MIN, route.count * scale), slice = route.count * scale;
      const right = x.routes + BAR, top = routeY + (row - tall) / 2;
      svg.append(s("path", { class: "dband", fill: route.colour,
        d: `M${right} ${top} C ${right + 110} ${top}, ${x.all - 110} ${sliceY}, ${x.all} ${sliceY} L ${x.all} ${sliceY + slice} C ${x.all - 110} ${sliceY + slice}, ${right + 110} ${top + tall}, ${right} ${top + tall} Z` }));
      svg.append(s("rect", { x: x.routes, y: top, width: BAR, height: tall, rx: 6, fill: route.colour }));
      svg.append(s("rect", { x: x.all, y: sliceY, width: BAR, height: Math.max(1.5, slice), fill: route.colour }));
      svg.append(s("text", { x: x.routes - 26, y: routeY + row / 2 + 18, "text-anchor": "end" },
        s("tspan", { class: "dlabel" }, route.label + "  "), s("tspan", { class: "dnum" }, num(route.count))));
      routeY += row + GAP;
      sliceY += slice;
    }

    const keptHeight = Math.max(56, pool.kept * scale);
    const keptTop = allTop + (allHeight - keptHeight) / 2;
    const allRight = x.all + BAR;
    svg.append(s("path", { class: "dband", fill: COLOURS.ink,
      d: `M${allRight} ${allTop} C ${allRight + 100} ${allTop}, ${x.kept - 100} ${keptTop}, ${x.kept} ${keptTop} L ${x.kept} ${keptTop + keptHeight} C ${x.kept - 100} ${keptTop + keptHeight}, ${allRight + 100} ${allTop + allHeight}, ${allRight} ${allTop + allHeight} Z` }));
    // The kept bar, split by origin; the shared-topic part is hatched when the recording only bounds it.
    svg.append(s("defs", {}, s("pattern", { id: "dhatch", width: 14, height: 14, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
      s("rect", { width: 14, height: 14, fill: COLOURS.meaning }), s("rect", { width: 7, height: 14, fill: COLOURS.shared }))));
    const parts = [
      { count: from.keptGraph, fill: COLOURS.graph, label: `${num(from.keptGraph)} from the graph query`, always: true },
      { count: from.keptShared, fill: from.exact ? COLOURS.shared : "url(#dhatch)", label: `${from.exact ? "" : "at most "}${num(from.keptShared)} by a shared topic` },
      { count: from.keptMeaning, fill: COLOURS.meaning, label: `${from.exact ? "" : "at least "}${num(from.keptMeaning)} by meaning` },
    ];
    let partY = keptTop;
    for (const part of parts) {
      const tall = (part.count / pool.kept) * keptHeight;
      if (tall > 0) svg.append(s("rect", { x: x.kept, y: partY, width: BAR, height: tall, fill: part.fill }));
      partY += tall;
    }
    svg.append(s("rect", { x: x.kept, y: keptTop, width: BAR, height: keptHeight, rx: 6, fill: "none", stroke: COLOURS.ink, "stroke-width": 6 }));
    const legend = parts.filter((part) => part.count > 0 || part.always);
    const LINE = 58;
    const legendTop = Math.min(HEIGHT - legend.length * LINE, Math.max(TOP, keptTop + keptHeight / 2 - (legend.length * LINE) / 2));
    // A frame the annotated stills can ring: the legend is where the finding of the beat is read.
    svg.append(s("rect", { class: "dframe", x: x.legend - 22, y: legendTop - 10, width: WIDTH - x.legend + 10, height: legend.length * LINE + 22, rx: 16 }));
    legend.forEach((part, index) => {
      const top = legendTop + index * LINE;
      svg.append(s("rect", { x: x.legend, y: top + 10, width: 34, height: 34, rx: 6, fill: part.count ? part.fill : "#fff", stroke: part.count ? "none" : COLOURS.graph, "stroke-width": 4 }));
      svg.append(s("text", { x: x.legend + 50, y: top + 38, class: "dlabel" }, part.label));
    });
    return svg;
  }

  // ---------- one memory and everything the graph holds about where it comes from ----------
  // Fixed geometry on a 1728 × 560 stage: the boxes are HTML, the named edges are drawn under them.
  const PROV = { said: { left: 0, width: 600 }, memory: { left: 730, top: 24, width: 580, height: 330 }, about: { left: 1420, width: 308, height: 76, pitch: 92 }, records: { top: 442, height: 116, width: 460, lefts: [110, 790, 1268] } };
  function provenanceGraph(memory, quoteTurn, speaker, badges) {
    const about = (memory.subjects || []).slice(0, 3);
    const middle = PROV.memory.top + PROV.memory.height / 2;
    const right = PROV.memory.left + PROV.memory.width, centre = PROV.memory.left + PROV.memory.width / 2, bottom = PROV.memory.top + PROV.memory.height;
    const aboutY = (index) => middle + (index - (about.length - 1) / 2) * PROV.about.pitch;
    const box = (area) => `left:${area.left}px;top:${area.top}px;width:${area.width}px;height:${area.height}px`;
    const edge = (d) => s("path", { class: "dprov-edge", d, "marker-end": "url(#dtip)" });
    const name = (x, y, text) => s("text", { class: "dprov-name", x, y, "text-anchor": "middle" }, text);
    const recordX = (index) => PROV.records.lefts[index] + PROV.records.width / 2;
    const down = (index) => (recordX(index) === centre ? `M${centre} ${bottom}V${PROV.records.top - 8}`
      : `M${centre} ${bottom} C ${centre} ${bottom + 52}, ${recordX(index)} ${bottom + 34}, ${recordX(index)} ${PROV.records.top - 8}`);
    return h("div", { class: "dprov" },
      s("svg", { viewBox: "0 0 1728 560", class: "dprov-edges", "aria-hidden": "true" },
        s("defs", {}, s("marker", { id: "dtip", viewBox: "0 0 12 12", refX: 9, refY: 6, markerWidth: 5, markerHeight: 5, orient: "auto" }, s("path", { d: "M1 1 11 6 1 11z", fill: COLOURS.ink }))),
        edge(`M${PROV.memory.left} ${middle}H${PROV.said.left + PROV.said.width + 10}`),
        about.map((_, index) => edge(`M${right} ${middle} C ${right + 80} ${middle}, ${PROV.about.left - 80} ${aboutY(index)}, ${PROV.about.left - 8} ${aboutY(index)}`)),
        badges.map((_, index) => edge(down(index))),
        name((PROV.said.left + PROV.said.width + PROV.memory.left) / 2, middle + 9, "quote"),
        about.length ? name((right + PROV.about.left) / 2, middle + 9, "about") : null,
        badges.map(([, , , label], index) => name((centre + recordX(index)) / 2, bottom + 54, label))),
      h("div", { class: "dnode said", style: `left:${PROV.said.left}px;top:${middle}px;width:${PROV.said.width}px` },
        h("div", { class: "dwho" }, avatar(speakerColour(speaker), 64), h("span", {}, speaker ? `${speaker} said` : "Said"), h("small", {}, shortDate(memory.said_on))),
        h("p", {}, quoteTurn ? excerpt(quoteTurn.text, memory.quote, 30) : memory.quote)),
      h("div", { class: "dnode memory", style: box(PROV.memory) },
        h("div", { class: "dwho" }, icon("graph", 52), h("span", {}, "Memory")),
        h("p", {}, memory.content)),
      about.map((subject, index) => h("div", { class: "dnode about", style: `left:${PROV.about.left}px;top:${aboutY(index) - PROV.about.height / 2}px;width:${PROV.about.width}px;height:${PROV.about.height}px` }, h("span", {}, clip(subject.label, 34)))),
      badges.map(([iconName, title, detail, , cls], index) => h("div", { class: "dnode record" + (cls ? " " + cls : ""), style: box({ left: PROV.records.lefts[index], top: PROV.records.top, width: PROV.records.width, height: PROV.records.height }) },
        icon(iconName, 54), h("span", {}, h("b", {}, title), detail))));
  }

  // ---------- the whole demo: every question, and the upkeep of the store ----------
  const knowsAlone = (item) => !/\b(don't|do not) know\b/i.test(item.answer_without);
  const MARKS = { unknown: "?", match: "✓", trap: "✓", miss: "✕" };
  const mark = (kind) => h("span", { class: "dmark " + kind, "aria-hidden": "true" }, MARKS[kind]);
  const hatch = (id) => s("defs", {}, s("pattern", { id, width: 14, height: 14, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
    s("rect", { width: 14, height: 14, fill: COLOURS.meaning }), s("rect", { width: 7, height: 14, fill: COLOURS.shared })));

  // Every question on one chart: the memories given, split by where they came from, and how many carry their quote.
  function acrossChart(focus) {
    const rows = DATA.questions.map((item) => ({ item, from: origins(item), facts: served(item) }));
    const WIDTH = 1728, ROW = 86, TOP = 78, HEIGHT = TOP + rows.length * ROW;
    const x = { chip: 30, text: 74, bar: 730, quoted: 1470 }, BAR = 620, THICK = 44;
    const scale = BAR / Math.max(...rows.map((row) => row.from.pool.kept));
    const bounded = rows.some((row) => !row.from.exact && row.from.keptShared);
    const svg = s("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: "dacross", role: "img",
      "aria-label": `${rows.length} questions: memories given by origin, and how many trace back to a quote` }, hatch("dhatch-all"));
    const key = [[COLOURS.graph, "graph query"], [bounded ? "url(#dhatch-all)" : COLOURS.shared, bounded ? "shared topic, at most" : "shared topic"], [COLOURS.meaning, "meaning"]];
    let keyX = x.text;
    for (const [fill, label] of key) {
      svg.append(s("rect", { x: keyX, y: 14, width: 30, height: 30, rx: 5, fill }), s("text", { class: "dlabel", x: keyX + 42, y: 39 }, label));
      keyX += 42 + label.length * 14.5 + 34;
    }
    svg.append(s("text", { class: "dlabel strong", x: x.quoted, y: 39 }, "with a quote"));
    // A frame the annotated stills can ring: the column every row agrees on.
    svg.append(s("rect", { class: "dframe", x: x.quoted - 22, y: 4, width: WIDTH - x.quoted + 16, height: HEIGHT - 8, rx: 16 }));
    rows.forEach(({ item, from, facts }, index) => {
      const middle = TOP + index * ROW + ROW / 2;
      if (item === focus) svg.append(s("rect", { class: "dfocus-row", x: 0, y: middle - ROW / 2 + 4, width: WIDTH, height: ROW - 8, rx: 14 }));
      svg.append(s("circle", { class: "dchip-dot " + item.verdict, cx: x.chip, cy: middle, r: 24 }), s("text", { class: "dchip-num", x: x.chip, y: middle + 10, "text-anchor": "middle" }, index + 1));
      svg.append(s("text", { class: "dlabel", x: x.text, y: middle + 10 }, clip(item.text, 40)));
      let at = x.bar;
      for (const [count, fill] of [[from.keptGraph, COLOURS.graph], [from.keptShared, from.exact ? COLOURS.shared : "url(#dhatch-all)"], [from.keptMeaning, COLOURS.meaning]]) {
        if (count) svg.append(s("rect", { x: at, y: middle - THICK / 2, width: count * scale, height: THICK, fill }));
        at += count * scale;
      }
      svg.append(s("text", { class: "dlabel strong", x: at + 14, y: middle + 10 }, num(from.pool.kept)));
      svg.append(s("text", { class: "dlabel strong" + (facts.quoted === facts.total ? " good" : ""), x: x.quoted, y: middle + 10 }, `${num(facts.quoted)} of ${num(facts.total)}`));
    });
    return svg;
  }

  // The outcome sentence of an upkeep pass, cut where it breathes: the number, what was counted, and the first result
  // that follows when it is itself a count. Nothing is reworded.
  function passFigures(outcome) {
    const [head, next = ""] = outcome.split(/[:,.]\s+/);
    const counted = /^([\d,.]*\d)\s+(.*)$/.exec(head);
    return { number: counted ? counted[1] : "", counted: counted ? counted[2] : head, then: /^\d/.test(next) ? next.replace(/\.$/, "") : "" };
  }

  // The store in the middle, the passes around it. Fixed geometry on a 1728 × 590 stage.
  const PASS_ICONS = { revision: "refresh", contradiction: "clash", forgetting: "clock", abstraction: "layers", associations: "link" };
  const UPKEEP = { corner: { width: 520, height: 285 }, centre: { left: 604, top: 370, width: 520, height: 220 }, slots: [[0, 0], [1208, 0], [0, 305], [1208, 305]] };
  const passTitle = (pass) => (APP.PASSES[pass.key] || { title: pass.key }).title.replace(/ between .*$/, ""); // the figure says the rest
  function upkeepDiagram() {
    const passes = DATA.maintenance.map((pass) => ({ ...pass, ...passFigures(pass.outcome) }));
    // The pass with the least to say takes the smaller box under the store; the others keep their order.
    const brief = passes.length > UPKEEP.slots.length ? [...passes].sort((a, b) => (a.counted + a.then).length - (b.counted + b.then).length)[0] : null;
    const around = passes.filter((pass) => pass !== brief).slice(0, UPKEEP.slots.length);
    const hub = { x: 864, top: 78, bottom: 300, left: 724, right: 1004, middle: 190 };
    const card = (pass, style) => h("div", { class: "dnode dpass", style },
      h("div", { class: "dwho" }, icon(PASS_ICONS[pass.key] || "check", 52), h("span", {}, passTitle(pass))),
      h("p", { class: "dfig" }, pass.number ? h("b", {}, pass.number) : null, " ", pass.counted),
      pass.then ? h("p", { class: "dthen" }, pass.then) : null);
    return h("div", { class: "dupkeep" },
      s("svg", { viewBox: "0 0 1728 590", class: "dprov-edges", "aria-hidden": "true" },
        s("defs", {}, s("marker", { id: "dtip-in", viewBox: "0 0 12 12", refX: 9, refY: 6, markerWidth: 5, markerHeight: 5, orient: "auto" }, s("path", { d: "M1 1 11 6 1 11z", fill: COLOURS.ink }))),
        around.map((_, index) => {
          const [left, top] = UPKEEP.slots[index];
          const fromX = left ? left - 6 : UPKEEP.corner.width + 6, fromY = top + UPKEEP.corner.height / 2, toX = left ? hub.right + 10 : hub.left - 10;
          return s("path", { class: "dprov-edge", "marker-end": "url(#dtip-in)", d: `M${fromX} ${fromY} C ${(fromX + toX) / 2} ${fromY}, ${(fromX + toX) / 2} ${hub.middle}, ${toX} ${hub.middle}` });
        }),
        brief ? s("path", { class: "dprov-edge", "marker-end": "url(#dtip-in)", d: `M${hub.x} ${UPKEEP.centre.top - 6}V${hub.bottom + 12}` }) : null),
      h("div", { class: "dnode dstore", style: `left:${hub.left - 60}px;top:0;width:${hub.right - hub.left + 120}px` },
        h("div", { class: "dcount" }, h("span", {}, h("b", {}, num(meta.counts.memories)), " memories")), clusterPicture()),
      around.map((pass, index) => card(pass, `left:${UPKEEP.slots[index][0]}px;top:${UPKEEP.slots[index][1]}px;width:${UPKEEP.corner.width}px;height:${UPKEEP.corner.height}px`)),
      brief ? card(brief, `left:${UPKEEP.centre.left}px;top:${UPKEEP.centre.top}px;width:${UPKEEP.centre.width}px;height:${UPKEEP.centre.height}px`) : null);
  }

  // ---------- the nine beats: the whole demo, with one question worked through ----------
  // scope "demo" beats are the same whatever the question; scope "question" beats work through the question shown,
  // which keys 1 to 6 change without leaving the beat.
  function buildBeats(question) {
    const facts = served(question);
    const total = facts.total;
    const handed = plural(total, "memory", "memories");
    const from = origins(question);
    const { pool } = from;
    const corpus = meta.corpus, counts = meta.counts;
    const everyone = DATA.questions;
    const memory = spotlight(question);
    const activity = DATA.activities[memory.activity] || {};
    const quoteTurn = (memory.turns || []).find((turn) => memory.quote && turn.text.includes(memory.quote)) || (memory.turns || [])[0];
    const speaker = quoteTurn && /^[A-Za-z]/.test(quoteTurn.speaker) ? quoteTurn.speaker : null;
    const noteLead = question.note ? leadSentence(question.note)[0] : "";
    const aloneUnknown = !knowsAlone(question);
    const graphShare = `${from.keptGraph ? num(from.keptGraph) : "none"} from the graph query`;
    const beats = [];
    const add = (beat) => beats.push({ ...beat, seconds: spokenSeconds(beat.say) });

    // Counts over every recorded question.
    const tally = (verdict) => everyone.filter((item) => item.verdict === verdict).length;
    const matches = tally("match"), traps = tally("trap"), misses = tally("miss");
    const aloneAnswered = everyone.filter(knowsAlone).length;
    const all = everyone.map((item) => ({ from: origins(item), facts: served(item) }));
    const sum = (pick) => all.reduce((count, row) => count + pick(row), 0);
    const servedAll = sum((row) => row.facts.total), quotedAll = sum((row) => row.facts.quoted), graphAll = sum((row) => row.from.keptGraph);
    const few = (count, one, many) => (count === 1 ? `one ${one}` : `${num(count)} ${many}`);

    // 1. Build: what KGmemory is, as a picture. The numbers are those of the recorded store.
    const station = (cls, title, picture, big, label) => h("div", { class: "dstation " + cls },
      h("div", { class: "dtitle" }, title), h("div", { class: "dpicture" }, picture), h("div", { class: "dcount" }, h("b", {}, big), h("span", {}, label)));
    const pipeArrow = (iconName, label) => h("div", { class: "dpipe-arrow" }, h("span", {}, icon(iconName, 44), label),
      s("svg", { viewBox: "0 0 200 44", "aria-hidden": "true" }, s("path", { d: "M4 22H186M164 5 190 22 164 39" })));
    add({
      id: "build", step: "Build", scope: "demo", anchor: "store", focus: ".dstation.graph",
      headline: "A conversation becomes a graph of memories",
      say: "A recording; nothing runs live. KGmemory writes a conversation as a graph of memories, and the assistant reads from it before answering.",
      body: () => [
        h("div", { class: "dpipe" },
          station("talk", corpus.speakers.join(" & "),
            h("div", { class: "dchat" }, [0, 1, 0].map((who, row) => h("div", { class: "dturn" + (who ? " right" : "") },
              avatar(speakerColour(corpus.speakers[who]), 68), h("span", { class: "dlines" }, h("i", {}), row === 1 ? null : h("i", { class: "short" }))))),
            num(corpus.turns), `messages, ${num(corpus.sessions)} sessions`),
          pipeArrow("pen", "written as facts"),
          station("graph", "Memory graph", clusterPicture(), num(counts.memories), `memories, ${num(counts.concepts)} concepts`),
          pipeArrow("search", "read before answering"),
          station("bot", "Assistant", [robot(true, 210), h("span", { class: "dthought" }, "?")], num(everyone.length), "recorded questions")),
        tech(h("p", { class: "dtech" }, `${num(counts.quads)} RDF quads · ${num(counts.anchors)} quote anchors · ${num(counts.shapes)} SHACL shapes · ${num(counts.activities_total)} PROV activities`)),
      ],
    });

    // 2. Questions: the whole set at a glance; the one worked through next is outlined.
    add({
      id: "questions", step: "Questions", scope: "demo", anchor: "ask", focus: ".dcard.now",
      headline: `With its memory the model answers ${num(matches)} of the ${num(everyone.length)}; alone, ${aloneAnswered ? num(aloneAnswered) : "none"}`,
      say: `${capital(few(everyone.length, "question was", "questions were"))} recorded. Alone, the model answers ${aloneAnswered ? num(aloneAnswered) : "none"}; with its memory, ${num(matches)}${traps ? `, plus ${few(traps, "trap", "traps")} avoided` : ""}${misses ? ` and ${few(misses, "miss", "misses")} kept on purpose` : ""}.`,
      body: () => [
        h("div", { class: "dboard" }, everyone.map((item, index) => h("div", { class: "dcard" + (item === question ? " now" : ""), onclick: () => showQuestion(index) },
          h("div", { class: "dcard-top" }, h("b", {}, index + 1), h("span", {}, item.text)),
          h("div", { class: "dcard-row" },
            h("span", { class: "dduo" }, robot(false, 104), mark(knowsAlone(item) ? "match" : "unknown")),
            h("span", { class: "darrow", "aria-hidden": "true" }, "→"),
            h("span", { class: "dduo" }, robot(true, 104), mark(item.verdict))),
          APP.VERDICTS[item.verdict] ? h("div", { class: "dcard-verdict" }, h("span", { class: "pverdict " + item.verdict }, APP.VERDICTS[item.verdict])) : null))),
        tech(h("p", { class: "dtech" }, `Answers by ${meta.models.answer}, with and without the recalled block · ${num(corpus.questions)} benchmark questions on this conversation, ${num(everyone.length)} recorded here`)),
      ],
    });

    // 3. Ask: one question, the same model alone and with its memory.
    const [answerLead, answerRest] = leadSentence(question.answer_with);
    const verdict = APP.VERDICTS[question.verdict];
    add({
      id: "ask", step: "Ask", scope: "question", anchor: "ask", focus: ".danswer.with .dbubble",
      headline: {
        match: "With its memory, the model gives the expected answer",
        trap: aloneUnknown ? "Both decline; only one says what it knows" : "A false premise, and the model does not play along",
        miss: "A miss, kept on purpose",
      }[question.verdict] || "The same question, without and with memory",
      say: {
        match: "Take this one. Alone, the model does not know; with its memory, it gives the expected answer.",
        trap: `Take this one, a trap. ${noteLead} Both decline; with its memory, the model also says what it knows.`,
        miss: "Take the miss. The expected fact was stored, but it was not among the memories given to the model.",
      }[question.verdict] || "Take this one: the same model answers alone, then with its memory.",
      body: () => [
        h("div", { class: "dasker" }, avatar("#5a6b7b", 104), h("div", { class: "dbubble question" }, question.text)),
        h("div", { class: "danswers" },
          h("div", { class: "danswer" }, robot(false, 150),
            h("div", { class: "dbubble" }, h("div", { class: "dwho" }, h("span", {}, "Model alone")), h("p", {}, question.answer_without))),
          h("div", { class: "danswer with" }, robot(true, 150),
            h("div", { class: "dbubble" },
              h("div", { class: "dwho" }, h("span", {}, "With its memory graph"),
                verdict ? h("span", { class: "pverdict " + question.verdict }, verdict + (question.verdict === "trap" && aloneUnknown ? " too" : "")) : null),
              h("p", {}, h("strong", {}, answerLead), answerRest)))),
        h("p", { class: "dnote" }, h("b", {}, "Expected: "), question.reference,
          question.note ? h("span", { class: "tech" }, ` · ${question.note}`) : null),
      ],
    });

    // 4. Graph: every memory given to the model, with the concepts it is about. The drawing says nothing of which
    // route found a memory: that is the next beat.
    const drawn = servedGraph(question);
    add({
      id: "graph", step: "Graph", scope: "question", anchor: "ask", focus: ".dlegend",
      headline: `The model was given ${handed} from that graph`,
      say: `It was given ${handed}: here they are, with the concepts they are about.`,
      body: () => [
        memoryGraph(question, memory),
        h("div", { class: "dmore" },
          h("span", { class: "dlegend" }, h("i", { class: "asked" }), "concept in the question", h("i", { class: "concept" }), "other concept",
            h("i", { class: "memory" }), "memory", h("i", { class: "traced" }), "traced two steps on"),
          h("span", { class: "drest" }, `${num(drawn.memories.length)} memories · ${num(drawn.concepts.length)} concepts · ${num(drawn.links.length)} links`)),
        tech(h("p", { class: "dtech" }, `Links drawn: the subjects of each memory. Graph query: ${num(question.graph.pool)} memories in ${ms(question.graph.ms)} (SPARQL CONSTRUCT, at most ${question.graph.hops} SKOS hops, ${num(question.graph.triples)} triples).`)),
      ],
    });

    // 5. Search: how they were found, to scale.
    const asked = APP.recognisedTopics(question);
    add({
      id: "search", step: "Search", scope: "question", anchor: "read", focus: ".dflow .dframe",
      headline: `${num(pool.total)} candidates, ${from.allKept ? "all kept" : `${num(pool.kept)} kept`}: ${graphShare}`,
      say: `No large language model finds them. ${num(pool.total)} candidates, ${from.allKept ? "all kept" : `the best ${num(pool.kept)} kept`}; ${from.keptGraph ? num(from.keptGraph) : "none"} came from the graph query.`,
      body: () => [
        h("div", { class: "dconcepts" }, icon("chat", 52), h("span", { class: "darrow", "aria-hidden": "true" }, "→"),
          asked.slice(0, MAX_NAMED_CONCEPTS).map((row) => h("span", { class: "ppill" }, clip(row.label, 20))),
          asked.length > MAX_NAMED_CONCEPTS ? h("span", { class: "ppill more" }, `+ ${num(asked.length - MAX_NAMED_CONCEPTS)}`) : null,
          h("span", { class: "dchip" }, icon("search", 40), `no large language model · ${ms(question.ms)}`)),
        flowDiagram(question),
        tech(h("p", { class: "dtech" }, `Embedding ${meta.models.embedding} · reciprocal rank fusion (k = ${question.ranking.rrf_k}) · the kept ones ordered by ${question.ranking.model}`)),
      ],
    });

    // 6. Source: one memory and what the graph holds about where it comes from, then the count for all of them.
    const stamp = (iso) => (iso ? `${shortDate(iso)}, ${iso.slice(11, 16)} UTC` : null);
    const failed = total - facts.passed;
    add({
      id: "source", step: "Source", scope: "question", anchor: "provenance", focus: ".dnode.memory",
      headline: facts.quoted === total ? `All ${num(total)} memories trace back to a quote` : `${num(facts.quoted)} of the ${num(total)} memories trace back to a quote`,
      say: `${facts.quoted === total ? `Each of the ${num(total)} links` : `${num(facts.quoted)} of the ${num(total)} link`} back to the exact words said. Here is one, with its check and its records.`,
      body: () => [
        provenanceGraph(memory, quoteTurn, speaker, [
          ["pen", "Written", stamp(activity.started), "written by"],
          ["check", plural(failed, "violation"), `form check, ${counts.shapes} rules`, "checked by", failed ? "bad" : "ok"],
          ["search", "Looked up", stamp(question.prov.started), "used by"],
        ]),
        h("div", { class: "dmore" }, h("span", { class: "drest" }, tiles(facts.quoted, "full"), total > facts.quoted ? tiles(total - facts.quoted) : null,
          `${num(facts.quoted)} of ${num(total)} with their quote`)),
        tech(h("p", { class: "dtech" }, `${memory.iri} · ${activity.operation || "write"} ${activity.iri || ""} · Retrieval ${question.prov.iri}`)),
      ],
    });

    // 7. All of them: the same two counts for every recorded question.
    add({
      id: "all", step: `All ${num(everyone.length)}`, scope: "demo", anchor: "read", focus: ".dacross .dframe",
      headline: `${num(quotedAll)} of ${num(servedAll)} memories given trace back to a quote; ${num(graphAll)} came from the graph query`,
      say: `Over the ${num(everyone.length)} questions: ${num(servedAll)} memories given, ${quotedAll === servedAll ? "all" : num(quotedAll)} traced to a quote, and ${num(graphAll)} from the graph query.`,
      body: () => [
        acrossChart(question),
        tech(h("p", { class: "dtech" }, `Bars: memories kept per question (RETRIEVE_K = ${num(Math.max(...all.map((row) => row.from.pool.kept)))}), by the route that admitted them; the shared-topic route is counted, not listed, in the recording.`)),
      ],
    });

    // 8. Upkeep: the passes that ran on the store after it was written, with what each one reports.
    add({
      id: "upkeep", step: "Upkeep", scope: "demo", anchor: "store", focus: ".dstore",
      headline: `${capital(few(DATA.maintenance.length, "upkeep pass", "upkeep passes"))} ran on the store, each with its report`,
      say: `After writing, ${few(DATA.maintenance.length, "upkeep pass", "upkeep passes")} ran for real. Each reports what it did, even when that is nothing.`,
      body: () => [
        upkeepDiagram(),
        tech(h("p", { class: "dtech" }, DATA.maintenance.map((pass) => pass.command).filter(Boolean)[0] || "")),
      ],
    });

    // 9. Recap: the three things over the whole demo, the page behind the address, the address.
    const points = [
      ["chat", "Ask", `${num(matches)} of ${num(everyone.length)} answered only with memory${traps ? `; ${few(traps, "trap", "traps")} avoided` : ""}${misses ? `, ${few(misses, "miss", "misses")} kept` : ""}`],
      ["search", "Search", `no large language model; ${num(graphAll)} of ${num(servedAll)} from the graph query`],
      ["graph", "Source", `${num(quotedAll)} of ${num(servedAll)} memories traced to a quote`],
    ];
    add({
      id: "recap", step: "Recap", scope: "demo", anchor: "store", focus: ".pqr",
      headline: "A memory you can open and check",
      say: "So: answers, a search without a large language model, and every memory traced to its source. The address is here.",
      body: () => [
        h("div", { class: "drecap" },
          h("div", { class: "dpoints" }, points.map(([name, label, line]) => h("div", { class: "dpoint" }, icon(name, 76), h("span", {}, h("strong", {}, label), line)))),
          h("div", { class: "dpreview" }, h("div", { class: "dchrome", "aria-hidden": "true" }, h("i", {}), h("i", {}), h("i", {})),
            h("img", { src: PREVIEW_SOURCE, alt: "The page behind the address: the same recording, step by step", width: "640", height: "400" })),
          h("div", { class: "pqr" },
            h("img", { src: QR_SOURCE, alt: `QR code to ${DEMO_URL.join("")}`, width: "340", height: "340" }),
            h("a", { class: "purl", href: `https://${DEMO_URL.join("")}/`, tabindex: "-1" }, DEMO_URL[0], h("br"), DEMO_URL[1]))),
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
        `On this question ${num(from.keptGraph)} of the ${num(from.pool.kept)} memories kept came from the graph query${from.keptShared ? `, and ${from.exact ? "" : "at most "}${num(from.keptShared)} through a topic shared with the first candidates, which is also a link followed in the graph` : ""}. Over the ${DATA.questions.length} recorded questions: ${num(sum("keptGraph"))} of ${num(every.reduce((total, item) => total + item.pool.kept, 0))} from the graph query, at most ${num(sum("keptShared"))} through a shared topic. Beyond that, the graph holds the concept layer, the source anchors, the checks and the operation records.`],
      ["Why this question, and what is the score?",
        `The ${DATA.questions.length} questions are taken from the ${num(meta.corpus.questions)} benchmark questions of this conversation, a miss included. No aggregate score is on this page: say where it is, or that it is not shown here.`],
      [`Does the form check (${counts.shapes} rules) verify the facts?`,
        "No. It checks that a record is well formed before it is written; only a violation blocks a write. Truth is checked by going back to the quote."],
      ["How was the drawing of the graph made, and does it show how the memories were found?",
        "Every memory given to the model is drawn with the concepts it is about (its subjects, read back from the graph); the layout is computed, not hand-placed. It says nothing of the route: the next beat does. The picture on the first beat is a pictogram, not data."],
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
        h("h1", { class: "pheadline" }, beat.headline)),
      h("div", { class: "pbody" }, beat.body().flat(Infinity).filter(Boolean)),
      h("footer", { class: "pfoot" },
        h("span", { class: "pcontext" }, beat.scope === "question"
          ? [h("b", { class: "pwhich" }, `Question ${tour.question + 1} of ${DATA.questions.length}`), `“${clip(question.text, 80)}”`]
          : [h("i", { class: "pdot", "aria-hidden": "true" }), stampLine()]),
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
    beats: (questionIndex) => buildBeats(DATA.questions[questionIndex]).map(({ id, step, scope, headline, say, seconds, focus }) => ({ id, step, scope, headline, say, seconds, focus })),
  };

  // ---------- boot ----------
  const fromHash = /^#q(\d+)-(\d+)$/.exec(location.hash);
  if (fromHash) open(APP.state.question, Number(fromHash[2]) - 1);
  else if (new URLSearchParams(location.search).has("present")) open(APP.state.question, 0);
})();
