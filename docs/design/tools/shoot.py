"""Screenshot each standalone artboard at 2x. Usage: python3 -I shoot.py <out_dir>"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

OUT = sys.argv[1]
manifest = json.load(open(os.path.join(OUT, "manifest.raw.json")))
with sync_playwright() as p:
    browser = p.chromium.launch()
    for a in manifest:
        page = browser.new_page(viewport={"width": a["width"], "height": a["height"]}, device_scale_factor=2)
        page.goto("file://" + os.path.abspath(os.path.join(OUT, a["html"])))
        page.wait_for_timeout(150)
        page.screenshot(path=os.path.join(OUT, a["png"]), clip={"x": 0, "y": 0, "width": a["width"], "height": a["height"]})
        page.close()
    browser.close()
print("ok")
