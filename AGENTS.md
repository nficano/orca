# Orca

Desktop hub (Electron, macOS) for approving and answering Claude Code and Codex sessions. Vocabulary: `GLOSSARY.md`.

## Before building any UI

1. Read `docs/design-spec.md` for architecture and behavior.
2. Read `docs/design/README.md`, then open the artboards from `docs/design/manifest.json` that match the task. Look at `png/`, take exact values from `html/`.
3. Use `docs/design/tokens.css` for every color, radius and spacing value. No other radii; no `9999px`/`100%`; `50%` only for the circle allowlist.
4. Precedence when sources disagree: `docs/design-spec.md` (Decisions, Design changes needed) and `GLOSSARY.md` > spec sheets I1–I6 > Storyboard > screens/states. Report conflicts in your handoff instead of guessing.

`docs/design/` is generated from the design canvas. Don't hand-edit it; ask for a re-export.
