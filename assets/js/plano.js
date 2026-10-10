/**
 * Caminho — plano de leitura do Evangelho (Mateus em 28 dias).
 * O progresso fica só no navegador (localStorage).
 */
"use strict";

import { store } from "./site.js";

const TOTAL = 28;
const KEY = "caminho:plano:mateus28";

function init() {
  const root = document.querySelector("[data-plan]");
  if (!root) return;

  const daysEl = root.querySelector("[data-plan-days]");
  const bar = root.querySelector("[data-plan-progress]");
  const label = root.querySelector("[data-plan-label]");
  const resetBtn = root.querySelector("[data-plan-reset]");
  let done = new Set(store.get(KEY, []));

  const paint = () => {
    if (!daysEl) return;
    const frag = document.createDocumentFragment();
    let firstPending = -1;
    for (let i = 1; i <= TOTAL; i++) {
      if (!done.has(i) && firstPending < 0) firstPending = i;
    }
    for (let i = 1; i <= TOTAL; i++) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "reading-plan__day";
      a.href = `/biblia#mt/${i}`;
      a.textContent = String(i);
      a.title = `Mateus ${i}`;
      if (done.has(i)) a.classList.add("is-done");
      else if (i === firstPending) a.classList.add("is-today");
      a.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        // 1º clique marca como lido; clique no dia já marcado, apenas navega
        if (!done.has(i)) {
          e.preventDefault();
          done.add(i);
          store.set(KEY, [...done]);
          paint();
          setTimeout(() => {
            location.hash = `mt/${i}`;
          }, 60);
        }
      });
      li.appendChild(a);
      frag.appendChild(li);
    }
    daysEl.replaceChildren(frag);

    const pct = Math.round((done.size / TOTAL) * 100);
    if (bar) bar.style.setProperty("--progress", `${pct}%`);
    if (label) {
      label.textContent =
        done.size === 0
          ? `Comece pelo dia 1 — ${TOTAL} dias, um capítulo por dia.`
          : done.size === TOTAL
            ? "Plano concluído. Que tal começar de novo com mais atenção?"
            : `${done.size} de ${TOTAL} dias concluídos${pct ? ` (${pct}%)` : ""}.`;
    }
  };

  resetBtn?.addEventListener("click", () => {
    done = new Set();
    store.set(KEY, []);
    paint();
  });

  paint();
}

init();
