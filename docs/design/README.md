# Orca design export

This folder is the Orca UI design, exported from the design canvas for agents and people building the app. The live canvas is the source of truth: https://claude.ai/artifact/S2df3B2VXM8gn1Lua2UWnN. This folder is a snapshot (exported 2026-10-18). Don't edit generated files here; change the canvas and re-export.

Read `../design-spec.md` and `../../GLOSSARY.md` first for architecture, behavior and vocabulary, then this README, then the artboards relevant to your task.

## What's here

| Path | What it is | Use it to |
| --- | --- | --- |
| `manifest.json` | Every artboard: id, title, role, size, files, what it's for | Find the right artboard before opening anything |
| `png/<id>.png` | 2× screenshot of each artboard | **Look** at the design. Open with your image/Read tool |
| `html/<id>.html` | Standalone static HTML, no runtime, all styles inline | Copy exact markup, CSS values, copy text and SVG icons |
| `source/<id>.dc.html` | Original canvas source | Reference only; needs the canvas runtime to render |
| `source/canvas.json` | Canvas layout and sticky notes | Reference only |
| `tokens.css` | Color (dark + light), radius, spacing, font tokens and the circle allowlist | Import into the renderer as-is |
| `NOTES.md` | Designer's sticky notes per artboard: backend needs, feasibility risks, tradeoffs | Check before building a screen |

PNGs were rendered on Linux, so text is in a fallback font, not SF Pro. Layout, sizes and colors are exact. Open the HTML in a browser on a Mac to see real type.

## Artboard roles and precedence

| Role | Artboards | Treat as |
| --- | --- | --- |
| `spec` | ImplLayout (I1), ImplShapes (I2), ImplBadges (I3), ImplClose (I4), ImplControls (I5), ImplInteractions (I6) | **Binding.** Exact numbers, rules and behavior |
| `flow` | Storyboard (S) | Binding for flow order, triggers and results; also the build order and the list of missing states |
| `screen` | Main, Approval, Done, QuickAnswer, Notification, Settings | Binding for layout, hierarchy and copy |
| `state` | States, Loading, Empty, Errors, EdgeCases | Binding for what each state shows |
| `theme` | LightMode (L) | Binding for light theme; built from the same tokens |
| `history` | CritiqueLog | Rationale only. Never build from it |

When sources disagree, use this order:

1. `docs/design-spec.md`, especially **Decisions** and **Design changes needed**, plus `GLOSSARY.md`. The spec was updated after the artboards were drawn and overrides them.
2. Spec sheets I1–I6.
3. Storyboard.
4. Screens and states.

Use `GLOSSARY.md` terms in code and copy (Ask, Approval, Question, Account, Profile, Session, Risk tier, …) even where an artboard still says "request", "account tab" or "Moves to Cursor". The artboards are not yet updated for the items under **Design changes needed** in the spec; build those from the spec text.

Two gaps the spec doesn't list:

- Count badge and Settings pip get a 2px ring in `--surface-2` (I3). Screens 1–11 don't draw it. Follow I3.
- Screens use filled Font Awesome-style icons; I1, I5 and L use 1.8px stroke icons. The icon set is undecided. Ask before choosing; don't mix both.

If you find another conflict, don't guess. Note it in your handoff, with both sources, and follow the higher-precedence one.

## Rules that are easy to get wrong

These come from I2–I4. Check every component against them.

1. **No over-rounding.** Radii come only from `--r-*` in `tokens.css`. Buttons are 9px, not pills. Icon buttons and close X's are 28×28 with 8px, not circles. Rail tiles are 48×48 with 14px, not circles. Risk chips are 6px, not pills. `9999px`, `100%` and `50%` outside the circle allowlist are bugs.
2. **Circles are only:** `.dot` (8 or 10), `.swatch` (22), `.knob` (18), `.pip` (16), spinner (14). Always set equal width and height plus `flex: none`, or flex rows stretch them into ovals.
3. **Half-height radii are written in px.** Badge: `height: 18px; border-radius: 9px`. Switch track: `height: 22px; border-radius: 11px`. Never `50%` on a box that can be wider than tall.
4. **Badge placement.** The badge is a child of the 48px tile (`position: relative`, no `overflow`), at `top: -4px; right: -6px`, `min-width: 18px; height: 18px; padding: 0 5px`. It grows leftward. 0 means remove the element. 100+ shows `99+`. Tray and tab counts are plain text, never badges.
5. **Close X placement.** Last child of its row, rightmost, aligned to the first text line (`align-items: flex-start`). Negative margins align the glyph to the padding edge: toast `-2px -4px 0 0`, card header `-3px -6px -3px 0`. Never absolutely positioned over a corner. Only toasts and resolved cards have an X; everything else closes by Esc, blur or Back.
6. **Approve is always rightmost.** Then Deny to its left, then status text. Split button = two buttons, 1px gap, radii `9px 0 0 9px` / `0 9px 9px 0`.
7. **The main process owns state.** Renderers send intents (`request:decide`, `question:answer`, …) and render `inbox:snapshot`. A request is decided at most once. Contract: I6 §5.

## How to use it for a task

1. Open `manifest.json` and pick the artboards whose `useFor` matches your task.
2. Look at the PNG to see the whole thing. Then open the HTML for exact values.
3. Lift values, not markup wholesale. The HTML is static mockup markup with inline styles. Rebuild it as real components that use `tokens.css` variables, real `<button>`s and the IPC contract.
4. Check `NOTES.md` for that artboard's backend and feasibility notes before starting.
5. Build in Storyboard order: F2 and F4 are the MVP, then F1, F6, F8, F9, F10, then F3, F5, F7.
6. Before handing off, compare your running UI against the PNG at the same size. List any deviation and why.

## Re-exporting

The export is generated by a script that strips the canvas runtime, inlines styles, expands the Storyboard template and screenshots each artboard at 2× with headless Chromium. Ask Claude to "re-export the Orca design to docs/design" after changing the canvas.
