"""Convert Design-canvas .dc.html artboards into standalone static HTML + PNG screenshots.

Usage: python3 -I build.py <src_project_dir> <out_dir>
"""
import html as htmllib
import json
import os
import re
import subprocess
import sys

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(OUT, "html"), exist_ok=True)
os.makedirs(os.path.join(OUT, "png"), exist_ok=True)
os.makedirs(os.path.join(OUT, "source"), exist_ok=True)

canvas = json.load(open(os.path.join(SRC, "canvas.json")))
boards = dict(canvas["boards"])
order = list(canvas["order"])

NODE_EVAL = r"""
const fs = require('fs');
const src = fs.readFileSync(process.argv[1], 'utf8');
const m = src.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/);
class DCLogic { constructor(){ this.props = {}; this.state = {}; } setState(){} forceUpdate(){} }
const Component = new Function('DCLogic', m[1] + '\nreturn Component;')(DCLogic);
const c = new Component();
process.stdout.write(JSON.stringify(c.renderVals()));
"""


def lookup(path, scope):
    path = path.strip()
    if path in ("true", "false"):
        return path == "true"
    cur = scope
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return ""
    return cur


def holes(text, scope):
    def rep(m):
        v = lookup(m.group(1), scope)
        if isinstance(v, bool):
            v = "true" if v else "false"
        return htmllib.escape(str(v), quote=True)
    return re.sub(r"\{\{\s*([^}]+?)\s*\}\}", rep, text)


def find_close(s, tag, start):
    """Return (inner_end, close_end) for the element whose open tag ends at start."""
    depth = 1
    pat = re.compile(r"<(/?)%s\b[^>]*>" % tag)
    for m in pat.finditer(s, start):
        depth += -1 if m.group(1) else 1
        if depth == 0:
            return m.start(), m.end()
    raise ValueError("unclosed <%s>" % tag)


def expand(s, scope):
    out, i = [], 0
    pat = re.compile(r"<(sc-for|sc-if)\b([^>]*)>")
    while True:
        m = pat.search(s, i)
        if not m:
            out.append(holes(s[i:], scope))
            break
        out.append(holes(s[i:m.start()], scope))
        tag, attrs = m.group(1), m.group(2)
        inner_end, close_end = find_close(s, tag, m.end())
        inner = s[m.end():inner_end]
        if tag == "sc-for":
            lst = lookup(re.search(r'list="\{\{\s*([^}]+?)\s*\}\}"', attrs).group(1), scope) or []
            name = re.search(r'as="([^"]+)"', attrs).group(1)
            for idx, item in enumerate(lst):
                out.append(expand(inner, {**scope, name: item, "$index": idx}))
        else:
            if lookup(re.search(r'value="\{\{\s*([^}]+?)\s*\}\}"', attrs).group(1), scope):
                out.append(expand(inner, scope))
        i = close_end
    return "".join(out)


manifest = []
for name in order:
    path = os.path.join(SRC, name)
    if not os.path.exists(path):
        print("missing", name)
        continue
    raw = open(path, encoding="utf-8").read()
    open(os.path.join(OUT, "source", name), "w", encoding="utf-8").write(raw)
    title = re.search(r"<title>(.*?)</title>", raw).group(1)
    xdc = re.search(r"<x-dc>([\s\S]*)</x-dc>", raw).group(1)
    css = "\n".join(re.findall(r"<helmet>\s*<style>([\s\S]*?)</style>\s*</helmet>", xdc))
    body = re.sub(r"<helmet>[\s\S]*?</helmet>", "", xdc).strip()
    if "sc-for" in body or "{{" in body:
        vals = json.loads(subprocess.check_output(["node", "-e", NODE_EVAL, path]))
        body = expand(body, vals)
    body = re.sub(r'href="([A-Za-z0-9_]+)\.dc\.html"', r'href="\1.html"', body)
    stem = name[:-len(".dc.html")]
    b = boards[name]
    page = (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        f"<meta name=\"viewport\" content=\"width={b['w']}\">\n<title>{title}</title>\n"
        f"<!-- Orca design artboard · {b['title']} · {b['w']}x{b['h']} · generated from source/{name}; edit the canvas, not this file -->\n"
        f"<style>\n{css}\nhtml{{background:oklch(13% .003 70)}}\n</style>\n</head>\n<body>\n{body}\n</body>\n</html>\n"
    )
    open(os.path.join(OUT, "html", stem + ".html"), "w", encoding="utf-8").write(page)
    manifest.append({"id": stem, "title": b["title"], "width": b["w"], "height": b["h"],
                     "html": f"html/{stem}.html", "png": f"png/{stem}.png", "source": f"source/{name}"})

json.dump(manifest, open(os.path.join(OUT, "manifest.raw.json"), "w"), indent=2, ensure_ascii=False)
open(os.path.join(OUT, "source", "canvas.json"), "w").write(json.dumps(canvas, indent=2, ensure_ascii=False))
print(len(manifest), "artboards")
