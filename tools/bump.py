#!/usr/bin/env python3
"""Ustawia nowy numer wersji (dla odświeżania pamięci podręcznej telefonów). Uruchom przed każdym wgraniem."""
import re, time, pathlib, json
root = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime("%Y%m%d-%H%M%S")
idx = root / "index.html"; s = idx.read_text()
s = re.sub(r'src="app\.js(\?v=[^"]*)?"', f'src="app.js?v={v}"', s)
s = re.sub(r'href="manifest\.json(\?v=[^"]*)?"', f'href="manifest.json?v={v}"', s); idx.write_text(s)
app = root / "app.js"; a = app.read_text()
a = re.sub(r'from "\./scoring\.js(\?v=[^"]*)?"', f'from "./scoring.js?v={v}"', a)
a = re.sub(r'from "\./firebase-config\.js(\?v=[^"]*)?"', f'from "./firebase-config.js?v={v}"', a)
a = re.sub(r'const BUILD = "[^"]*";', f'const BUILD = "{v}";', a); app.write_text(a)
(root / "version.json").write_text(json.dumps({"v": v}))
print(v)
