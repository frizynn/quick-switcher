// The picker's rows, from Herdr's live data. No Herdr imports, so it runs under
// node's tests too.

export const HEIGHT = { head: 29, ctx: 32, earlier: 35, new: 36, space: 32 };
export const pickable = (r) => r.kind === "ctx" || r.kind === "new" || r.kind === "space";

// Each space with its tabs, the agents in each tab, the sub-agents under them, and
// the text a filter matches.
export function groups({ spaces, agents, terminals }) {
  const children = new Map();
  for (const x of terminals) {
    if (x.state !== "live" || !x.parent) continue;
    if (!children.has(x.parent)) children.set(x.parent, []);
    children.get(x.parent).push(x.address);
  }
  const team = (addr, seen = new Set([addr])) => (children.get(addr) ?? [])
    .reduce((n, k) => (seen.has(k) ? n : (seen.add(k), n + 1 + team(k, seen))), 0);
  const byTab = new Map();
  for (const a of agents) {
    if (!byTab.has(a.tab)) byTab.set(a.tab, []);
    byTab.get(a.tab).push(a);
  }
  return spaces.map((w) => ({
    w,
    tabs: w.tabs.map((tab) => {
      const mine = byTab.get(tab.id) ?? [];
      const text = [w.name, tab.name, ...mine.map((a) => a.program?.name ?? "")].join(" ").toLowerCase();
      return { w, tab, mine, team: mine.reduce((n, a) => n + team(a.address), 0), text };
    }),
  }));
}

// Spaces with something going on first (blocked ones on top), then quiet spaces
// folded into "earlier" unless opened or filtering, then the rows that start work.
export function rows(all, { filter = "", showEarlier = false, machines = [] } = {}) {
  const f = filter.trim().toLowerCase();
  const matching = all.map((g) => ({ w: g.w, tabs: f ? g.tabs.filter((c) => c.text.includes(f)) : g.tabs })).filter((g) => g.tabs.length);
  const busy = matching.filter((g) => g.w.status).sort((a, b) => (b.w.status === "blocked") - (a.w.status === "blocked"));
  const quiet = matching.filter((g) => !g.w.status);
  const out = [];
  const add = (g) => {
    out.push({ kind: "head", key: `h:${g.w.id}`, w: g.w });
    for (const c of g.tabs) out.push({ kind: "ctx", key: `t:${c.tab.id}`, ...c });
  };
  busy.forEach(add);
  if (quiet.length) {
    out.push({ kind: "earlier", key: "earlier", count: quiet.length });
    if (showEarlier || f) quiet.forEach(add);
  }
  out.push({ kind: "new", key: "new" });
  out.push({ kind: "space", key: "s:", machine: null });
  for (const m of machines) out.push({ kind: "space", key: `s:${m}`, machine: m });
  return out;
}

// Space colors, kept by space id in shared "space.colors": a theme color name
// ("ansi6") or a picked #rrggbb. A space seen without one gets the color fewest
// spaces use, in space order, the same way every mod does, so they agree.
export const COLORS = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
export function assignColors(spaces, saved) {
  const ids = new Set(spaces.map((p) => p.id));
  const kept = Object.fromEntries(Object.entries(saved ?? {}).filter(([id]) => ids.has(id)));
  let changed = Object.keys(kept).length !== Object.keys(saved ?? {}).length;
  for (const p of spaces) {
    if (kept[p.id] || p.name === "~") continue;
    const uses = (c) => Object.values(kept).filter((v) => v === c).length;
    kept[p.id] = COLORS.reduce((best, c) => (uses(c) < uses(best) ? c : best));
    changed = true;
  }
  return { colors: kept, changed };
}
