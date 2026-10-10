/**
 * Caminho — busca no conteúdo do site.
 * Carrega assets/data/busca-index.json (gerado por scripts/build.js)
 * e filtra no navegador, sem enviar nada para fora.
 */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let index = [];
let filtro = "tudo";

const norm = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

function snippet(text, q) {
  const t = norm(text);
  const i = t.indexOf(q);
  if (i < 0) return text.slice(0, 180) + (text.length > 180 ? "…" : "");
  const start = Math.max(0, i - 70);
  const end = Math.min(text.length, i + q.length + 110);
  const slice = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
  // destaca sem innerHTML: quebra em nós de texto
  const frag = document.createDocumentFragment();
  const low = norm(slice);
  let pos = 0;
  let hit = low.indexOf(q);
  while (hit >= 0) {
    frag.appendChild(document.createTextNode(slice.slice(pos, hit)));
    const mark = document.createElement("mark");
    mark.className = "highlight";
    mark.textContent = slice.slice(hit, hit + q.length);
    frag.appendChild(mark);
    pos = hit + q.length;
    hit = low.indexOf(q, pos);
  }
  frag.appendChild(document.createTextNode(slice.slice(pos)));
  return frag;
}

function match(item, q) {
  const inTitle = norm(item.title).includes(q);
  const inDesc = norm(item.desc || "").includes(q);
  const inText = norm(item.text || "").includes(q);
  let score = 0;
  if (inTitle) score += 10;
  if (inDesc) score += 5;
  if (inText) score += 1;
  return score;
}

function category(item) {
  if (item.url.startsWith("/reflexao-")) return "reflexoes";
  if (item.url === "/biblia") return "biblia";
  if (item.url === "/igrejas") return "igrejas";
  return "paginas";
}

function render(qRaw) {
  const list = $("[data-search-results]");
  const summary = $("[data-search-summary]");
  const empty = $("[data-search-empty]");
  if (!list) return;
  const q = norm(qRaw.trim());

  if (!q) {
    list.replaceChildren();
    if (summary) summary.textContent = "";
    if (empty) empty.hidden = true;
    return;
  }

  const hits = index
    .map((item) => ({ item, score: match(item, q) }))
    .filter((h) => h.score > 0 && (filtro === "tudo" || category(h.item) === filtro))
    .sort((a, b) => b.score - a.score);

  if (summary) {
    summary.textContent =
      hits.length === 0
        ? `Nada encontrado para “${qRaw.trim()}”.`
        : hits.length === 1
          ? "1 resultado."
          : `${hits.length} resultados.`;
  }
  if (empty) empty.hidden = hits.length > 0;

  const frag = document.createDocumentFragment();
  for (const { item } of hits.slice(0, 40)) {
    const li = document.createElement("li");
    li.className = "search-result";
    const ref = document.createElement("p");
    ref.className = "search-result__reference";
    ref.textContent = item.title;
    const h = document.createElement("h3");
    h.className = "search-result__title";
    const a = document.createElement("a");
    a.href = item.url;
    a.textContent = item.title.replace(/\s+[—–-]\s+Caminho.*$/i, "");
    h.appendChild(a);
    const p = document.createElement("p");
    p.className = "search-result__snippet";
    p.appendChild(snippet(item.desc && norm(item.desc).includes(q) ? item.desc : item.text, q));
    li.append(ref, h, p);
    frag.appendChild(li);
  }
  list.replaceChildren(frag);
}

function init() {
  const form = $("[data-search-form]");
  const input = $("[data-search-input]");
  if (!form || !input) return;

  fetch("/assets/data/busca-index.json")
    .then((r) => r.json())
    .then((data) => {
      index = Array.isArray(data) ? data : [];
      const params = new URLSearchParams(location.search);
      const q = params.get("q");
      if (q) {
        input.value = q;
        render(q);
      }
    })
    .catch(() => {
      const box = $("[data-search-error]");
      if (box) box.hidden = false;
    });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    history.replaceState(null, "", q ? `?q=${encodeURIComponent(q)}` : location.pathname);
    render(q);
  });
  input.addEventListener("input", () => render(input.value));

  for (const chip of $$("[data-filter]")) {
    chip.addEventListener("click", () => {
      filtro = chip.dataset.filter;
      for (const c of $$("[data-filter]")) c.setAttribute("aria-pressed", String(c === chip));
      render(input.value);
    });
  }
}

init();
