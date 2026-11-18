# Peter + Julia: personal pages (own Tasks/Notes/Links/settings) with live-shared Groceries + Reminders.
# Reuses the Aviva/Andrea generator's pieces. Peter's page is edited in place; Julia's is generated from Peter's.
import os, re
ROOT = os.path.expanduser("~/mnt/docdrew-console")
src = open(ROOT + "/Claude outputs/build_aa.py", encoding="utf-8").read()
ns = {}
exec(src[:src.index("\nAVIVA_NEWS")], ns)   # rep, REMINDERS_*, SHARED_CSS (does not run the Aviva/Andrea build)
rep = ns["rep"]

def share_up(s, name, partner, slug):
    s = rep(s, '    groceries: "dds-peter-groceries",',
            '    groceries: "dds-pj-shared-groceries",\n    reminders: "dds-pj-shared-reminders",')
    if slug != "peter":
        s = s.replace("dds-peter-", "dds-%s-" % slug)
    s = rep(s, '  var SYNC_OWNER = "peter";',
            '  var SYNC_OWNER = "%s";\n'
            '  var SHARED_OWNER = "pj-shared";   // Groceries + Reminders: one list shared by Peter and Julia\n'
            '  function syncOwnerFor(collection){ return (collection === "groceries" || collection === "reminders") ? SHARED_OWNER : SYNC_OWNER; }' % slug)
    s = rep(s, '"&owner=" + SYNC_OWNER', '"&owner=" + syncOwnerFor(collection)', count=2)
    # Groceries panel: shared marker; Reminders panel goes just above it in the right rail
    gro = '        <section class="panel" data-accent="crimson" data-panel-key="groceries" aria-label="Grocery list">\n          <div class="panel-head"><span>Groceries</span><i class="panel-chevron">▾</i></div>'
    new_gro = ('        <section class="panel" data-accent="crimson" data-panel-key="groceries" data-shared="1" aria-label="Grocery list">\n'
               '          <div class="panel-head"><span>Groceries</span><em class="shared-tag" title="Shared live with __P__">⇄ Shared</em><i class="panel-chevron">▾</i></div>')
    s = rep(s, gro, ns["REMINDERS_HTML"].replace("          <section", "        <section", 1) + new_gro)
    s = s.replace("__PARTNER__", partner).replace("__P__", partner)
    s = rep(s, "</style>", ns["REMINDERS_CSS"] + ns["SHARED_CSS"] + "</style>")
    rail = "  /* ============================================================\n     RIGHT-RAIL ACCORDION"
    s = rep(s, rail, ns["REMINDERS_JS"] + rail)
    s = rep(s, '''  document.addEventListener("visibilitychange", function(){ if(!document.hidden) groceryRefresh(false); });
  setInterval(function(){ if(!document.hidden) groceryRefresh(false); }, 60000);''',
            '''  function refreshShared(){ if(!document.hidden){ groceryRefresh(false); reminderRefresh(false); } }
  document.addEventListener("visibilitychange", refreshShared);
  window.addEventListener("focus", refreshShared);
  setInterval(refreshShared, 8000);   // Groceries + Reminders are shared live between %s and %s''' % (name, partner))
    s = rep(s, "    groceryRefresh(true);\n", "    groceryRefresh(true);\n    renderReminders();\n    reminderRefresh(true);\n")
    return s

peter_src = open(ROOT + "/public/for-peter/index.html", encoding="utf-8").read()
assert "pj-shared" not in peter_src, "for-peter already converted"

# Peter: in place
open(ROOT + "/public/for-peter/index.html", "w", encoding="utf-8").write(share_up(peter_src, "Peter", "Julia", "peter"))

# Julia: from Peter's original
j = share_up(peter_src, "Julia", "Peter", "julia")
j = rep(j, "<title>Peter's Console</title>", "<title>Julia's Console</title>")
j = rep(j, "Preconfigured for Peter.", "Preconfigured for Julia.")
j = rep(j, "PETER'S CONSOLE", "JULIA'S CONSOLE", count=4)
j = rep(j, 'var G_FROM = "Peter";', 'var G_FROM = "Julia";')
j = rep(j, '      <a class="lang-switch" href="/fr/" title="Passer en français">FR</a>\n', '')
j = rep(j, "right:60px; transform:translateY(-50%)", "right:16px; transform:translateY(-50%)")
j = rep(j, ".theme-switch{ width:28px; height:26px; font-size:14px; right:46px; }", ".theme-switch{ width:28px; height:26px; font-size:14px; right:10px; }")
j = rep(j, ".theme-switch{ width:22px; height:20px; font-size:12px; right:36px; }", ".theme-switch{ width:22px; height:20px; font-size:12px; right:8px; }")
j = rep(j, '''  var DEFAULT_PODCASTS = [
    { label: "MeidasTouch", channelId: "UC9r9HYFxEQOBXSopFS61ZWg" },
    { label: "Tod Maffin", channelId: "UCy9djDjPbgW7chRBXK2TV1g" }
  ];''', '  var DEFAULT_PODCASTS = [];')
j = rep(j, '''  var DEFAULT_SPORTS_TEAMS = [
    { sport: "football", league: "college-football", teamId: "130", label: "Michigan Wolverines" },
    { sport: "basketball", league: "mens-college-basketball", teamId: "130", label: "Michigan Wolverines" },
    { sport: "basketball", league: "mens-college-basketball", teamId: "41", label: "UConn Huskies" },
    { sport: "basketball", league: "womens-college-basketball", teamId: "41", label: "UConn Huskies" }
  ];''', '  var DEFAULT_SPORTS_TEAMS = [];')
j = j.replace("Peter's in Wakefield, RI", "Julia is in Wakefield, RI").replace("Preset for Peter", "Preset for Julia").replace("for Peter", "for Julia")
os.makedirs(ROOT + "/public/for-julia", exist_ok=True)
open(ROOT + "/public/for-julia/index.html", "w", encoding="utf-8").write(j)
print("ok", len(j), sorted(set(re.findall(r"(?i)peter", j))))
