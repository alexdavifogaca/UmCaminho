/**
 * Caminho — Louvores.
 * Carrega assets/data/louvores.json, renderiza o catálogo em cartões com
 * capa, letra, reflexão e links (Spotify/YouTube), e permite filtrar.
 */
"use strict";
import { copyText, toast } from "./site.js";

const grid = document.querySelector("[data-louvores]");
if (grid) init();

async function init() {
  const search = document.querySelector("[data-louvores-search]");
  const count = document.querySelector("[data-louvores-count]");
  const empty = document.querySelector("[data-louvores-empty]");

  let louvores = [];
  try {
    const res = await fetch("/assets/data/louvores.json");
    if (!res.ok) throw new Error();
    const data = await res.json();
    louvores = Array.isArray(data) ? data : data.louvores;
  } catch {
    grid.replaceChildren(
      el("p", { class: "favorite-empty" }, ["Não foi possível carregar os louvores agora. Recarregue a página."])
    );
    return;
  }
  if (!Array.isArray(louvores) || !louvores.length) {
    grid.replaceChildren(el("p", { class: "favorite-empty" }, ["Nenhum louvor cadastrado ainda."]));
    return;
  }

  const normalize = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const matches = (item, q) => {
    if (!q) return true;
    const hay = normalize(
      [item.titulo, item.original, item.autor, item.tema, item.referencia, item.reflexao, (item.letra || []).join(" ")].join(" ")
    );
    return q.split(/\s+/).every((term) => hay.includes(term));
  };

  const render = (list) => {
    grid.replaceChildren(...list.map(card));
    if (count) {
      count.textContent =
        list.length === louvores.length
          ? `${louvores.length} ${louvores.length === 1 ? "louvor" : "louvores"}`
          : `${list.length} de ${louvores.length} louvores`;
    }
    if (empty) empty.hidden = list.length !== 0;
  };

  search?.addEventListener("input", () => {
    const q = normalize(search.value.trim());
    render(louvores.filter((item) => matches(item, q)));
  });

  render(louvores);
}

/* ------------------------------------------------------------------ */
/* Cartão de um louvor                                                 */
/* ------------------------------------------------------------------ */
function card(item) {
  const meta = [item.tema, item.autor, item.ano].filter(Boolean).join(" · ");

  const links = [];
  const spotifyUrl = item.spotify || (item.busca ? `https://open.spotify.com/search/${encodeURIComponent(item.busca)}` : null);
  const youtubeUrl = item.youtube || (item.busca ? `https://www.youtube.com/results?search_query=${encodeURIComponent(item.busca)}` : null);
  if (spotifyUrl) links.push(outLink("Spotify", spotifyUrl, "button button--small"));
  if (youtubeUrl) links.push(outLink("YouTube", youtubeUrl, "button button--secondary button--small"));

  const letra = el("div", { class: "louvor__lyrics" }, (item.letra || []).map((est) => el("p", { class: "louvor__stanza", text: est })));
  if (!(item.letra || []).length) letra.replaceChildren(el("p", { class: "text-muted", text: "Letra ainda não cadastrada." }));

  const copyBtn = el("button", { class: "button button--quiet button--small", type: "button" }, ["Copiar letra"]);
  copyBtn.addEventListener("click", async () => {
    const text = `${item.titulo} — ${item.autor || ""}\n\n${(item.letra || []).join("\n\n")}`.trim();
    const ok = await copyText(text);
    toast(ok ? "Letra copiada." : "Não foi possível copiar.");
  });

  const refNode = item.referencia
    ? el("p", { class: "louvor__ref" }, [
        "Referência: ",
        item.refLink ? el("a", { class: "scripture-ref", href: item.refLink, text: item.referencia }) : el("span", { text: item.referencia }),
      ])
    : null;

  const details = el("details", { class: "louvor__details" }, [
    el("summary", { class: "louvor__summary" }, ["Letra e reflexão"]),
    letra,
    el("p", { class: "louvor__reflection", text: item.reflexao || "" }),
    refNode,
    el("div", { class: "louvor__actions" }, [copyBtn]),
  ]);

  return el("article", { class: "card louvor" }, [
    cover(item),
    el("div", { class: "card__body" }, [
      el("p", { class: "card__meta", text: meta }),
      el("h3", { class: "card__title", text: item.titulo }),
      el("p", { class: "card__text", text: item.reflexao || "" }),
      links.length ? el("div", { class: "louvor__links" }, links) : null,
      details,
    ]),
  ]);
}

/* ------------------------------------------------------------------ */
/* Capa: imagem local ou capa gerada (monograma sobre cor)             */
/* ------------------------------------------------------------------ */
function cover(item) {
  const wrap = el("div", { class: "card__media louvor__cover" });
  if (item.capa) {
    wrap.appendChild(
      el("img", { class: "card__img louvor__img", src: item.capa, alt: `Capa de ${item.titulo}`, loading: "lazy", width: "600", height: "600" })
    );
    return wrap;
  }
  wrap.classList.add("louvor__cover--gen");
  wrap.style.setProperty("--louvor-cor", item.cor || "#D7C8A9");
  wrap.appendChild(el("span", { class: "louvor__initials", "aria-hidden": "true", text: initials(item.titulo) }));
  wrap.appendChild(el("span", { class: "louvor__cover-title", text: item.original || item.titulo }));
  return wrap;
}

function initials(title) {
  const words = String(title || "?").split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "♪";
}

function outLink(label, href, className) {
  return el("a", { class: className, href, target: "_blank", rel: "noopener noreferrer", text: label });
}

/* ------------------------------------------------------------------ */
/* Utilitário de criação de elementos                                  */
/* ------------------------------------------------------------------ */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}
