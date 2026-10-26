// Small hand-written force-directed layout (Fruchterman-Reingold flavour) with a
// spatial grid for repulsion, per-component gravity and a seeded RNG, so the same
// graph always produces the same picture. No dependencies.

const NODE_W = 172;
const NODE_H = 42;

const computeLayout = (nodes, edges, opts) => {
  const out = new Map();
  const n = nodes.length;
  if (!n) return out;
  const K = (opts && opts.k) || 150; // ideal edge length
  const iterations = (opts && opts.iterations) || (n <= 150 ? 260 : n <= 400 ? 170 : 100);
  const SX = 0.72; // nodes are wide: horizontal distances count for less

  let seed = 20240607;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const index = new Map();
  nodes.forEach((nd, i) => index.set(nd.id, i));
  const links = [];
  const adj = nodes.map(() => []);
  edges.forEach((e) => {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a === undefined || b === undefined || a === b) return;
    links.push([a, b]);
    adj[a].push(b);
    adj[b].push(a);
  });

  // connected components
  const comp = new Array(n).fill(-1);
  const comps = [];
  for (let i = 0; i < n; i++) {
    if (comp[i] !== -1) continue;
    const id = comps.length;
    const members = [];
    const stack = [i];
    comp[i] = id;
    while (stack.length) {
      const v = stack.pop();
      members.push(v);
      adj[v].forEach((w) => { if (comp[w] === -1) { comp[w] = id; stack.push(w); } });
    }
    comps.push(members);
  }
  // biggest first, packed on a spiral
  const order = comps.map((m, i) => i).sort((a, b) => comps[b].length - comps[a].length);
  const centers = new Array(comps.length);
  let angle = 0;
  order.forEach((ci, rank) => {
    const size = comps[ci].length;
    const radius = Math.sqrt(size) * K * 0.55;
    if (rank === 0) { centers[ci] = [0, 0]; return; }
    const dist = K * 3.2 + Math.sqrt(rank) * K * 2.2 + radius;
    angle += 2.399963; // golden angle
    centers[ci] = [Math.cos(angle) * dist * 1.25, Math.sin(angle) * dist * 0.85];
  });

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  comps.forEach((members, ci) => {
    const [cx, cy] = centers[ci];
    const r = Math.sqrt(members.length) * K * 0.5 + 20;
    members.forEach((v, j) => {
      const a = (j / members.length) * Math.PI * 2 + rnd() * 0.4;
      const rr = r * (0.35 + rnd() * 0.65);
      x[v] = cx + Math.cos(a) * rr;
      y[v] = cy + Math.sin(a) * rr;
    });
  });

  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const cutoff = K * 3;
  let t = K * 1.6;
  const cool = Math.pow(0.02, 1 / iterations);

  for (let it = 0; it < iterations; it++) {
    dx.fill(0);
    dy.fill(0);

    // repulsion through a grid
    const grid = new Map();
    for (let i = 0; i < n; i++) {
      const key = `${Math.floor(x[i] / cutoff)},${Math.floor(y[i] / cutoff)}`;
      const cell = grid.get(key);
      if (cell) cell.push(i); else grid.set(key, [i]);
    }
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(x[i] / cutoff);
      const gy = Math.floor(y[i] / cutoff);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const cell = grid.get(`${gx + ox},${gy + oy}`);
          if (!cell) continue;
          for (let c = 0; c < cell.length; c++) {
            const j = cell[c];
            if (j <= i) continue;
            let ex = (x[i] - x[j]) * SX;
            let ey = y[i] - y[j];
            let d2 = ex * ex + ey * ey;
            if (d2 > cutoff * cutoff) continue;
            if (d2 < 0.01) { ex = rnd() - 0.5; ey = rnd() - 0.5; d2 = ex * ex + ey * ey + 0.01; }
            const d = Math.sqrt(d2);
            const f = (K * K) / d2; // force / distance
            const fx = ex * f;
            const fy = ey * f;
            dx[i] += fx; dy[i] += fy;
            dx[j] -= fx; dy[j] -= fy;
          }
        }
      }
    }

    // attraction along edges
    for (let l = 0; l < links.length; l++) {
      const a = links[l][0];
      const b = links[l][1];
      const ex = (x[a] - x[b]) * SX;
      const ey = y[a] - y[b];
      const d = Math.sqrt(ex * ex + ey * ey) + 0.01;
      const f = d / K; // (d^2 / K) / d
      dx[a] -= ex * f; dy[a] -= ey * f;
      dx[b] += ex * f; dy[b] += ey * f;
    }

    // gravity toward the component centre
    for (let i = 0; i < n; i++) {
      const c = centers[comp[i]];
      dx[i] -= (x[i] - c[0]) * 0.35;
      dy[i] -= (y[i] - c[1]) * 0.35;
    }

    for (let i = 0; i < n; i++) {
      const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
      const step = Math.min(len, t);
      x[i] += ((dx[i] / len) * step) / SX;
      y[i] += (dy[i] / len) * step;
    }
    t *= cool;
  }

  nodes.forEach((nd, i) => out.set(nd.id, { x: Math.round(x[i] - NODE_W / 2), y: Math.round(y[i] - NODE_H / 2) }));
  return out;
};

module.exports = { computeLayout, NODE_W, NODE_H };
