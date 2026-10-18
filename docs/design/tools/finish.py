"""Write manifest.json and NOTES.md for the design export. Usage: python3 -I finish.py <design_dir>"""
import json
import os
import sys

D = sys.argv[1]
raw = json.load(open(os.path.join(D, "manifest.raw.json")))
canvas = json.load(open(os.path.join(D, "source", "canvas.json")))

META = {
    "Main": ("screen", "Menu-bar popover inbox: request and question cards, account tabs, rail, footer, context menu."),
    "Approval": ("screen", "Approval detail: step-by-step command, agent's reason, instead-field, Always-allow sheet."),
    "Done": ("screen", "Done tab: overnight recap bar, done cards, send back to fix, earlier list."),
    "QuickAnswer": ("screen", "Global-hotkey quick-answer panel for ask_user questions."),
    "Notification": ("screen", "macOS notification banners for requests and questions, and the options dropdown."),
    "Settings": ("screen", "Settings: General (timeouts, Touch ID, notify, shortcut, stall), Accounts, Rules."),
    "States": ("state", "Empty inbox, busy inbox with batch row and grouped requests, stalled and looping sessions."),
    "Loading": ("state", "Startup per account, summary loading, answer in flight, Done loading."),
    "Empty": ("state", "First run account connect, empty account tab, empty Done."),
    "Errors": ("state", "System problems banners, request-level failures, rule-write toast, recovery after restart."),
    "EdgeCases": ("state", "Long commands, heredocs, masked secrets, long titles and branch names, long questions."),
    "CritiqueLog": ("history", "Design critique rounds and decision log. Rationale only."),
    "Storyboard": ("flow", "All ten user flows frame by frame, build order, and the state coverage matrix with gaps."),
    "ImplLayout": ("spec", "Popover redlines: every region's size, padding, radius; tray anchoring; BrowserWindow options."),
    "ImplShapes": ("spec", "Color tokens (dark + light), radius scale, circle allowlist, over-rounding do/don't, stylelint, type scale."),
    "ImplBadges": ("spec", "Count badge, Settings pip, tray/tab counts and dots: DOM anchor, offsets, growth, motion, a11y."),
    "ImplClose": ("spec", "Close/dismiss X and icon buttons: size, states, placement rules, surfaces without an X."),
    "ImplControls": ("spec", "Buttons, split button, switch, swatches, chips, keys, fields, progress and a full state matrix."),
    "ImplInteractions": ("spec", "Request state machine, keyboard map, per-surface behavior, motion table, IPC contract."),
    "LightMode": ("theme", "Inbox, approval detail and quick answer in light theme, plus what changes between themes."),
}
NOTE_TO = {"Inbox": "Main", "Approval": "Approval", "Done": "Done", "Quick answer": "QuickAnswer",
           "Notifications": "Notification", "States": "States", "Loading": "Loading", "Empty": "Empty",
           "Errors": "Errors", "Settings": "Settings", "Edge cases": "EdgeCases"}

notes_by = {}
for nid, n in sorted(canvas["notes"].items()):
    if n.get("kind"):
        continue
    first, _, rest = n["text"].partition("\n")
    key = next((v for k, v in NOTE_TO.items() if first.startswith(k)), None)
    if key:
        notes_by.setdefault(key, []).append((first, rest.strip()))

manifest = {"title": canvas["title"], "canvas": "https://claude.ai/artifact/S2df3B2VXM8gn1Lua2UWnN",
            "exported": "2026-10-18", "precedence": ["spec", "flow", "screen", "state", "theme"], "artboards": []}
for a in raw:
    role, use = META[a["id"]]
    manifest["artboards"].append({**a, "role": role, "useFor": use, "hasNotes": a["id"] in notes_by})
json.dump(manifest, open(os.path.join(D, "manifest.json"), "w"), indent=2, ensure_ascii=False)
os.remove(os.path.join(D, "manifest.raw.json"))

lines = ["# Orca design notes", "",
         "Sticky notes from the design canvas, grouped by artboard. Tags: **BACKEND** = data or plumbing the UI needs; "
         "**FEASIBLE?** = platform risk to spike; **PERMISSION** = a write or auth step that needs consent; "
         "**TRADEOFF** = a deliberate choice; **Open** = unresolved.", ""]
for a in manifest["artboards"]:
    if a["id"] not in notes_by:
        continue
    lines += [f"## {a['title']}", "", f"`png/{a['id']}.png` · `html/{a['id']}.html`", ""]
    for head, body in notes_by[a["id"]]:
        if head != a["title"] and "(" in head:
            lines.append(f"_{head}_")
        for ln in body.splitlines():
            ln = ln.strip()
            for tag in ("BACKEND", "FEASIBLE?", "PERMISSION", "TRADEOFF"):
                ln = ln.replace(f"[{tag}]", f"**{tag}**")
            lines.append(f"- {ln}")
        lines.append("")
open(os.path.join(D, "NOTES.md"), "w").write("\n".join(lines))
print("manifest", len(manifest["artboards"]), "notes for", len(notes_by))
