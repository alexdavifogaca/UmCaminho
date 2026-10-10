#!/usr/bin/env node
/**
 * Caminho — servidor web (Node.js, zero dependências).
 *
 * Funções:
 *   • Serve os arquivos estáticos do projeto com cache, compressão e
 *     cabeçalhos de segurança (CSP estrita, sem CDN de terceiros).
 *   • POST /api/oracao — recebimento de pedidos de oração:
 *     validação, honeypot, limite de taxa por IP e armazenamento local
 *     em data/oracoes.jsonl (nunca exposto publicamente).
 *   • GET  /api/igrejas  — busca de igrejas próximas via OpenStreetMap
 *     (proxy do Overpass API com cache em memória e plano B local).
 *
 * Uso: node server.js  [PORTA=3000]
 */
"use strict";

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { URL } = require("url");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(ROOT, "data");
const ORACOES_FILE = path.join(DATA_DIR, "oracoes.jsonl");

/* Diretórios/arquivos nunca servidos */
const BLOCKED = new Set(["data", "scripts", "node_modules", ".git", ".env", "package.json", "package-lock.json", "server.js"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".svg", ".xml", ".txt", ".webmanifest"]);

/* Cabeçalhos de segurança. CSP estrita: nenhum script/style de terceiros,
   nenhum inline script; estilos inline apenas para variáveis de layout
   (--hero-image etc.) e formatação dinâmica de barra de progresso. */
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'self'; object-src 'none'; " +
    "frame-ancestors 'self'; form-action 'self'; " +
    "img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self'; font-src 'self'; connect-src 'self'; " +
    "frame-src https://www.openstreetmap.org",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-Frame-Options": "SAMEORIGIN",
};

/* ------------------------------------------------------------------ */
/* Utilitários                                                         */
/* ------------------------------------------------------------------ */
const now = () => Date.now();
const log = (line) => console.log(`${new Date().toISOString()} ${line}`);

function clientIp(req) {
  // Confiamos apenas no socket; proxies reversos devem ser configurados
  // explicitamente (variável TRUST_PROXY=1).
  if (process.env.TRUST_PROXY === "1") {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string" && fwd.length < 200) return fwd.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "desconhecido";
}

function sendJSON(res, status, obj, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJSON(res, status, { ok: false, erro: message });
}

/* ------------------------------------------------------------------ */
/* Arquivos estáticos                                                  */
/* ------------------------------------------------------------------ */
function resolveStatic(urlPath) {
  // decode + normalização rigorosa contra traversal
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const clean = path.posix.normalize(decoded).replace(/^\/+/, "");
  if (clean.startsWith("..") || clean.includes("/../") || clean.endsWith("/..")) return null;

  const first = clean.split("/")[0];
  if (BLOCKED.has(first) || first.startsWith(".")) return null;

  let abs = path.join(ROOT, clean);
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) return null;

  // URLs sem extensão → página .html (URLs limpas)
  if (clean === "" || clean.endsWith("/")) {
    abs = path.join(abs, "index.html");
  } else if (!path.extname(clean) && fs.existsSync(abs + ".html")) {
    abs = abs + ".html";
  }
  return abs;
}

function cacheControlFor(file) {
  const ext = path.extname(file);
  if (ext === ".html") return "no-cache";
  if (ext === ".json") return "public, max-age=3600, stale-while-revalidate=86400";
  if (ext === ".woff2" || [".jpg", ".jpeg", ".png", ".webp", ".svg"].includes(ext)) {
    return "public, max-age=604800, stale-while-revalidate=2592000";
  }
  return "public, max-age=86400, stale-while-revalidate=604800";
}

function encode(req, file, buf) {
  const ext = path.extname(file);
  const ae = String(req.headers["accept-encoding"] || "");
  if (!COMPRESSIBLE.has(ext) || buf.length < 1024) return null;
  if (/\bbr\b/.test(ae)) return { data: zlib.brotliCompressSync(buf), enc: "br" };
  if (/\bgzip\b/.test(ae)) return { data: zlib.gzipSync(buf), enc: "gzip" };
  return null;
}

async function serveStatic(req, res, urlPath) {
  const file = resolveStatic(urlPath);
  if (!file) {
    sendError(res, 404, "Não encontrado.");
    return;
  }
  let stat, buf;
  try {
    stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error("não é arquivo");
    buf = await fsp.readFile(file);
  } catch {
    sendError(res, 404, "Não encontrado.");
    return;
  }

  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    ...SECURITY_HEADERS,
    "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
    "Cache-Control": cacheControlFor(file),
    ETag: etag,
  };

  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  const compressed = encode(req, file, buf);
  if (compressed) {
    headers["Content-Encoding"] = compressed.enc;
    headers["Vary"] = "Accept-Encoding";
    buf = compressed.data;
  }
  headers["Content-Length"] = buf.length;
  res.writeHead(200, headers);
  res.end(buf);
}

/* ------------------------------------------------------------------ */
/* Limitador de taxa (em memória, por IP)                              */
/* ------------------------------------------------------------------ */
const buckets = new Map(); // ip -> { count, resetAt }
function rateLimit(ip, limit, windowMs) {
  const t = now();
  let b = buckets.get(ip);
  if (!b || b.resetAt <= t) {
    b = { count: 0, resetAt: t + windowMs };
    buckets.set(ip, b);
  }
  b.count += 1;
  return b.count <= limit;
}
setInterval(() => {
  const t = now();
  for (const [ip, b] of buckets) if (b.resetAt <= t) buckets.delete(ip);
}, 60_000).unref();

/* ------------------------------------------------------------------ */
/* POST /api/oracao                                                    */
/* ------------------------------------------------------------------ */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = (msg) => {
      if (done) return;
      done = true;
      req.destroy();
      reject(new Error(msg));
    };
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) return fail("payload muito grande");
      chunks.push(c);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", () => fail("erro de leitura"));
  });
}

async function handleOracao(req, res) {
  const ip = clientIp(req);

  // Proteção CSRF leve: exige cabeçalho customizado (só vem do nosso JS)
  if (String(req.headers["x-requested-with"] || "") !== "caminho") {
    return sendError(res, 403, "Requisição não autorizada.");
  }
  const ct = String(req.headers["content-type"] || "");
  if (!ct.includes("application/json")) {
    return sendError(res, 415, "Use application/json.");
  }
  if (!rateLimit(ip, 5, 10 * 60_000)) {
    return sendError(res, 429, "Muitas solicitações. Tente novamente em alguns minutos.");
  }

  let body;
  try {
    body = await readBody(req, 32 * 1024);
  } catch (e) {
    return sendError(res, e.message.includes("grande") ? 413 : 400, "Requisição inválida.");
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return sendError(res, 400, "JSON inválido.");
  }
  if (typeof data !== "object" || data === null) return sendError(res, 400, "JSON inválido.");

  // Honeypot: campo "site" deve permanecer vazio; "marca" deve ser um
  // timestamp de carregamento do formulário (>2 s atrás, < 24 h).
  if (typeof data.site === "string" && data.site.trim() !== "") {
    // Falso sucesso para o robô; nada é gravado.
    return sendJSON(res, 200, { ok: true });
  }
  const marca = Number(data.marca);
  const idade = now() - marca;
  if (!Number.isFinite(marca) || idade < 2000 || idade > 24 * 3600_000) {
    return sendError(res, 400, "Formulário expirado. Recarregue a página.");
  }

  const texto = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const nome = texto(data.nome, 120);
  const email = texto(data.email, 200);
  const pedido = typeof data.pedido === "string" ? data.pedido.replace(/\r\n?/g, "\n").trim() : "";

  const errors = {};
  if (pedido.length < 10) errors.pedido = "Conte um pouco mais sobre o pedido (mínimo de 10 caracteres).";
  if (pedido.length > 3000) errors.pedido = "O pedido é longo demais (máximo de 3000 caracteres).";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "E-mail inválido.";
  if (Object.keys(errors).length) {
    return sendJSON(res, 422, { ok: false, erro: "validacao", campos: errors });
  }

  const CATEGORIAS = new Set(["", "saude", "familia", "trabalho", "decisoes", "financeiro", "outro"]);
  const categoria = CATEGORIAS.has(data.categoria) ? data.categoria : "outro";

  const registro = {
    id: crypto.randomUUID(),
    recebidoEm: new Date().toISOString(),
    nome: nome || null,
    email: email || null,
    categoria,
    pedido,
    anonimo: !nome,
    ipHash: crypto.createHash("sha256").update(String(ip) + (process.env.SALT || "caminho")).digest("hex").slice(0, 16),
  };

  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.appendFile(ORACOES_FILE, JSON.stringify(registro) + "\n", "utf8");
  } catch (err) {
    log(`ERRO oracao: ${err.message}`);
    return sendError(res, 500, "Não foi possível registrar agora. Tente mais tarde.");
  }
  log(`oracao recebida id=${registro.id}`);
  return sendJSON(res, 201, { ok: true });
}

/* ------------------------------------------------------------------ */
/* GET /api/igrejas — Overpass (OpenStreetMap) com cache e fallback    */
/* ------------------------------------------------------------------ */
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const igrejaCache = new Map(); // chave -> { at, payload }

function cacheGet(key) {
  const e = igrejaCache.get(key);
  if (e && now() - e.at < 10 * 60_000) return e.payload;
  return null;
}
function cacheSet(key, payload) {
  if (igrejaCache.size > 60) igrejaCache.delete(igrejaCache.keys().next().value);
  igrejaCache.set(key, { at: now(), payload });
}

async function fetchOverpass(query, timeoutMs = 9000) {
  for (const endpoint of OVERPASS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "Caminho/1.0 (busca de igrejas; node)",
        },
        body: "data=" + encodeURIComponent(query),
        signal: ctrl.signal,
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trimStart().startsWith("{")) continue; // página de erro HTML
      const json = JSON.parse(text);
      if (json && Array.isArray(json.elements)) return json.elements;
    } catch {
      /* tenta a próxima instância */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function overpassQuery(lat, lon, raioKm) {
  return `[out:json][timeout:12];(
    node["amenity"="place_of_worship"]["religion"="christian"](around:${raioKm * 1000},${lat},${lon});
    way["amenity"="place_of_worship"]["religion"="christian"](around:${raioKm * 1000},${lat},${lon});
  );out center 40;`;
}

function normalizar(el) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  return {
    id: el.type + "/" + el.id,
    nome: t.name || "Igreja sem nome",
    denom: t.denomination || null,
    cidade: t["addr:city"] || null,
    rua: [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(", ") || null,
    telefone: t.phone || t["contact:phone"] || null,
    site: t.website || t["contact:website"] || null,
    horarios: t.opening_hours || null,
    lat,
    lon,
  };
}

async function handleIgrejas(req, res, url) {
  const ip = clientIp(req);
  if (!rateLimit(ip, 30, 60_000)) return sendError(res, 429, "Muitas buscas. Aguarde um minuto.");

  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const raio = Math.min(25, Math.max(0.5, Number(url.searchParams.get("raio") || 5)));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return sendError(res, 400, "Informe coordenadas válidas (lat, lon).");
  }

  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${raio}`;
  const cached = cacheGet(key);
  if (cached) return sendJSON(res, 200, cached, { "X-Cache": "hit" });

  const elements = await fetchOverpass(overpassQuery(lat, lon, raio));
  let payload;
  if (elements) {
    const vistos = new Set();
    const igrejas = [];
    for (const el of elements) {
      const n = normalizar(el);
      if (!n || vistos.has(n.nome + n.lat.toFixed(3))) continue;
      vistos.add(n.nome + n.lat.toFixed(3));
      igrejas.push(n);
    }
    igrejas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    payload = { ok: true, fonte: "openstreetmap", total: igrejas.length, igrejas };
  } else {
    // Plano B: lista de exemplo exibida com aviso claro na interface
    const exemplo = JSON.parse(await fsp.readFile(path.join(ROOT, "assets/data/igrejas-exemplo.json"), "utf8"));
    payload = { ok: true, fonte: "exemplo", total: exemplo.length, igrejas: exemplo,
      aviso: "A busca ao vivo do OpenStreetMap não respondeu. Exibindo exemplos ilustrativos." };
  }
  cacheSet(key, payload);
  return sendJSON(res, 200, payload, { "X-Cache": "miss" });
}

/* ------------------------------------------------------------------ */
/* GET /api/localizar — geocodificação (proxy do Nominatim/OSM)        */
/* ------------------------------------------------------------------ */
const localizarCache = new Map();

async function handleLocalizar(req, res, url) {
  const ip = clientIp(req);
  if (!rateLimit(ip, 20, 60_000)) return sendError(res, 429, "Muitas buscas. Aguarde um minuto.");

  const q = String(url.searchParams.get("q") || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (q.length < 2) return sendError(res, 400, "Informe um local (bairro, cidade ou CEP).");

  const key = q.toLowerCase();
  const cached = localizarCache.get(key);
  if (cached && now() - cached.at < 24 * 3600_000) {
    return sendJSON(res, 200, cached.payload, { "X-Cache": "hit" });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const qs = new URLSearchParams({ format: "jsonv2", limit: "1", q });
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`, {
      headers: { "User-Agent": "Caminho/1.0 (localização de igrejas; node)" },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error("nominatim " + r.status);
    const arr = await r.json();
    const hit = Array.isArray(arr) && arr[0];
    if (!hit) return sendJSON(res, 404, { ok: false, erro: "Local não encontrado." });
    const payload = {
      ok: true,
      lat: Number(hit.lat),
      lon: Number(hit.lon),
      rotulo: String(hit.display_name || q).slice(0, 200),
    };
    if (localizarCache.size > 100) localizarCache.delete(localizarCache.keys().next().value);
    localizarCache.set(key, { at: now(), payload });
    return sendJSON(res, 200, payload);
  } catch {
    return sendError(res, 502, "Não foi possível localizar agora. Tente novamente.");
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Roteamento                                                          */
/* ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const started = now();
  res.on("finish", () => {
    log(`${req.socket.remoteAddress} ${req.method} ${req.url} -> ${res.statusCode} (${now() - started}ms)`);
  });

  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    return sendError(res, 400, "URL inválida.");
  }

  try {
    if (req.method === "POST" && url.pathname === "/api/oracao") {
      return await handleOracao(req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/igrejas") {
      return await handleIgrejas(req, res, url);
    }
    if (req.method === "GET" && url.pathname === "/api/localizar") {
      return await handleLocalizar(req, res, url);
    }
    if (req.method === "GET" && url.pathname === "/api/saude") {
      return sendJSON(res, 200, { ok: true, uptime: process.uptime() });
    }
    if (url.pathname.startsWith("/api/")) {
      return sendError(res, 404, "Endpoint não encontrado.");
    }
    if (req.method === "GET" || req.method === "HEAD") {
      return await serveStatic(req, res, url.pathname);
    }
    return sendError(res, 405, "Método não permitido.");
  } catch (err) {
    log(`ERRO: ${err.stack || err.message}`);
    if (!res.headersSent) sendError(res, 500, "Erro interno.");
  }
});

server.listen(PORT, () => {
  log(`Caminho ouvindo em http://localhost:${PORT}`);
});
