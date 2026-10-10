/**
 * Caminho — leitor da Bíblia online.
 * Livros e capítulos a partir de assets/data/biblia/*; favoritos e
 * preferências guardados apenas no navegador (localStorage).
 */
"use strict";

import { copyText, toast, store } from "./site.js";

const state = {
  index: null,
  books: new Map(), // abbrev -> capítulo data (cache)
  book: "jo",
  chapter: 1,
  selected: new Set(), // números de versículo
  favorites: store.get("caminho:favoritos", []), // [{ref, book, chapter, verse, text}]
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const favKey = (b, c, v) => `${b}:${c}:${v}`;

/* ------------------------------------------------------------------ */
/* Carregamento                                                        */
/* ------------------------------------------------------------------ */
async function loadIndex() {
  if (state.index) return state.index;
  const r = await fetch("/assets/data/biblia/index.json");
  if (!r.ok) throw new Error("índice");
  state.index = await r.json();
  return state.index;
}

async function loadBook(abbrev) {
  if (state.books.has(abbrev)) return state.books.get(abbrev);
  const r = await fetch(`/assets/data/biblia/${encodeURIComponent(abbrev)}.json`);
  if (!r.ok) throw new Error("livro");
  const data = await r.json();
  state.books.set(abbrev, data);
  return data;
}

/* ------------------------------------------------------------------ */
/* Navegação lateral (livros) + grade de capítulos                     */
/* ------------------------------------------------------------------ */
function renderBookNav(index) {
  const nav = $("[data-book-nav]");
  if (!nav) return;
  const groups = [
    ["Antigo Testamento", index.old],
    ["Novo Testamento", index.new],
  ];
  nav.replaceChildren(
    ...groups.map(([label, books]) => {
      const wrap = document.createElement("div");
      wrap.className = "book-group";
      const h = document.createElement("h2");
      h.className = "book-group__title";
      h.textContent = label;
      const ul = document.createElement("ul");
      ul.className = "book-list";
      for (const b of books) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.className = "book-link";
        a.href = `#${b.abbrev}/1`;
        a.textContent = b.name;
        a.dataset.abbrev = b.abbrev;
        li.appendChild(a);
        ul.appendChild(li);
      }
      wrap.append(h, ul);
      return wrap;
    })
  );
}

function renderChapters(index) {
  const grid = $("[data-chapter-grid]");
  const title = $("[data-chapter-title]");
  if (!grid) return;
  const all = [...index.old, ...index.new];
  const book = all.find((b) => b.abbrev === state.book);
  if (!book) return;
  if (title) title.textContent = book.name;
  grid.replaceChildren(
    ...Array.from({ length: book.chapters }, (_, i) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "chapter-link";
      a.href = `#${book.abbrev}/${i + 1}`;
      a.textContent = String(i + 1);
      a.dataset.chapter = String(i + 1);
      if (i + 1 === state.chapter) a.setAttribute("aria-current", "true");
      li.appendChild(a);
      return li;
    })
  );
}

function markCurrentBook() {
  for (const a of $$(".book-link")) {
    if (a.dataset.abbrev === state.book) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  }
}

/* ------------------------------------------------------------------ */
/* Texto do capítulo                                                   */
/* ------------------------------------------------------------------ */
function renderChapter(book) {
  const root = $("[data-reader-text]");
  const heading = $("[data-reader-heading]");
  if (!root) return;
  const verses = book.chapters[state.chapter - 1] || [];
  if (heading) heading.textContent = `${book.name} ${state.chapter}`;
  const doc = document.createDocumentFragment();
  verses.forEach((text, i) => {
    const n = i + 1;
    const span = document.createElement("span");
    span.className = "verse verse--block verse--interactive";
    span.dataset.verse = String(n);
    const num = document.createElement("span");
    num.className = "verse__number";
    num.textContent = String(n);
    span.append(num, document.createTextNode(text + " "));
    const key = favKey(book.abbrev, state.chapter, n);
    if (state.favorites.some((f) => favKey(f.book, f.chapter, f.verse) === key)) {
      span.classList.add("is-favorite");
    }
    doc.appendChild(span);
  });
  root.replaceChildren(doc);
  document.title = `${book.name} ${state.chapter} — Bíblia — Caminho`;
}

function updatePagination(book) {
  const prev = $("[data-prev]");
  const next = $("[data-next]");
  const hasPrev = state.chapter > 1;
  const hasNext = state.chapter < book.chapters.length;
  if (prev) {
    prev.hidden = !hasPrev;
    prev.href = `#${book.abbrev}/${state.chapter - 1}`;
  }
  if (next) {
    next.hidden = !hasNext;
    next.href = `#${book.abbrev}/${state.chapter + 1}`;
  }
}

async function navigate() {
  const hash = location.hash.replace(/^#\/?/, "");
  const m = hash.match(/^([a-z0-9]+)\/(\d+)$/i);
  const meta = state.index.old.concat(state.index.new).find((b) => b.abbrev === (m ? m[1] : state.book));
  if (meta) state.book = meta.abbrev;
  state.chapter = m ? Math.min(Math.max(parseInt(m[2], 10), 1), meta.chapters) : 1;
  state.selected.clear();

  markCurrentBook();
  renderChapters(state.index);
  hideSelectionBar();

  const loading = $("[data-reader-loading]");
  const errorBox = $("[data-reader-error]");
  if (errorBox) errorBox.hidden = true;
  if (loading) loading.hidden = false;
  try {
    const book = await loadBook(state.book);
    renderChapter(book);
    updatePagination(book);
  } catch {
    if (errorBox) errorBox.hidden = false;
  } finally {
    if (loading) loading.hidden = true;
  }
}

/* ------------------------------------------------------------------ */
/* Seleção de versículos                                               */
/* ------------------------------------------------------------------ */
function hideSelectionBar() {
  const bar = $("[data-selection-bar]");
  if (bar) bar.hidden = true;
  for (const v of $$(".verse.is-selected")) v.classList.remove("is-selected");
}

function refreshSelection() {
  const bar = $("[data-selection-bar]");
  const count = $("[data-selection-count]");
  if (!bar) return;
  if (state.selected.size === 0) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  if (count) {
    count.textContent =
      state.selected.size === 1 ? "1 versículo selecionado" : `${state.selected.size} versículos selecionados`;
  }
}

function selectionText() {
  const book = state.books.get(state.book);
  const verses = book.chapters[state.chapter - 1];
  return [...state.selected]
    .sort((a, b) => a - b)
    .map((n) => `${verses[n - 1]} (${state.book === "jo" ? "João" : book.name} ${state.chapter}:${n})`)
    .join("\n");
}

function initSelection() {
  const text = $("[data-reader-text]");
  if (!text) return;
  text.addEventListener("click", (e) => {
    const verse = e.target.closest(".verse");
    if (!verse) return;
    const n = Number(verse.dataset.verse);
    if (state.selected.has(n)) {
      state.selected.delete(n);
      verse.classList.remove("is-selected");
    } else {
      state.selected.add(n);
      verse.classList.add("is-selected");
    }
    refreshSelection();
  });

  $("[data-selection-clear]")?.addEventListener("click", () => {
    state.selected.clear();
    hideSelectionBar();
  });
  $("[data-selection-copy]")?.addEventListener("click", async () => {
    const ok = await copyText(selectionText());
    toast(ok ? "Texto copiado." : "Não foi possível copiar.");
  });
  $("[data-selection-fav]")?.addEventListener("click", () => {
    const book = state.books.get(state.book);
    const verses = book.chapters[state.chapter - 1];
    let added = 0;
    for (const n of state.selected) {
      const key = favKey(state.book, state.chapter, n);
      if (!state.favorites.some((f) => favKey(f.book, f.chapter, f.verse) === key)) {
        state.favorites.push({
          ref: `${book.name} ${state.chapter}:${n}`,
          book: state.book,
          chapter: state.chapter,
          verse: n,
          text: verses[n - 1],
        });
        added++;
      }
      $(`.verse[data-verse="${n}"]`)?.classList.add("is-favorite");
    }
    persistFavorites();
    renderFavorites();
    toast(added ? `${added} guardado(s) em favoritos.` : "Já estava nos favoritos.");
  });
}

/* ------------------------------------------------------------------ */
/* Favoritos                                                           */
/* ------------------------------------------------------------------ */
function persistFavorites() {
  store.set("caminho:favoritos", state.favorites);
}

function renderFavorites() {
  const list = $("[data-favorites]");
  const empty = $("[data-favorites-empty]");
  const count = $("[data-favorites-count]");
  if (!list) return;
  if (count) count.textContent = state.favorites.length ? `${state.favorites.length}` : "";
  if (!state.favorites.length) {
    list.replaceChildren();
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  const frag = document.createDocumentFragment();
  for (const f of state.favorites.slice().reverse()) {
    const li = document.createElement("li");
    li.className = "favorite-item";
    const ref = document.createElement("p");
    ref.className = "favorite-item__reference";
    ref.textContent = f.ref;
    const p = document.createElement("p");
    p.className = "favorite-item__text";
    p.textContent = f.text;
    const actions = document.createElement("div");
    actions.className = "favorite-item__actions";
    const go = document.createElement("a");
    go.className = "button button--secondary button--small";
    go.href = `/biblia#${f.book}/${f.chapter}`;
    go.textContent = "Abrir capítulo";
    const copy = document.createElement("button");
    copy.className = "button button--quiet button--small";
    copy.type = "button";
    copy.textContent = "Copiar";
    copy.addEventListener("click", async () => {
      const ok = await copyText(`${f.text} — ${f.ref} (Almeida Revisada)`);
      toast(ok ? "Copiado." : "Falha ao copiar.");
    });
    const rm = document.createElement("button");
    rm.className = "button button--quiet button--small";
    rm.type = "button";
    rm.textContent = "Remover";
    rm.addEventListener("click", () => {
      const key = favKey(f.book, f.chapter, f.verse);
      state.favorites = state.favorites.filter((x) => favKey(x.book, x.chapter, x.verse) !== key);
      persistFavorites();
      renderFavorites();
      $(`.verse[data-verse="${f.verse}"]`)?.classList.remove("is-favorite");
    });
    actions.append(go, copy, rm);
    li.append(ref, p, actions);
    frag.appendChild(li);
  }
  list.replaceChildren(frag);
}

/* ------------------------------------------------------------------ */
/* Tamanho do texto                                                    */
/* ------------------------------------------------------------------ */
const SIZES = ["bible-reader--small", "", "bible-reader--large"];
function applySize(cls) {
  const reader = $("[data-reader]");
  if (!reader) return;
  reader.classList.remove(...SIZES.filter(Boolean));
  if (cls) reader.classList.add(cls);
  store.set("caminho:bible-size", cls);
}
function initSizeControls() {
  applySize(store.get("caminho:bible-size", ""));
  $("[data-size-down]")?.addEventListener("click", () => {
    const cur = store.get("caminho:bible-size", "");
    const i = SIZES.indexOf(cur);
    applySize(SIZES[Math.max(0, i - 1)]);
  });
  $("[data-size-up]")?.addEventListener("click", () => {
    const cur = store.get("caminho:bible-size", "");
    const i = SIZES.indexOf(cur);
    applySize(SIZES[Math.min(SIZES.length - 1, i + 1)]);
  });
}

/* ------------------------------------------------------------------ */
/* Início                                                              */
/* ------------------------------------------------------------------ */
(async function start() {
  const errBox = $("[data-reader-error]");
  try {
    const index = await loadIndex();
    renderBookNav(index);
    initSelection();
    initSizeControls();
    renderFavorites();
    window.addEventListener("hashchange", navigate);
    await navigate();
    // Busca rápida por livro (filtra a lista lateral)
    $("[data-book-filter]")?.addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      for (const a of $$(".book-link")) {
        a.closest("li").hidden = q ? !a.textContent.toLowerCase().includes(q) : false;
      }
    });
  } catch {
    if (errBox) errBox.hidden = false;
  }
})();
