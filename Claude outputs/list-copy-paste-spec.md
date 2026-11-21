# Copy list / Paste list — portable spec

Source of truth: the Grocery list in docdrew-console (`public/for-andrew/index.html`, functions `gListText`, `gParse`, `gCopy`, and the paste handler in `renderGroceries`). Follow these rules and the other project's lists will round-trip with the console's.

## 1. Data the feature assumes

- Items: `{ id, text, category, done }`. Only items with `done === false` are exported.
- Categories: an ordered list of keys (`ORDER`), plus an `other` key as the last, catch-all category.
- Two label maps keyed by category key: `LABELS` (the page's own language) and `OTHER_LABELS` (the second language, only if the project is bilingual). A single-language project needs only `LABELS`.
- A header template per language: `msg(n)` returns `"Grocery list (" + n + (n === 1 ? " item" : " items") + "):"`. French: `"Liste d’épicerie (n article[s]) :"`. Rename "Grocery list" and "item" for the new project, but keep the shape: `Title (N noun):`.

## 2. OUTPUT — the "Copy list" button

**Placement:** a `grocery-btn` (secondary, outlined) button directly after "Copy link", in the same actions row. Label "Copy list" (fr: "Copier la liste"). On success the label changes to "List copied!" (fr: "Liste copiée!") for 1.6 s, then reverts.

**What gets copied** (plain text, `\n` line endings):

1. Header line: `msg(N)`, where N is the total count of open items.
2. One blank line.
3. One block per non-empty category, in `ORDER` order (empty categories are omitted), blocks separated by a single blank line.
4. Each block is the category label on its own line (no colon, no bullet, no decoration), then one line per item written as `- ` + item text.
5. Items within a block are sorted alphabetically with `localeCompare(b, lang)`.
6. Language: the share language (`en`/`fr`) currently selected. Labels come from `LABELS` when that equals the page language, else `OTHER_LABELS`. Item text comes from the matching translation, falling back to `text`.
7. Items with a missing or unknown category go under `other`.

Example:

```
Grocery list (4 items):

Produce
- Bananas
- Spinach

Dairy & Eggs
- Milk
- Yogurt
```

**Clipboard mechanics:** try `navigator.clipboard.writeText(text)`. On failure or absence, fall back to a hidden, readonly `<textarea>` (fixed position, opacity 0), then `select()` and `document.execCommand("copy")`, and remove it afterwards. Do not rely on a visible input for the fallback.

## 3. INPUT — pasting a list

**Trigger:** a `paste` event on the "add an item" text input. If the clipboard text contains a line break (after trimming), call `preventDefault()` and import the whole text. Single-line pastes behave normally. (A plain `<input type="text">` flattens newlines, which is why interception is needed.)

**Parsing rules** (`gParse(raw)` → `[{ text, cat }]`):

*Multi-line input* (contains `\r` or `\n`): process line by line, one item per line. Commas are NOT split, so "eggs, large" stays one item.

*Single-line input* (typing or a one-line paste): split on `,` + whitespace and on `;`. This is the original behaviour, so `milk, eggs; bread` gives three items.

For each line in multi-line input, in this order:

1. Trim. Skip if empty.
2. Detect and strip a leading bullet: `- – — • * · ▪ ◦ ☐ ☑ ✓`, a checkbox `[ ]`/`[x]`, or a number `1.` / `1)`. Remember whether a bullet was present. Trim again and skip if empty.
3. **Header skip:** if there was no bullet and the line ends with `(<digits> <word(s)>)` plus an optional colon (matches both "(7 items):" and "(7 articles) :"), skip it.
4. **Category heading:** if there was no bullet and the line, minus a trailing colon, lowercased, equals any category label in either language's map, set the current category to that key and skip the line. This is how a pasted heading files the following lines.
5. Otherwise it's an item: `{ text: line, cat: currentCategory }` (`cat` is null until a heading has been seen).

Consequence: a bulleted line is always an item, even if it equals a heading name (e.g. "- Pantry").

**Adding the parsed items:**

- Category = the heading's key if there was one, else the keyword auto-categoriser, else `other`.
- Duplicates (case-insensitive match on `text`, `en`, or `fr`) are not added again. If the existing one is checked off, un-check it (`done = false`, delete `doneTs`).
- Bilingual projects: set the typed text on the page's own language field, then call the translate step to fill in the other.
- Persist, re-render, and put focus back in the input.

## 4. Reference code

```js
// OUTPUT
function gListText(){
  var L = groceryShareLang, by = {};
  groceries.filter(function(g){ return !g.done; }).forEach(function(g){
    var k = (g.category && GROCERY_LABELS[g.category]) ? g.category : GROCERY_OTHER_KEY;
    (by[k] = by[k] || []).push(gTextIn(g, L));
  });
  var n = 0, blocks = [];
  GROCERY_ORDER.forEach(function(k){
    if(!by[k]) return;
    n += by[k].length;
    var label = (L === G_LANG ? GROCERY_LABELS : G_OTHER_LABELS)[k];
    blocks.push(label + "\n" + by[k].sort(function(a, b){ return a.localeCompare(b, L); }).map(function(x){ return "- " + x; }).join("\n"));
  });
  return G_SHARE[L].msg(n) + "\n\n" + blocks.join("\n\n");
}

function gCopy(text, btn, label, doneLabel){
  label = label || G_STR.copy; doneLabel = doneLabel || G_STR.copied;
  function ok(){ btn.textContent = doneLabel; setTimeout(function(){ btn.textContent = label; }, 1600); }
  function fallback(){
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try{ if(document.execCommand("copy")) ok(); }catch(e){}
    document.body.removeChild(ta);
  }
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(ok).catch(fallback); }
  else fallback();
}

// INPUT
function gParse(raw){
  raw = String(raw);
  var multi = /\r|\n/.test(raw);
  var lines = multi ? raw.split(/\r\n|\r|\n/) : [raw];
  var headings = {};
  [GROCERY_LABELS, G_OTHER_LABELS].forEach(function(map){
    Object.keys(map).forEach(function(k){ headings[map[k].toLowerCase()] = k; });
  });
  var out = [], cat = null;
  lines.forEach(function(line){
    line = line.trim();
    if(!line) return;
    var bulleted = /^([-–—•*·▪◦☐☑✓]|\[[ xX]?\]|\d+[.)])\s*/.test(line);
    line = line.replace(/^([-–—•*·▪◦☐☑✓]|\[[ xX]?\]|\d+[.)])\s*/, "").trim();
    if(!line) return;
    if(multi && /\(\d+\s+[^)]+\)\s*:?\s*$/.test(line) && !bulleted) return;
    var h = line.replace(/\s*:\s*$/, "").toLowerCase();
    if(multi && !bulleted && headings[h]){ cat = headings[h]; return; }
    var pieces = multi ? [line] : line.split(/,\s+|;\s*/);
    pieces.forEach(function(p){ p = p.trim(); if(p) out.push({ text: p, cat: cat }); });
  });
  return out;
}

// In the add function: iterate gParse(raw) and use  category: part.cat || autoCategorise(text)

// Paste hook, on the add-item <input>:
input.addEventListener("paste", function(e){
  var txt = (e.clipboardData || window.clipboardData).getData("text");
  if(txt && /\r|\n/.test(txt.trim())){ e.preventDefault(); gAdd(txt); }
});
```

## 5. Compatibility checklist for the other project

- Category label text matches the console's wording exactly if lists will move between the two (Frozen, Household, Dairy & Eggs, Meat & Seafood, Bakery, Beverages, Snacks, Produce, Pantry, Other; French: Surgelés, Entretien ménager, Produits laitiers et œufs, Viande et poisson, Boulangerie, Boissons, Collations, Fruits et légumes, Garde-manger, Autre). Different category sets still import, but unrecognised headings are dropped, not kept as items.
- Output keeps the `- ` bullet and the blank-line-between-blocks layout, since the parser and any pasted-into apps (Notes, Messages) depend on them.
- Test: Copy list → paste into the add box on the same page. Every item should return as a duplicate (nothing new added). Then paste into the other project and confirm the categories carry over.
