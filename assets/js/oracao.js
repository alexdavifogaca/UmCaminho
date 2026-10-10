/**
 * Caminho — formulário de pedido de oração.
 * Validação no cliente, envio JSON ao servidor, honeypot preenchido
 * silenciosamente por robôs. Nenhum dado é guardado no navegador.
 */
"use strict";

const form = document.querySelector("[data-oracao-form]");
if (form) {
  const marca = form.querySelector('[name="marca"]');
  if (marca) marca.value = String(Date.now());

  const showError = (name, msg) => {
    const field = form.querySelector(`[name="${name}"]`);
    const box = form.querySelector(`[data-error-for="${name}"]`);
    if (field) field.setAttribute("aria-invalid", msg ? "true" : "false");
    if (box) box.textContent = msg || "";
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = form.querySelector("[data-form-status]");
    const submit = form.querySelector('[type="submit"]');

    for (const name of ["nome", "email", "pedido"]) showError(name, "");
    if (status) {
      status.hidden = true;
      status.className = "alert";
    }

    const fd = new FormData(form);
    const payload = {
      nome: fd.get("nome") || "",
      email: fd.get("email") || "",
      categoria: fd.get("categoria") || "",
      pedido: fd.get("pedido") || "",
      site: fd.get("site") || "", // honeypot
      marca: fd.get("marca") || "",
    };

    // Validação leve no cliente (o servidor valida de novo)
    if (String(payload.pedido).trim().length < 10) {
      showError("pedido", "Conte um pouco mais sobre o pedido (mínimo de 10 caracteres).");
      return;
    }
    if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(payload.email))) {
      showError("email", "E-mail inválido.");
      return;
    }

    if (submit) submit.disabled = true;
    try {
      const r = await fetch("/api/oracao", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "caminho",
        },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 201 && data.ok) {
        form.hidden = true;
        const ok = document.querySelector("[data-form-success]");
        if (ok) {
          ok.hidden = false;
          ok.focus?.();
        }
        return;
      }
      if (r.status === 422 && data.campos) {
        for (const [name, msg] of Object.entries(data.campos)) showError(name, msg);
        if (status) {
          status.textContent = "Revise os campos destacados.";
          status.classList.add("alert--error");
          status.hidden = false;
        }
        return;
      }
      throw new Error(data.erro || "Falha no envio");
    } catch {
      if (status) {
        status.textContent = "Não foi possível enviar agora. Tente novamente em instantes.";
        status.classList.add("alert--error");
        status.hidden = false;
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}
