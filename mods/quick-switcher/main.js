// Go to a tab. A clone of Herdr's picker that draws only the rows on screen: with
// ~40 agents on two machines the shipped one builds every row on each render and
// runs past the app's ~50 ms render limit ("interrupted"). Spaces with something
// that needs you come first, quiet spaces fold into "earlier". Type to filter, ↑/↓
// and Enter to go, ctrl+d to close a tab, Esc to leave. Last rows: new work (a tab
// here, a space on this computer or on each connected machine).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, VirtualListScrollHandle, v_virtual_list } from "gpui-base";
import { agents, spaces, terminals, run, hc, theme, props, closeOverlay, shared, setShared } from "herdr";
import { HEIGHT, pickable, groups, rows, assignColors } from "./model.js";

const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const LIST_MAX = 320;

export default class Picker extends View {
  init(_props, cx) {
    this.filter = "";
    this.showEarlier = false;
    this.machines = [];
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.input = InputState.new({ placeholder: "Go to a tab, space or agent…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", () => this.go(this.picks()[this.at]));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    // Opens on where you are.
    const all = this.rows(), picks = all.filter(pickable);
    this.at = Math.max(0, picks.findIndex((r) => r.kind === "ctx" && r.w.active && r.tab.active));
    this.reveal(all, picks[this.at]);
    // Colors are saved here, once: writing shared state from render re-renders every mod.
    const { colors, changed } = assignColors(spaces(), shared("space.colors"));
    if (changed) setShared("space.colors", colors);
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => m.state === "connected" && !m.temporary).map((m) => m.name);
      } catch {}
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  rows() {
    return rows(groups({ spaces: spaces(), agents: agents(), terminals: terminals() }), { filter: this.filter, showEarlier: this.showEarlier, machines: this.machines });
  }

  picks() {
    return this.rows().filter(pickable);
  }

  go(r) {
    if (!r) return;
    this.close();
    if (r.kind === "ctx") run("tab.select", { id: r.tab.id });
    else if (r.kind === "new") run("tab.new");
    else if (r.kind === "space") run("space.new", r.machine ? { machine: r.machine } : {});
  }

  glyph(t, st) {
    if (st === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    return div().w(12).flex_none().text_color(t[st] ?? t.dim).child(st === "idle" ? "○" : st ? "●" : "·");
  }

  // Rows are drawn inside the list's layout, where handlers aren't allowed: clicks
  // come through the list's on_item_click with the row's key.
  row(t, r, sel, colors) {
    if (r.kind === "head") {
      const c = r.w.name === "~" ? t.dim : colors[r.w.id] ?? "ansi6";
      return h_flex().h(HEIGHT.head).px(10).pt(10).pb(3).gap(8).items_center().text_size(11).font_semibold().text_color(t.dim)
        .child(h_flex().size(18).rounded(5).bg(c.startsWith("#") ? c : MARK[c] ?? t[c] ?? c).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff")
          .child([...r.w.name][0]?.toUpperCase() ?? "?"))
        .child(r.w.name);
    }
    if (r.kind === "earlier") {
      return h_flex().h(HEIGHT.earlier).mt(6).px(10).items_center().border_t(1).border_color(t.border).text_size(12).text_color(t.dim).cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .child(`earlier: ${r.count} quiet space${r.count > 1 ? "s" : ""} ${this.showEarlier ? "▴" : "▾"}`);
    }
    const on = r === sel;
    if (r.kind === "new" || r.kind === "space") {
      return h_flex().h(r.kind === "new" ? HEIGHT.new : HEIGHT.space).mx(4).px(10).items_center().rounded(7).gap(8).text_color(t.muted).cursor_pointer()
        .when(r.kind === "new", (el) => el.pt(4))
        .when(on, (el) => el.bg(t.hover))
        .hover((s) => s.bg(t.hover))
        .child(div().w(12).child("+"))
        .child(r.kind === "new" ? "new tab" : r.machine ? `new space on ${r.machine}` : "new space");
    }
    const who = r.mine.map((a) => a.program?.name ?? "agent").join(" · ");
    return h_flex().h(HEIGHT.ctx).mx(4).px(10).rounded(7).gap(10).items_center().cursor_pointer()
      .when(on, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover))
      .child(this.glyph(t, r.tab.status))
      .child(div().flex_1().truncate().text_color(t.foreground).when(r.w.active && r.tab.active, (d) => d.font_semibold()).child(r.tab.name))
      .when(r.tab.status === "blocked", (el) => el.child(div().text_size(11).text_color(t.blocked).child("needs you")))
      .when(r.tab.status === "done", (el) => el.child(div().text_size(11).text_color(t.done).child("finished")))
      .child(div().text_size(11).text_color(t.dim).child(who + (r.team ? `  +${r.team}` : "")));
  }

  render() {
    const t = theme();
    const all = this.rows(), picks = all.filter(pickable);
    this.at = Math.min(this.at, picks.length - 1);
    const sel = picks[this.at];
    const colors = assignColors(spaces(), shared("space.colors")).colors;
    const heights = all.map((r) => HEIGHT[r.kind]);
    const step = (by) => { this.at = (this.at + by + picks.length) % picks.length; this.reveal(all, picks[this.at]); };

    return v_flex().id("picker").track_focus(this.handle).w_full().min_h(0).p(18).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.close();
        if (k === "down") step(1);
        else if (k === "up") step(-1);
        else if (k === "d" && e.modifiers.control) {
          if (sel?.kind === "ctx") {
            this.close();
            run("tab.close", { id: sel.tab.id });
          }
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Go to…")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(v_virtual_list("pk-rows", all.length, heights, (i) => all[i].key, (range) => all.slice(range.start, range.end).map((r) => this.row(t, r, sel, colors)))
        .h(Math.min(LIST_MAX, 6 + heights.reduce((a, b) => a + b, 0))).pb(6).track_scroll(this.scroll)
        .on_item_click((key, cx) => {
          if (key === "earlier") { this.showEarlier = !this.showEarlier; cx.notify(); return; }
          this.go(all.find((r) => r.key === key && pickable(r)));
        }));
  }

  reveal(all, r) {
    const i = all.indexOf(r);
    if (i >= 0) this.scroll.scroll_to_item(i);
  }
}
