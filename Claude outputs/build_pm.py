# Maria: personal page; Groceries shared live with Peter + Julia (owner pj-shared); Reminders PRIVATE to Maria (owner maria)
# but with the same Share / Text-it options. Built from Peter's original template (commit 4929cd4).
import os, re, subprocess
ROOT = os.path.expanduser("~/mnt/docdrew-console")
src = open(ROOT + "/Claude outputs/build_aa.py", encoding="utf-8").read()
ns = {}
exec(src[:src.index("\nAVIVA_NEWS")], ns)
rep = ns["rep"]
orig = subprocess.check_output(["git", "-C", ROOT, "show", "4929cd4:public/for-peter/index.html"]).decode("utf-8")
assert "pj-shared" not in orig
s = orig

s = rep(s, '    groceries: "dds-peter-groceries",',
        '    groceries: "dds-pj-shared-groceries",\n    reminders: "dds-maria-reminders",')
s = s.replace("dds-peter-", "dds-maria-")
s = rep(s, '  var SYNC_OWNER = "peter";',
        '  var SYNC_OWNER = "maria";\n'
        '  var SHARED_OWNER = "pj-shared";   // Groceries only: shared live with Peter and Julia. Reminders stay private (owner "maria").\n'
        '  function syncOwnerFor(collection){ return collection === "groceries" ? SHARED_OWNER : SYNC_OWNER; }')
s = rep(s, '"&owner=" + SYNC_OWNER', '"&owner=" + syncOwnerFor(collection)', count=2)

# Groceries: shared marker; private Reminders panel above it
gro = '        <section class="panel" data-accent="crimson" data-panel-key="groceries" aria-label="Grocery list">\n          <div class="panel-head"><span>Groceries</span><i class="panel-chevron">▾</i></div>'
new_gro = ('        <section class="panel" data-accent="crimson" data-panel-key="groceries" data-shared="1" aria-label="Grocery list">\n'
           '          <div class="panel-head"><span>Groceries</span><em class="shared-tag" title="Shared live with Peter and Julia">⇄ Shared</em><i class="panel-chevron">▾</i></div>')
priv = ('        <section class="panel" data-accent="teal" data-panel-key="reminders" aria-label="Reminders">\n'
        '          <div class="panel-head"><span>Reminders</span><i class="panel-chevron">▾</i></div>\n'
        '          <div class="panel-body scroll" id="reminders-body"></div>\n'
        '        </section>\n')
s = rep(s, gro, priv + new_gro)
s = rep(s, "</style>", ns["REMINDERS_CSS"] + ns["SHARED_CSS"] + "</style>")

js = ns["REMINDERS_JS"]
js = rep(js, '"/api/sync?collection=reminders&owner=" + SHARED_OWNER', '"/api/sync?collection=reminders&owner=" + SYNC_OWNER')
js = rep(js, 'by: G_FROM, done: false', 'by: "", done: false')
js = rep(js, "No reminders yet — add one above. Both of you see the same list.", "No reminders yet — add one above.")
js = rep(js, 'title: "Shared reminders"', 'title: "Reminders"')
js = rep(js, '"Shared reminders (" + open.length', '"Reminders (" + open.length', count=2)
rail = "  /* ============================================================\n     RIGHT-RAIL ACCORDION"
s = rep(s, rail, js + rail)
s = rep(s, '''  document.addEventListener("visibilitychange", function(){ if(!document.hidden) groceryRefresh(false); });
  setInterval(function(){ if(!document.hidden) groceryRefresh(false); }, 60000);''',
        '''  function refreshShared(){ if(!document.hidden){ groceryRefresh(false); reminderRefresh(false); } }
  document.addEventListener("visibilitychange", refreshShared);
  window.addEventListener("focus", refreshShared);
  setInterval(refreshShared, 8000);   // Groceries are shared live with Peter and Julia; Reminders refresh across Maria's own devices''')
s = rep(s, "    groceryRefresh(true);\n", "    groceryRefresh(true);\n    renderReminders();\n    reminderRefresh(true);\n")

# identity / defaults
s = rep(s, "<title>Peter's Console</title>", "<title>Maria's Console</title>")
s = rep(s, "Preconfigured for Peter.", "Preconfigured for Maria.")
s = rep(s, "PETER'S CONSOLE", "MARIA'S CONSOLE", count=4)
s = rep(s, 'var G_FROM = "Peter";', 'var G_FROM = "Maria";')
s = rep(s, '      <a class="lang-switch" href="/fr/" title="Passer en français">FR</a>\n', '')
s = rep(s, "right:60px; transform:translateY(-50%)", "right:16px; transform:translateY(-50%)")
s = rep(s, ".theme-switch{ width:28px; height:26px; font-size:14px; right:46px; }", ".theme-switch{ width:28px; height:26px; font-size:14px; right:10px; }")
s = rep(s, ".theme-switch{ width:22px; height:20px; font-size:12px; right:36px; }", ".theme-switch{ width:22px; height:20px; font-size:12px; right:8px; }")
s = rep(s, '''  var DEFAULT_PODCASTS = [
    { label: "MeidasTouch", channelId: "UC9r9HYFxEQOBXSopFS61ZWg" },
    { label: "Tod Maffin", channelId: "UCy9djDjPbgW7chRBXK2TV1g" }
  ];''', '  var DEFAULT_PODCASTS = [];')
s = rep(s, '''  var DEFAULT_SPORTS_TEAMS = [
    { sport: "football", league: "college-football", teamId: "130", label: "Michigan Wolverines" },
    { sport: "basketball", league: "mens-college-basketball", teamId: "130", label: "Michigan Wolverines" },
    { sport: "basketball", league: "mens-college-basketball", teamId: "41", label: "UConn Huskies" },
    { sport: "basketball", league: "womens-college-basketball", teamId: "41", label: "UConn Huskies" }
  ];''', '  var DEFAULT_SPORTS_TEAMS = [];')
s = s.replace("Peter's in Wakefield, RI", "Maria is in Wakefield, RI").replace("Preset for Peter", "Preset for Maria").replace("for Peter", "for Maria")
os.makedirs(ROOT + "/public/for-maria", exist_ok=True)
open(ROOT + "/public/for-maria/index.html", "w", encoding="utf-8").write(s)

# Peter's and Julia's Groceries badges now also name Maria (their Reminders stay Peter+Julia only)
for slug, partner in (("peter", "Julia"), ("julia", "Peter")):
    p = ROOT + "/public/for-%s/index.html" % slug
    t = open(p, encoding="utf-8").read()
    old = '<span>Groceries</span><em class="shared-tag" title="Shared live with %s">' % partner
    if old in t:
        t = t.replace(old, '<span>Groceries</span><em class="shared-tag" title="Shared live with %s and Maria">' % partner)
        open(p, "w", encoding="utf-8").write(t)
        print(slug, "badge updated")
print("maria ok", len(s))
