import os, re, sys

ROOT = os.path.expanduser("~/mnt/docdrew-console")
SRC = open(ROOT + "/public/for-peter/index.html", encoding="utf-8").read()


def rep(s, old, new, count=1):
    n = s.count(old)
    assert n == count, ("expected %d got %d for: %r" % (count, n, old[:80]))
    return s.replace(old, new)


REMINDERS_CSS = """
  /* Shared Reminders (Aviva + Andrea) */
  .rem-add{ display:flex; flex-wrap:wrap; gap:6px; width:100%; }
  .rem-add input[type="text"]{ flex:1 1 150px; min-width:0; background:var(--panel-2); border:1px solid var(--grid-line); color:var(--text); border-radius:6px; padding:8px 10px; font-size:16px; }
  .rem-add input[type="date"]{ flex:0 1 140px; min-width:0; background:var(--panel-2); border:1px solid var(--grid-line); color:var(--text); border-radius:6px; padding:7px 8px; font-size:14px; color-scheme:dark light; }
  .rem-add button{ flex:0 0 auto; background:var(--teal); color:var(--teal-ink); border:0; border-radius:6px; padding:0 14px; min-height:36px; font-weight:700; font-size:15.5px; cursor:pointer; }
  .rem-meta{ display:block; font-size:12.5px; color:var(--text-dim); margin-top:1px; }
  .rem-meta.overdue{ color:var(--bad); font-weight:700; }
  .rem-row input[type="checkbox"]{ accent-color:var(--teal); }
  .rem-sharebox{ border-color:var(--teal); }
"""

SHARED_CSS = """
  /* Shared panels (Groceries + Reminders) get an amber outline and a badge so they stand apart from the personal ones */
  .panel[data-shared]{ outline:2px solid #ff9f1c; outline-offset:-2px; box-shadow:0 0 0 1px rgba(255,159,28,.35), 0 0 12px rgba(255,159,28,.18); }
  .shared-tag{ margin-left:auto; margin-right:8px; flex:0 0 auto; font-style:normal; font-size:11px; font-weight:700; letter-spacing:0.02em; text-transform:none; white-space:nowrap;
    background:#ff9f1c; color:#2a1700; padding:2px 8px; border-radius:10px; }
"""

REMINDERS_HTML = """          <section class="panel" data-accent="teal" data-panel-key="reminders" data-shared="1" aria-label="Shared Reminders">
            <div class="panel-head"><span>Shared Reminders</span><em class="shared-tag" title="Shared live with __PARTNER__">⇄ Shared</em><i class="panel-chevron">▾</i></div>
            <div class="panel-body scroll" id="reminders-body"></div>
          </section>
"""

REMINDERS_JS = r"""  /* ============================================================
     SHARED REMINDERS — one list shared in real time by Aviva and Andrea
     (sync owner "aa-shared", collection "reminders"). Same server-is-truth
     model as Groceries: pull on load, on focus, and every few seconds while
     the tab is open; push on every change. Items: {id,text,due?,by,done,doneTs}.
     Share/Text reuses the grocery share link (/l/<id>) so the recipient gets
     the same tick-off checkbox page.
  ============================================================ */
  var remindersBody = $("reminders-body");
  var reminders = readLS(LS.reminders, []);
  var R_SYNC_URL = "/api/sync?collection=reminders&owner=" + SHARED_OWNER;
  var R_KEEP_DONE_MS = 7 * 24 * 3600 * 1000;
  var remShowDone = false, remLastWrite = 0, remFocus = false;
  var remShareUrl = "", remShareMsg = "", remShareCount = 0, remShareBusy = false, remNote = "", remNoteTimer = null;

  function rToday(){ return new Intl.DateTimeFormat("en-CA", { timeZone: HOME_TZ }).format(new Date()); }
  function rFmt(due){
    var d = new Date(due + "T12:00:00");
    return isNaN(d) ? due : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  function rSave(){
    remLastWrite = Date.now();
    remShareUrl = "";
    writeLS(LS.reminders, reminders);
    syncPush("reminders", reminders);
  }
  function rPrune(){
    var now = Date.now();
    reminders = reminders.filter(function(r){ return !(r.done && r.doneTs && now - r.doneTs > R_KEEP_DONE_MS); });
  }
  function rNote(msg){
    remNote = msg;
    clearTimeout(remNoteTimer);
    remNoteTimer = setTimeout(function(){ remNote = ""; renderReminders(); }, 4000);
    renderReminders();
  }
  function rAdd(text, due){
    text = String(text || "").trim();
    if(!text) return;
    var item = { id: "r" + Date.now() + Math.random().toString(36).slice(2, 6), text: text.slice(0, 160), by: G_FROM, done: false };
    if(due && /^\d{4}-\d{2}-\d{2}$/.test(due)) item.due = due;
    reminders.push(item);
    rSave();
    remFocus = true;
    renderReminders();
  }
  function rSorted(list){
    return list.slice().sort(function(a, b){
      if(a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
      if(a.due) return -1;
      if(b.due) return 1;
      return a.id < b.id ? -1 : 1;
    });
  }
  function rBucket(r){
    var t = rToday();
    if(!r.due) return "Anytime";
    if(r.due < t) return "Overdue";
    if(r.due === t) return "Today";
    return "Upcoming";
  }
  var R_ORDER = ["Overdue", "Today", "Upcoming", "Anytime"];
  function rLine(r){
    return r.text + (r.due ? " — " + rFmt(r.due) : "") + (r.by ? " (" + r.by + ")" : "");
  }
  function rRow(r){
    var row = el("label", "grocery-row rem-row" + (r.done ? " done" : ""));
    var meta = [];
    if(r.due) meta.push('<span class="rem-meta' + (!r.done && r.due < rToday() ? " overdue" : "") + '">' + escapeHtml(rFmt(r.due)) + (r.by ? " · " + escapeHtml(r.by) : "") + "</span>");
    else if(r.by) meta.push('<span class="rem-meta">' + escapeHtml(r.by) + "</span>");
    row.innerHTML = '<input type="checkbox"' + (r.done ? " checked" : "") + '><span class="grocery-text">' + escapeHtml(r.text) + meta.join("") +
      '</span><button type="button" class="grocery-del" aria-label="Remove" title="Remove">✕</button>';
    row.querySelector("input").addEventListener("change", function(){
      var now = this.checked;
      function apply(){
        r.done = now;
        if(now) r.doneTs = Date.now(); else delete r.doneTs;
        rSave(); renderReminders();
      }
      if(now && !remShowDone){ row.classList.add("leaving"); setTimeout(apply, 280); }
      else apply();
    });
    row.querySelector(".grocery-del").addEventListener("click", function(e){
      e.preventDefault(); e.stopPropagation();
      reminders = reminders.filter(function(x){ return x.id !== r.id; });
      rSave(); renderReminders();
    });
    return row;
  }
  function rListText(){
    var open = rSorted(reminders.filter(function(r){ return !r.done; }));
    var by = {};
    open.forEach(function(r){ (by[rBucket(r)] = by[rBucket(r)] || []).push(r); });
    var blocks = R_ORDER.filter(function(k){ return by[k]; }).map(function(k){
      return k + "\n" + by[k].map(function(r){ return "- " + rLine(r); }).join("\n");
    });
    return "Shared reminders (" + open.length + (open.length === 1 ? " item" : " items") + "):\n\n" + blocks.join("\n\n");
  }
  function rShare(){
    if(remShareBusy) return;
    var open = rSorted(reminders.filter(function(r){ return !r.done; }));
    if(!open.length){ rNote("Nothing to share yet."); return; }
    var by = {};
    open.forEach(function(r){ (by[rBucket(r)] = by[rBucket(r)] || []).push(rLine(r)); });
    var groups = R_ORDER.filter(function(k){ return by[k]; }).map(function(k){ return { label: k, items: by[k] }; });
    remShareBusy = true; remNote = ""; renderReminders();
    fetch("/api/grocery-share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lang: "en", title: "Shared reminders", from: G_FROM, groups: groups })
    }).then(function(res){ return res.json().then(function(d){ return { ok: res.ok, d: d }; }); }).then(function(res){
      remShareBusy = false;
      if(!res.ok || !res.d || !res.d.id) throw new Error("no id");
      remShareUrl = location.origin + "/l/" + res.d.id;
      remShareCount = open.length;
      remShareMsg = "Shared reminders (" + open.length + (open.length === 1 ? " item" : " items") + "):";
      renderReminders();
    }).catch(function(){ remShareBusy = false; rNote("Couldn't make a link. Try again."); });
  }

  function renderReminders(){
    var oldText = $("rem-input"), oldDate = $("rem-date");
    var keepText = oldText ? oldText.value : "", keepDate = oldDate ? oldDate.value : "";
    var hadFocus = remFocus || (oldText && document.activeElement === oldText);
    remFocus = false;
    remindersBody.innerHTML = "";

    var open = rSorted(reminders.filter(function(r){ return !r.done; }));
    var done = reminders.filter(function(r){ return r.done; });

    var addRow = el("div", "rem-add");
    addRow.innerHTML = '<input type="text" id="rem-input" autocomplete="off" enterkeyhint="done" placeholder="Add a reminder…"><input type="date" id="rem-date" aria-label="Due date (optional)" title="Due date (optional)"><button type="button">Add</button>';
    remindersBody.appendChild(addRow);
    var input = addRow.querySelector("#rem-input"), date = addRow.querySelector("#rem-date");
    input.value = keepText; date.value = keepDate;
    function submit(){ var v = input.value, d = date.value; input.value = ""; date.value = ""; rAdd(v, d); }
    addRow.querySelector("button").addEventListener("click", submit);
    input.addEventListener("keydown", function(e){ if(e.key === "Enter"){ e.preventDefault(); submit(); } });

    if(open.length === 0){
      var empty = el("div", "grocery-empty");
      empty.textContent = reminders.length ? "All done — nothing left." : "No reminders yet — add one above. Both of you see the same list.";
      remindersBody.appendChild(empty);
    } else {
      var sum = el("div", "grocery-summary");
      sum.textContent = open.length + " open";
      remindersBody.appendChild(sum);
      var by = {};
      open.forEach(function(r){ (by[rBucket(r)] = by[rBucket(r)] || []).push(r); });
      R_ORDER.forEach(function(k){
        if(!by[k]) return;
        var head = el("div", "grocery-category");
        head.textContent = k;
        remindersBody.appendChild(head);
        by[k].forEach(function(r){ remindersBody.appendChild(rRow(r)); });
      });
    }
    if(remShowDone && done.length){
      var dh = el("div", "grocery-category");
      dh.textContent = "Checked off";
      remindersBody.appendChild(dh);
      done.forEach(function(r){ remindersBody.appendChild(rRow(r)); });
    }

    var actions = el("div", "grocery-actions");
    if(open.length){
      var sb = el("button", "grocery-btn primary");
      sb.type = "button"; sb.textContent = remShareBusy ? "Making link…" : "Share"; sb.disabled = remShareBusy;
      sb.addEventListener("click", rShare);
      actions.appendChild(sb);
    }
    if(done.length){
      var tb = el("button", "grocery-btn");
      tb.type = "button"; tb.textContent = remShowDone ? "Hide checked-off" : "Show checked-off (" + done.length + ")";
      tb.addEventListener("click", function(){ remShowDone = !remShowDone; renderReminders(); });
      actions.appendChild(tb);
    }
    if(remShowDone && done.length){
      var cb = el("button", "grocery-btn");
      cb.type = "button"; cb.textContent = "Clear checked-off";
      cb.addEventListener("click", function(){ reminders = reminders.filter(function(r){ return !r.done; }); rSave(); renderReminders(); });
      actions.appendChild(cb);
    }
    if(actions.childNodes.length) remindersBody.appendChild(actions);

    if(remShareUrl){
      var box = el("div", "grocery-sharebox rem-sharebox");
      var smsBody = remShareMsg + "\n" + remShareUrl;
      box.innerHTML = '<div class="grocery-sharehead"><span>Link ready · ' + remShareCount + (remShareCount === 1 ? " item" : " items") + '</span><button type="button" aria-label="Close" title="Close">✕</button></div>' +
        '<input type="text" readonly id="rem-share-url" value="' + escapeHtml(remShareUrl) + '">' +
        '<div class="grocery-actions" style="margin-top:8px"><a class="grocery-btn primary" href="sms:?&amp;body=' + encodeURIComponent(smsBody) + '">Text it</a></div>';
      var bActions = box.querySelector(".grocery-actions");
      if(navigator.share){
        var nb = el("button", "grocery-btn");
        nb.type = "button"; nb.textContent = "Share…";
        nb.addEventListener("click", function(){ navigator.share({ text: remShareMsg, url: remShareUrl }).catch(function(){}); });
        bActions.appendChild(nb);
      }
      var cpb = el("button", "grocery-btn");
      cpb.type = "button"; cpb.textContent = "Copy link";
      cpb.addEventListener("click", function(){ gCopy(remShareMsg + " " + remShareUrl, cpb, "Copy link", "Copied!"); });
      bActions.appendChild(cpb);
      var clb = el("button", "grocery-btn");
      clb.type = "button"; clb.textContent = "Copy list";
      clb.addEventListener("click", function(){ gCopy(rListText(), clb, "Copy list", "List copied!"); });
      bActions.appendChild(clb);
      box.querySelector(".grocery-sharehead button").addEventListener("click", function(){ remShareUrl = ""; renderReminders(); });
      box.querySelector("input").addEventListener("focus", function(){ this.select(); });
      remindersBody.appendChild(box);
    }
    if(remNote){
      var note = el("div", "grocery-note");
      note.textContent = remNote;
      remindersBody.appendChild(note);
    }
    if(hadFocus){ input.focus(); try{ input.setSelectionRange(input.value.length, input.value.length); }catch(e){} }
  }

  function reminderRefresh(initial){
    fetch(R_SYNC_URL, { cache: "no-store" }).then(function(r){
      if(!r.ok) return null;
      var exists = r.headers.get("x-sync-exists") === "1";
      return r.json().then(function(items){ return { exists: exists, items: items }; });
    }).then(function(remote){
      if(!remote || !Array.isArray(remote.items)) return;
      if(Date.now() - remLastWrite < 4000) return;   // don't clobber a change that was just made here
      if(remote.items.length > 0 || remote.exists){
        if(JSON.stringify(remote.items) !== JSON.stringify(reminders)){
          // don't re-render under the user's hands while they are typing a reminder
          var ti = $("rem-input");
          if(!initial && ti && document.activeElement === ti && ti.value) { reminders = remote.items; rPrune(); writeLS(LS.reminders, reminders); return; }
          reminders = remote.items; rPrune();
          writeLS(LS.reminders, reminders);
          renderReminders();
        }
      } else if(initial && reminders.length > 0){
        syncPush("reminders", reminders);
      }
    }).catch(function(){});
  }
  rPrune();

"""


LOC_CSS = """
  /* Weather: change location (search any city or ZIP) */
  .wx-loc-box{ padding:8px 10px 10px; border-bottom:1px solid var(--grid-line); }
  .wx-loc-box form{ display:flex; gap:6px; }
  .wx-loc-box input{ flex:1; min-width:0; background:var(--panel-2); border:1px solid var(--grid-line); color:var(--text); border-radius:6px; padding:7px 9px; font-size:15px; }
  .wx-loc-box button[type="submit"]{ flex:0 0 auto; background:var(--cyan); color:var(--cyan-ink); border:0; border-radius:6px; padding:0 12px; font-weight:700; font-size:14.5px; cursor:pointer; }
  .wx-loc-results button{ display:block; width:100%; text-align:left; margin-top:5px; background:transparent; color:var(--text); border:1px solid var(--grid-line); border-radius:6px; padding:7px 9px; font-size:14.5px; cursor:pointer; }
  .wx-loc-results button:hover{ border-color:var(--cyan); }
  .wx-loc-results .wx-loc-msg{ margin-top:6px; font-size:13.5px; color:var(--text-dim); }
"""

LOC_JS = r"""  /* ============================================================
     WEATHER LOCATION PICKER — with no globe to click, the Weather panel gets a 📍 button that
     searches any city or ZIP (Open-Meteo geocoding, no key) and makes it the home location:
     weather, header clock/timezone, and snow-report region all follow.
  ============================================================ */
  var US_STATES = { AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",DC:"District of Columbia" };
  var wxLocBox = $("wx-loc-box"), wxLocInput = $("wx-loc-input"), wxLocResults = $("wx-loc-results");
  function wxLocMsg(t){ wxLocResults.innerHTML = '<div class="wx-loc-msg">' + escapeHtml(t) + "</div>"; }
  function wxLocLabel(r){
    var st = "";
    if(r.country_code === "US" && r.admin1){
      st = r.admin1;
      Object.keys(US_STATES).forEach(function(k){ if(US_STATES[k] === r.admin1) st = k; });
    } else if(r.admin1){ st = r.admin1; }
    return r.name + (st ? ", " + st : "") + (r.country_code && r.country_code !== "US" ? ", " + (r.country || r.country_code) : "");
  }
  function wxLocSearch(q){
    q = q.trim();
    if(q.length < 2){ wxLocMsg("Type a city or ZIP code."); return; }
    var name = q, hint = "";
    if(q.indexOf(",") > -1){ name = q.split(",")[0].trim(); hint = q.split(",").slice(1).join(",").trim().toLowerCase(); }
    else if(/^[A-Za-z .'-]+\s+[A-Za-z]{2}$/.test(q) && US_STATES[q.slice(-2).toUpperCase()]){ name = q.slice(0, -2).trim(); hint = q.slice(-2).toLowerCase(); }
    wxLocMsg("Searching…");
    fetch("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(name) + "&count=10&language=en&format=json")
      .then(function(r){ return r.json(); })
      .then(function(d){
        var res = (d && d.results) || [];
        if(hint){
          var f = res.filter(function(r){
            var a1 = (r.admin1 || "").toLowerCase(), cc = (r.country_code || "").toLowerCase(), c = (r.country || "").toLowerCase();
            var full = (US_STATES[hint.toUpperCase()] || "").toLowerCase();
            return a1 === hint || a1.indexOf(hint) === 0 || (full && a1 === full) || cc === hint || c.indexOf(hint) === 0;
          });
          if(f.length) res = f;
        }
        res = res.slice(0, 6);
        if(!res.length){ wxLocMsg("No match. Try a city name or ZIP code."); return; }
        wxLocResults.innerHTML = "";
        res.forEach(function(r){
          var b = el("button", "");
          b.type = "button";
          b.textContent = wxLocLabel(r) + (r.admin2 ? " (" + r.admin2 + ")" : "");
          b.addEventListener("click", function(){ wxSetLocation({ name: wxLocLabel(r), region: "Custom", lat: r.latitude, lon: r.longitude, tz: r.timezone || HOME_TZ }); });
          wxLocResults.appendChild(b);
        });
      })
      .catch(function(){ wxLocMsg("Search is unavailable right now."); });
  }
  function wxSetLocation(c){
    homeCity = c;
    HOME = { name: c.name, lat: c.lat, lon: c.lon };
    HOME_TZ = c.tz;
    writeLS(LS.homeCity, homeCity);
    updateClock();
    syncHomeLabels();
    var sel = $("home-city-select");
    if(sel){
      var has = Array.prototype.some.call(sel.options, function(o){ return o.value === c.name; });
      if(!has){ var o = document.createElement("option"); o.value = c.name; o.textContent = c.name; sel.insertBefore(o, sel.firstChild); }
      sel.value = c.name;
    }
    wxPlace = { name: c.name, lat: c.lat, lon: c.lon };
    writeLS(LS.wxCity, wxPlace);
    snowRegion = { name: c.name, lat: c.lat, lon: c.lon };
    writeLS(LS.snowRegion, snowRegion);
    lastBromontData = null;
    wxViewMode = "home";
    wxLocBox.hidden = true;
    wxLocInput.value = ""; wxLocResults.innerHTML = "";
    loadHomeWeather();
    if(snowExpanded) loadBromont();
  }
  $("wx-loc-btn").addEventListener("click", function(e){
    e.stopPropagation();
    wxLocBox.hidden = !wxLocBox.hidden;
    if(!wxLocBox.hidden){ wxLocInput.focus(); wxLocMsg("Search a city or ZIP, e.g. “Hudson, OH”, “44236” or “Paris”."); }
  });
  $("wx-loc-form").addEventListener("submit", function(e){ e.preventDefault(); wxLocSearch(wxLocInput.value); });

"""


def build(name, slug, extra_news, news_sources_extra):
    s = SRC

    # ---- identity ----
    s = rep(s, "<title>Peter's Console</title>", "<title>%s's Console</title>" % name)
    s = rep(s, "Preconfigured for Peter.", "Preconfigured for %s." % name)
    s = rep(s, "PETER'S CONSOLE", "%s'S CONSOLE" % name.upper(), count=4)

    # ---- storage keys: personal = dds-<slug>-*, shared Groceries + Reminders = dds-aa-shared-* ----
    s = rep(s, '    groceries: "dds-peter-groceries",',
            '    groceries: "dds-aa-shared-groceries",\n    reminders: "dds-aa-shared-reminders",')
    s = s.replace("dds-peter-", "dds-%s-" % slug)

    # ---- sync owners ----
    s = rep(s, '  var SYNC_OWNER = "peter";',
            '  var SYNC_OWNER = "%s";\n'
            '  var SHARED_OWNER = "aa-shared";   // Groceries + Reminders: one list shared by Aviva and Andrea\n'
            '  function syncOwnerFor(collection){ return (collection === "groceries" || collection === "reminders") ? SHARED_OWNER : SYNC_OWNER; }' % slug)
    s = rep(s, '"&owner=" + SYNC_OWNER', '"&owner=" + syncOwnerFor(collection)', count=2)
    s = rep(s, 'var G_FROM = "Peter";', 'var G_FROM = "%s";' % name)

    # ---- no French ----
    s = rep(s, '      <a class="lang-switch" href="/fr/" title="Passer en français">FR</a>\n', '')
    s = rep(s, "right:60px; transform:translateY(-50%)", "right:16px; transform:translateY(-50%)")
    s = rep(s, ".theme-switch{ width:28px; height:26px; font-size:14px; right:46px; }", ".theme-switch{ width:28px; height:26px; font-size:14px; right:10px; }")
    s = rep(s, ".theme-switch{ width:22px; height:20px; font-size:12px; right:36px; }", ".theme-switch{ width:22px; height:20px; font-size:12px; right:8px; }")

    # ---- news tabs ----
    s = rep(s, '    { key: "canada", label: "Canadian News" },\n', '')
    s = rep(s, '    { key: "quebec", label: "Quebec News" },\n', '')
    s = rep(s, '    { key: "health-medicine", label: "Health & Medicine" },\n',
            '    { key: "health-medicine", label: "Health & Medicine" },\n' + news_sources_extra)

    # ---- remove the Weather Systems globe box ----
    a = s.index('        <section class="globe-panel"')
    b = s.index('        <aside class="rail rail-right rail-mid"')
    s = s[:a] + s[b:]
    s = rep(s, '  var canvas2 = $("weather-globe-canvas");\n  var ctx2 = canvas2.getContext("2d");\n  var weatherGlobeBody = $("weather-globe-body");\n  var tooltip2 = $("weather-globe-tooltip");',
            '  // This page has no globe box. The drawing code below is kept intact but runs against detached\n'
            '  // stand-in elements and is never started (see HAS_GLOBE in init()).\n'
            '  var HAS_GLOBE = !!$("weather-globe-canvas");\n'
            '  var canvas2 = $("weather-globe-canvas") || document.createElement("canvas");\n'
            '  var ctx2 = canvas2.getContext("2d");\n'
            '  var weatherGlobeBody = $("weather-globe-body") || document.createElement("div");\n'
            '  var tooltip2 = $("weather-globe-tooltip") || document.createElement("div");')
    s = rep(s, '''    resizeCanvas2();
    if(window.ResizeObserver){ new ResizeObserver(debounce(resizeCanvas2, 120)).observe(weatherGlobeBody); }
    window.addEventListener("resize", debounce(resizeCanvas2, 120));
    requestAnimationFrame(function(){ resizeCanvas2(); });
    tick2();
''', '''    if(HAS_GLOBE){
      resizeCanvas2();
      if(window.ResizeObserver){ new ResizeObserver(debounce(resizeCanvas2, 120)).observe(weatherGlobeBody); }
      window.addEventListener("resize", debounce(resizeCanvas2, 120));
      requestAnimationFrame(function(){ resizeCanvas2(); });
      tick2();
    }
''')
    for fn in ["loadStations", "loadWeatherGrid", "loadEarthMosaic", "loadRadarMosaic", "loadCloudMosaic", "loadIss"]:
        s = rep(s, "    %s();\n" % fn, "    if(HAS_GLOBE) %s();\n" % fn)
    s = rep(s, "    setInterval(loadStations, 900000);\n", "    if(HAS_GLOBE) setInterval(loadStations, 900000);\n")
    s = rep(s, "    setInterval(loadWeatherGrid, 600000);\n", "    if(HAS_GLOBE) setInterval(loadWeatherGrid, 600000);\n")
    s = rep(s, "    setInterval(loadEarthMosaic, 10800000);\n", "    if(HAS_GLOBE) setInterval(loadEarthMosaic, 10800000);\n")
    s = rep(s, "    setInterval(loadRadarMosaic, 600000);\n", "    if(HAS_GLOBE) setInterval(loadRadarMosaic, 600000);\n")
    s = rep(s, "    setInterval(loadCloudMosaic, 900000);\n", "    if(HAS_GLOBE) setInterval(loadCloudMosaic, 900000);\n")
    s = rep(s, "    setInterval(loadIss, 15000);\n", "    if(HAS_GLOBE) setInterval(loadIss, 15000);\n")

    # ---- Hudson, OH home + defaults ----
    s = rep(s, '    { name: "Providence", region: "North America", lat: 41.8240, lon: -71.4128, tz: "America/New_York" },\n',
            '    { name: "Providence", region: "North America", lat: 41.8240, lon: -71.4128, tz: "America/New_York" },\n'
            '    { name: "Hudson, OH", region: "North America", lat: 41.2401, lon: -81.4410, tz: "America/New_York" },\n')
    s = rep(s, 'var DEFAULT_HOME_CITY = { name: "Wakefield, RI", region: "North America", lat: 41.4334, lon: -71.4970, tz: "America/New_York" };',
            'var DEFAULT_HOME_CITY = { name: "Hudson, OH", region: "North America", lat: 41.2401, lon: -81.4410, tz: "America/New_York" };')
    s = rep(s, "// Preset for Peter — Wakefield, RI (part of South Kingstown, near Providence).", "// Preset for %s — Hudson, OH 44236." % name)
    s = rep(s, 'var DEFAULT_SNOW_REGION = { name: "Southern Vermont", lat: 43.1127, lon: -72.9081 };',
            'var DEFAULT_SNOW_REGION = { name: "Hudson, OH", lat: 41.2401, lon: -81.4410 };')
    s = rep(s, '''  var DEFAULT_LINKS = [
    { name: "Foodie Collection", url: "https://docdrewfood.netlify.app/" }
  ];''', '''  var DEFAULT_LINKS = [
    { name: "Foodie Collection", url: "https://docdrewfood.netlify.app/" },
    { name: "Travel Planner", url: "https://docdrew-console.netlify.app/tools/travel-planner/" },
    { name: "Climate", url: "https://www.climate.us" }
  ];''')
    s = rep(s, '''  var DEFAULT_PODCASTS = [
    { label: "MeidasTouch", channelId: "UC9r9HYFxEQOBXSopFS61ZWg" },
    { label: "Tod Maffin", channelId: "UCy9djDjPbgW7chRBXK2TV1g" }
  ];''', '  var DEFAULT_PODCASTS = [];')
    s = rep(s, '''  var DEFAULT_SPORTS_TEAMS = [
    { sport: "football", league: "college-football", teamId: "130", label: "Michigan Wolverines" },
    { sport: "basketball", league: "mens-college-basketball", teamId: "130", label: "Michigan Wolverines" },
    { sport: "basketball", league: "mens-college-basketball", teamId: "41", label: "UConn Huskies" },
    { sport: "basketball", league: "womens-college-basketball", teamId: "41", label: "UConn Huskies" }
  ];''', '''  var DEFAULT_SPORTS_TEAMS = [
    { sport: "baseball", league: "mlb", teamId: "5", label: "Cleveland Guardians" },
    { sport: "basketball", league: "nba", teamId: "5", label: "Cleveland Cavaliers" }
  ];''')

    # ---- Weather: visible "change location" control ----
    s = rep(s, '<div class="panel-head"><span>Weather</span><button class="head-btn" id="wx-unit-btn"',
            '<div class="panel-head"><span>Weather</span><button class="head-btn" id="wx-loc-btn" type="button" title="Change location (search any city or ZIP)">📍</button><button class="head-btn" id="wx-unit-btn"')
    s = rep(s, '            <div class="panel-body scroll" id="wx-body">',
            '            <div class="wx-loc-box" id="wx-loc-box" hidden>\n'
            '              <form id="wx-loc-form"><input type="text" id="wx-loc-input" placeholder="City or ZIP" autocomplete="off" aria-label="Search for a city or ZIP code"><button type="submit">Find</button></form>\n'
            '              <div class="wx-loc-results" id="wx-loc-results"></div>\n'
            '            </div>\n'
            '            <div class="panel-body scroll" id="wx-body">')
    s = rep(s, "</style>", LOC_CSS + "</style>")
    s = rep(s, "    sel.innerHTML = html;\n    sel.value = homeCity.name;",
            "    sel.innerHTML = html;\n"
            "    if(!WORLD_CITIES.some(function(c){ return c.name === homeCity.name; })){ sel.insertAdjacentHTML(\"afterbegin\", '<option value=\"' + escapeHtml(homeCity.name) + '\">' + escapeHtml(homeCity.name) + \"</option>\"); }\n"
            "    sel.value = homeCity.name;")

    # ---- Shared Reminders panel (middle column, under Weather — where the globe used to be) ----
    marker = '        </aside>\n      </div>\n\n      <aside class="rail rail-right" aria-label="Lists and media">'
    s = rep(s, marker, REMINDERS_HTML + marker)
    s = rep(s, "</style>", REMINDERS_CSS + SHARED_CSS + "</style>")
    s = rep(s, '<section class="panel" data-accent="crimson" data-panel-key="groceries" aria-label="Grocery list">\n          <div class="panel-head"><span>Groceries</span><i class="panel-chevron">▾</i></div>',
            '<section class="panel" data-accent="crimson" data-panel-key="groceries" data-shared="1" aria-label="Grocery list">\n          <div class="panel-head"><span>Groceries</span><em class="shared-tag" title="Shared live with __PARTNER__">⇄ Shared</em><i class="panel-chevron">▾</i></div>')
    s = s.replace("__PARTNER__", "Andrea" if name == "Aviva" else "Aviva")

    rail_marker = "  /* ============================================================\n     RIGHT-RAIL ACCORDION"
    s = rep(s, rail_marker, REMINDERS_JS + LOC_JS + rail_marker)

    # ---- real-time: poll both shared lists every 8s while visible, and on focus ----
    s = rep(s, '''  document.addEventListener("visibilitychange", function(){ if(!document.hidden) groceryRefresh(false); });
  setInterval(function(){ if(!document.hidden) groceryRefresh(false); }, 60000);''',
            '''  function refreshShared(){ if(!document.hidden){ groceryRefresh(false); reminderRefresh(false); } }
  document.addEventListener("visibilitychange", refreshShared);
  window.addEventListener("focus", refreshShared);
  setInterval(refreshShared, 8000);   // Groceries + Reminders are shared live between Aviva and Andrea''')
    s = rep(s, "    groceryRefresh(true);\n", "    groceryRefresh(true);\n    renderReminders();\n    reminderRefresh(true);\n")

    # Peter's page inherited the grocery share/paste code from the English+French pair but not the
    # definitions it needs (G_SHARE, G_OTHER_LABELS, groceryShareLang, gTextIn), so adding an item threw.
    # English-only stand-ins:
    s = rep(s, "  var groceryFocusInput = false;\n",
            "  var groceryFocusInput = false;\n"
            "  var G_SHARE = { en: { msg: G_STR.shareMsg } };   // English only: no second language to share in\n"
            "  var G_OTHER_LABELS = {};\n"
            "  var groceryShareLang = \"en\";\n"
            "  function gTextIn(g, L){ return g.text; }\n")

    # ---- leftover name mentions (comments only) ----
    s = s.replace("Peter's in Wakefield, RI", "%s is in Hudson, OH" % name)
    s = s.replace("Preset for Peter", "Preset for %s" % name)
    s = s.replace("for Peter", "for %s" % name)
    return s


AVIVA_NEWS = ('    { key: "social-work", label: "Social Work" },\n'
              '    { key: "animal-services", label: "Animal Services" },\n')
ANDREA_NEWS = '    { key: "pediatric-dentistry", label: "Pediatric Dentistry" },\n'

for name, slug, news in (("Aviva", "aviva", AVIVA_NEWS), ("Andrea", "andrea", ANDREA_NEWS)):
    out = build(name, slug, None, news)
    d = ROOT + "/public/for-" + slug
    os.makedirs(d, exist_ok=True)
    open(d + "/index.html", "w", encoding="utf-8").write(out)
    left = [m for m in re.findall(r"(?i)peter|wakefield|vermont|quebec|canad|montreal|/fr/", out)]
    print(name, len(out), "leftovers:", sorted(set(left)))
