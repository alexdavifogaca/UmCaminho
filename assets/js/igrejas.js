/**
 * Caminho — busca de igrejas próximas.
 * Geocodificação e igrejas pelos endpoints do próprio servidor
 * (proxy do OpenStreetMap; sem chaves de API).
 */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const DENOMS = {
  evangelical: "Evangélica",
  anglican: "Anglicana",
  lutheran: "Luterana",
  baptist: "Batista",
  pentecostal: "Pentecostal",
  methodist: "Metodista",
  presbyterian: "Presbiteriana",
  assemblies_of_god: "Assembleia de Deus",
  adventist: "Adventista",
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function fmtDist(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace(".", ",")} km`;
}

function setMap(lat, lon, raioKm) {
  const frame = $("[data-map]");
  if (!frame) return;
  // bbox: ~raio ao redor do ponto (graus aproximados)
  const dLat = raioKm / 111;
  const dLon = raioKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((n) => n.toFixed(5)).join("%2C");
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lon}`;
  if (frame.dataset.src !== src) {
    frame.dataset.src = src;
    frame.src = src;
  }
}

function renderList(payload, origin) {
  const list = $("[data-church-list]");
  const summary = $("[data-church-summary]");
  const alertBox = $("[data-church-alert]");
  if (!list) return;

  if (alertBox) {
    if (payload.fonte === "exemplo") {
      alertBox.textContent = payload.aviso || "A busca ao vivo não respondeu. Exibindo exemplos.";
      alertBox.hidden = false;
    } else {
      alertBox.hidden = true;
    }
  }

  const igrejas = (payload.igrejas || []).map((ig) => ({
    ...ig,
    dist: origin ? haversineKm(origin.lat, origin.lon, ig.lat, ig.lon) : null,
  }));
  igrejas.sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0));

  if (summary) {
    summary.textContent = igrejas.length
      ? `${igrejas.length} igreja(s) encontrada(s)${origin ? " perto de você" : ""}.`
      : "";
  }

  if (!igrejas.length) {
    list.replaceChildren();
    return;
  }

  const frag = document.createDocumentFragment();
  for (const ig of igrejas) {
    const li = document.createElement("li");
    li.className = "church-card";
    const header = document.createElement("div");
    header.className = "church-card__header";
    const h3 = document.createElement("h3");
    h3.className = "church-card__name";
    h3.textContent = ig.nome;
    header.appendChild(h3);
    if (ig.dist != null) {
      const d = document.createElement("span");
      d.className = "church-card__distance";
      d.textContent = fmtDist(ig.dist);
      header.appendChild(d);
    }
    const metaBits = [ig.denom && DENOMS[ig.denom], ig.cidade].filter(Boolean);
    let body = "";
    li.appendChild(header);
    if (metaBits.length) {
      const tags = document.createElement("div");
      tags.className = "cluster";
      for (const bit of metaBits) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = bit;
        tags.appendChild(tag);
      }
      li.appendChild(tags);
    }
    if (ig.rua || ig.telefone || ig.horarios || ig.site) {
      const dl = document.createElement("dl");
      dl.className = "info-list";
      const add = (t, v) => {
        if (!v) return;
        const dt = document.createElement("dt");
        dt.className = "info-list__term";
        dt.textContent = t;
        const dd = document.createElement("dd");
        dd.className = "info-list__value";
        if (t === "Site" && ig.site) {
          const a = document.createElement("a");
          a.href = ig.site;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = "Visitar site";
          dd.appendChild(a);
        } else if (t === "Telefone" && ig.telefone) {
          const a = document.createElement("a");
          a.href = "tel:" + String(ig.telefone).replace(/[^\d+]/g, "");
          a.textContent = ig.telefone;
          dd.appendChild(a);
        } else {
          dd.textContent = v;
        }
        dl.append(dt, dd);
      };
      add("Endereço", [ig.rua, ig.cidade].filter(Boolean).join(" — "));
      add("Horários", ig.horarios);
      add("Telefone", ig.telefone);
      add("Site", ig.site);
      li.appendChild(dl);
    }
    const actions = document.createElement("div");
    actions.className = "church-card__actions";
    const maps = document.createElement("a");
    maps.className = "button button--secondary button--small";
    maps.target = "_blank";
    maps.rel = "noopener noreferrer";
    maps.href = `https://www.openstreetmap.org/?mlat=${ig.lat}&mlon=${ig.lon}#map=17/${ig.lat}/${ig.lon}`;
    maps.textContent = "Ver no mapa";
    actions.appendChild(maps);
    li.appendChild(actions);
    frag.appendChild(li);
  }
  list.replaceChildren(frag);
}

function showError(msg) {
  const box = $("[data-church-error]");
  if (!box) return;
  box.textContent = msg;
  box.hidden = false;
}

async function search({ lat, lon, rotulo }) {
  const list = $("[data-church-list]");
  const summary = $("[data-church-summary]");
  const alertBox = $("[data-church-alert]");
  const errBox = $("[data-church-error]");
  if (errBox) errBox.hidden = true;
  if (alertBox) alertBox.hidden = true;
  if (summary) summary.textContent = "Procurando igrejas…";
  if (list) {
    list.replaceChildren();
    for (let i = 0; i < 3; i++) {
      const s = document.createElement("li");
      s.innerHTML = '<span class="skeleton skeleton--block"></span>';
      list.appendChild(s);
    }
  }
  const found = $("[data-found-location]");
  if (found) found.textContent = rotulo || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

  setMap(lat, lon, 5);
  try {
    const r = await fetch(`/api/igrejas?lat=${lat}&lon=${lon}&raio=5`);
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.erro || "Falha na busca");
    renderList(data, { lat, lon });
    rememberLocation({ lat, lon, rotulo });
  } catch (e) {
    if (list) list.replaceChildren();
    if (summary) summary.textContent = "";
    showError(e.message || "Não foi possível buscar agora.");
  }
}

function rememberLocation(loc) {
  try {
    sessionStorage.setItem("caminho:local", JSON.stringify(loc));
  } catch {
    /* opcional */
  }
}

function restoreLocation() {
  try {
    const raw = sessionStorage.getItem("caminho:local");
    if (!raw) return null;
    const loc = JSON.parse(raw);
    if (Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) return loc;
  } catch {
    /* opcional */
  }
  return null;
}

/* ------------------------------------------------------------------ */
function init() {
  const form = $("[data-church-form]");
  const input = $("[data-church-query]");
  const geoBtn = $("[data-church-geo]");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = (input?.value || "").trim();
    if (q.length < 2) {
      showError("Digite um bairro, cidade ou CEP.");
      return;
    }
    try {
      const r = await fetch(`/api/localizar?q=${encodeURIComponent(q)}`);
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.erro || "Local não encontrado.");
      await search(data);
    } catch (err) {
      showError(err.message || "Não foi possível localizar esse lugar.");
    }
  });

  geoBtn?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      showError("Seu navegador não oferece localização. Busque pelo nome do bairro ou cidade.");
      return;
    }
    geoBtn.disabled = true;
    const old = geoBtn.textContent;
    geoBtn.textContent = "Localizando…";
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        geoBtn.disabled = false;
        geoBtn.textContent = old;
        await search({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          rotulo: "Sua localização atual",
        });
      },
      () => {
        geoBtn.disabled = false;
        geoBtn.textContent = old;
        showError("Não foi possível obter sua localização. Busque pelo nome do lugar.");
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
    );
  });

  const saved = restoreLocation();
  if (saved) search(saved);
}

init();
