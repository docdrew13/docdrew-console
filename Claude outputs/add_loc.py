# Adds the visible weather-location search (city/ZIP) to pages that still have the globe-era dropdown only.
import os, sys
ROOT = os.path.expanduser("~/mnt/docdrew-console")
src = open(ROOT + "/Claude outputs/build_aa.py", encoding="utf-8").read()
ns = {}; exec(src[:src.index("\nAVIVA_NEWS")], ns)
rep = ns["rep"]
for slug in sys.argv[1:]:
    p = ROOT + "/public/for-%s/index.html" % slug
    s = open(p, encoding="utf-8").read()
    assert "wx-loc-btn" not in s, slug
    s = rep(s, '<div class="panel-head"><span>Weather</span><button class="head-btn" id="wx-unit-btn"',
            '<div class="panel-head"><span>Weather</span><button class="head-btn" id="wx-loc-btn" type="button" title="Change location (search any city or ZIP)">📍</button><button class="head-btn" id="wx-unit-btn"')
    s = rep(s, '            <div class="panel-body scroll" id="wx-body">',
            '            <div class="wx-loc-box" id="wx-loc-box" hidden>\n'
            '              <form id="wx-loc-form"><input type="text" id="wx-loc-input" placeholder="City or ZIP" autocomplete="off" aria-label="Search for a city or ZIP code"><button type="submit">Find</button></form>\n'
            '              <div class="wx-loc-results" id="wx-loc-results"></div>\n'
            '            </div>\n'
            '            <div class="panel-body scroll" id="wx-body">')
    s = rep(s, "</style>", ns["LOC_CSS"] + "</style>")
    s = rep(s, "    sel.innerHTML = html;\n    sel.value = homeCity.name;",
            "    sel.innerHTML = html;\n"
            "    if(!WORLD_CITIES.some(function(c){ return c.name === homeCity.name; })){ sel.insertAdjacentHTML(\"afterbegin\", '<option value=\"' + escapeHtml(homeCity.name) + '\">' + escapeHtml(homeCity.name) + \"</option>\"); }\n"
            "    sel.value = homeCity.name;")
    rail = "  /* ============================================================\n     RIGHT-RAIL ACCORDION"
    s = rep(s, rail, ns["LOC_JS"] + rail)
    open(p, "w", encoding="utf-8").write(s)
    open("/tmp/%s.js" % slug, "w").write(s[s.rindex("<script>") + 8:s.rindex("</script>")])
    print(slug, "location search added")
