#!/usr/bin/env node
/**
 * Build de dados do site Caminho.
 * Gera:
 *   assets/data/biblia/*.json  — um arquivo por livro (AA, domínio público)
 *   assets/data/biblia/index.json — índice de livros (NT/VT)
 *   assets/data/versiculos.json — versículos do dia (extraídos do texto-fonte)
 *   assets/data/busca-index.json — índice de busca do site (texto das páginas)
 *
 * Uso: node scripts/build.js
 * A fonte bíblica (scripts/cache/aa.json) é baixada uma vez e cacheada.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const CACHE = path.join(__dirname, "cache");
const AA_URL = "https://raw.githubusercontent.com/thiagobodruk/biblia/master/json/aa.json";

const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
const writeJSON = (p, obj) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
};

/* ------------------------------------------------------------------ */
/* 1. Fonte bíblica (baixa uma vez, cacheia)                           */
/* ------------------------------------------------------------------ */
async function ensureSource() {
  const file = path.join(CACHE, "aa.json");
  if (fs.existsSync(file)) return file;
  console.log("Baixando texto bíblico (Almeida Revisada, domínio público)…");
  const res = await fetch(AA_URL, {
    headers: { "User-Agent": "CaminhoBuild/1.0" },
  });
  if (!res.ok) throw new Error(`Falha ao baixar AA: ${res.status}`);
  const text = (await res.text()).replace(/^﻿/, "");
  JSON.parse(text); // valida
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

/* ------------------------------------------------------------------ */
/* 2. Bíblia por livro                                                  */
/* ------------------------------------------------------------------ */
function buildBible(books) {
  let verses = 0;
  for (const b of books) {
    const out = { abbrev: b.abbrev, name: b.name, chapters: b.chapters };
    writeJSON(path.join(ROOT, "assets/data/biblia", `${b.abbrev}.json`), out);
    for (const c of b.chapters) verses += c.length;
  }
  writeJSON(path.join(ROOT, "assets/data/biblia/index.json"), {
    translation: "Almeida Revisada (domínio público)",
    old: books.slice(0, 39).map(({ abbrev, name, chapters }) => ({
      abbrev,
      name,
      chapters: chapters.length,
      verses: chapters.map((c) => c.length),
    })),
    new: books.slice(39).map(({ abbrev, name, chapters }) => ({
      abbrev,
      name,
      chapters: chapters.length,
      verses: chapters.map((c) => c.length),
    })),
  });
  console.log(`Bíblia: ${books.length} livros, ${verses} versículos.`);
}

/* ------------------------------------------------------------------ */
/* 3. Versículos do dia                                                */
/* ------------------------------------------------------------------ */
// Referências curadas; o texto é extraído da fonte (nada é digitado à mão).
const VERSE_REFS = [
  "gn 1:1", "gn 1:3", "gn 15:6", "gn 50:20",
  "sl 23:1", "sl 23:4", "sl 27:1", "sl 34:9", "sl 37:4", "sl 46:1",
  "sl 91:1", "sl 119:105", "sl 121:1", "sl 139:23",
  "is 9:6", "is 40:31", "is 41:10", "is 53:5", "is 53:6",
  "jr 29:11", "pv 3:5",
  "mt 5:3", "mt 5:4", "mt 5:6", "mt 5:9", "mt 6:33", "mt 7:7",
  "mt 11:28", "mt 16:26", "mt 28:19", "mt 28:20",
  "mc 10:45", "lc 19:10",
  "jo 1:1", "jo 1:12", "jo 3:16", "jo 3:17", "jo 8:12", "jo 10:10",
  "jo 11:25", "jo 14:1", "jo 14:6", "jo 14:27", "jo 15:5", "jo 20:31",
  "atos 4:12", "atos 16:31",
  "rm 3:23", "rm 5:1", "rm 5:8", "rm 6:23", "rm 8:1", "rm 8:28", "rm 8:38",
  "1co 10:13", "1co 13:4", "1co 13:13", "2co 5:17", "2co 12:9",
  "gl 2:20", "ef 2:8", "ef 2:10",
  "fp 4:6", "fp 4:7", "fp 4:13",
  "1ts 5:16", "1ts 5:17",
  "2tm 1:7", "2tm 3:16",
  "hb 11:1", "hb 11:6", "1pe 5:7", "1jo 1:9", "1jo 4:8", "1jo 5:11",
  "ap 3:20", "ap 21:4", "ap 21:5",
];

function buildVerses(books) {
  const byAbbrev = new Map(books.map((b) => [b.abbrev, b]));
  const out = [];
  const missing = [];
  for (const ref of VERSE_REFS) {
    const m = ref.match(/^(\S+)\s+(\d+):(\d+)$/);
    if (!m) throw new Error(`Referência inválida: ${ref}`);
    const [, abbrev, ch, vs] = m;
    const book = byAbbrev.get(abbrev);
    const verse = book && book.chapters[+ch - 1] && book.chapters[+ch - 1][+vs - 1];
    if (!verse) {
      missing.push(ref);
      continue;
    }
    out.push({
      ref,
      book: book.name,
      chapter: +ch,
      verse: +vs,
      text: verse,
    });
  }
  if (missing.length) {
    console.error("Referências não encontradas:", missing.join(", "));
    process.exitCode = 1;
  }
  writeJSON(path.join(ROOT, "assets/data/versiculos.json"), out);
  console.log(`Versículos do dia: ${out.length} extraídos.`);
}

/* ------------------------------------------------------------------ */
/* 4. Índice de busca do site                                          */
/* ------------------------------------------------------------------ */
const SEARCH_PAGES = [
  "index.html", "jesus.html", "biblia.html", "reflexoes.html",
  "louvores.html", "igrejas.html", "oracao.html", "sobre.html",
  "reflexao-pao-e-peixe.html",
  "reflexao-quando-o-caminho-escurece.html",
  "reflexao-o-que-significa-crer.html",
];

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchIndex() {
  const items = [];
  for (const file of SEARCH_PAGES) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) {
      console.warn(`busca: pulando ${file} (não existe)`);
      continue;
    }
    const html = fs.readFileSync(p, "utf8");
    const title = (html.match(/<title>([^<]*)<\/title>/i) || [, ""])[1].trim();
    const desc = (html.match(/name="description" content="([^"]*)"/i) || [, ""])[1];
    const body = (html.match(/<main[\s\S]*?<\/main>/i) || [, ""])[0] || html;
    const text = stripTags(body);
    items.push({
      url: "/" + file.replace(/\.html$/, "").replace(/^index$/, ""),
      title,
      desc,
      text: text.slice(0, 4000),
    });
  }
  writeJSON(path.join(ROOT, "assets/data/busca-index.json"), items);
  console.log(`Busca: ${items.length} páginas indexadas.`);
}

/* ------------------------------------------------------------------ */
(async () => {
  const src = await ensureSource();
  const books = readJSON(src);
  buildBible(books);
  buildVerses(books);
  buildSearchIndex();
  console.log("Build concluído.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
