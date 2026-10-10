/**
 * Caminho — comportamento compartilhado.
 * Menu mobile, navegação ativa, ano do rodapé, versículo do dia,
 * jornada com Jesus (progresso local) e utilitários.
 */
"use strict";

/* ------------------------------------------------------------------ */
/* Menu mobile                                                         */
/* ------------------------------------------------------------------ */
function initMenu() {
  const toggle = document.querySelector("[data-menu-toggle]");
  const nav = document.querySelector("[data-nav]");
  const header = document.querySelector("[data-header]");
  if (!toggle || !nav) return;

  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
    header?.classList.toggle("is-menu-open", open);
    document.body.classList.toggle("is-scroll-locked", open);
  };
  const isOpen = () => toggle.getAttribute("aria-expanded") === "true";

  toggle.addEventListener("click", () => setOpen(!isOpen()));
  nav.addEventListener("click", (e) => {
    if (e.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) {
      setOpen(false);
      toggle.focus();
    }
  });
  window.matchMedia("(min-width: 56em)").addEventListener("change", (e) => {
    if (e.matches) setOpen(false);
  });
}

/* ------------------------------------------------------------------ */
/* Link ativo na navegação                                             */
/* ------------------------------------------------------------------ */
function initActiveNav() {
  const page = document.body.dataset.page;
  if (!page) return;
  for (const link of document.querySelectorAll(".site-nav__link[data-nav-page]")) {
    if (link.dataset.navPage === page) link.setAttribute("aria-current", "page");
  }
}

/* ------------------------------------------------------------------ */
/* Ano no rodapé                                                       */
/* ------------------------------------------------------------------ */
function initYear() {
  const el = document.querySelector("[data-year]");
  if (el) el.textContent = String(new Date().getFullYear());
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback para contextos sem clipboard assíncrono
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.style.cssText =
      "position:fixed;left:50%;bottom:calc(var(--space-5) + env(safe-area-inset-bottom,0px));" +
      "transform:translateX(-50%);z-index:80;padding:var(--space-3) var(--space-5);" +
      "background:var(--color-charcoal-2);color:var(--color-paper);border:1px solid var(--border);" +
      "border-radius:var(--radius-m);font-size:var(--text-s);max-width:min(90vw,28rem);text-align:center;" +
      "box-shadow:0 8px 24px rgb(0 0 0 / 0.4);opacity:0;transition:opacity var(--duration) var(--ease)";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(() => {
    el.style.opacity = "1";
  });
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.style.opacity = "0";
  }, 2600);
}

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* armazenamento cheio/indisponível: segue sem persistir */
    }
  },
};
export { store };

/* ------------------------------------------------------------------ */
/* Versículo do dia                                                    */
/* ------------------------------------------------------------------ */
function initVerseOfDay() {
  const roots = document.querySelectorAll("[data-verse-of-day]");
  if (!roots.length) return;

  let verses = [];
  let offset = store.get("caminho:versiculo-offset", 0);

  const dayIndex = () => {
    const start = new Date(new Date().getFullYear(), 0, 0);
    const today = new Date();
    const day = Math.floor((today - start) / 86400000);
    return (day + offset) % verses.length;
  };

  const render = () => {
    const v = verses[dayIndex()];
    for (const root of roots) {
      const text = root.querySelector("[data-verse-text]");
      const ref = root.querySelector("[data-verse-ref]");
      if (text) text.textContent = `“${v.text}”`;
      if (ref) ref.textContent = `${v.book} ${v.chapter}:${v.verse}`;
      root.dataset.ref = v.ref;
      root.dataset.full = `${v.text} — ${v.book} ${v.chapter}:${v.verse} (Almeida Revisada)`;
    }
  };

  fetch("/assets/data/versiculos.json")
    .then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    })
    .then((data) => {
      if (!Array.isArray(data) || !data.length) throw new Error();
      verses = data;
      render();
      for (const root of roots) {
        root.querySelector("[data-verse-next]")?.addEventListener("click", () => {
          offset = (offset + 1) % verses.length;
          store.set("caminho:versiculo-offset", offset);
          render();
        });
        root.querySelector("[data-verse-copy]")?.addEventListener("click", async () => {
          const ok = await copyText(root.dataset.full);
          toast(ok ? "Versículo copiado." : "Não foi possível copiar.");
        });
      }
    })
    .catch(() => {
      for (const root of roots) {
        root.querySelector("[data-verse-text]")?.replaceChildren(
          Object.assign(document.createElement("span"), {
            className: "text-muted",
            textContent: "O versículo do dia não pôde ser carregado. Recarregue a página.",
          })
        );
      }
    });
}

/* ------------------------------------------------------------------ */
/* Jornada com Jesus (progresso local)                                 */
/* ------------------------------------------------------------------ */
function initJourney() {
  for (const journey of document.querySelectorAll("[data-journey]")) {
    const key = journey.dataset.journey;
    const steps = [...journey.querySelectorAll(".journey-step")];
    const saved = new Set(store.get(key, []));

    const paint = () => {
      let currentSet = false;
      steps.forEach((step, i) => {
        const done = saved.has(i);
        const current = !done && !currentSet;
        if (current) currentSet = true;
        step.classList.toggle("is-done", done);
        step.classList.toggle("is-current", current);
        step.classList.toggle("is-pending", !done && !current);
        const status = step.querySelector(".journey-step__status");
        if (status) status.textContent = done ? "Concluída" : current ? "Etapa atual" : "Ainda pendente";
        const btn = step.querySelector("[data-step-toggle]");
        if (btn) btn.textContent = done ? "Desmarcar" : "Marcar como feita";
      });
    };

    journey.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-step-toggle]");
      if (!btn) return;
      const step = btn.closest(".journey-step");
      const i = steps.indexOf(step);
      if (i < 0) return;
      if (saved.has(i)) saved.delete(i);
      else saved.add(i);
      store.set(key, [...saved]);
      paint();
    });
    paint();
  }
}

/* ------------------------------------------------------------------ */
/* Início                                                              */
/* ------------------------------------------------------------------ */
initMenu();
initActiveNav();
initYear();
initVerseOfDay();
initJourney();
