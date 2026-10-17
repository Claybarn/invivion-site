(() => {
  const config = window.INVIVION || {};
  const widgets = new Map(); // form -> turnstile widget id
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  document.getElementById("year").textContent = new Date().getFullYear();

  // Turnstile's script calls this once it has loaded (render=explicit).
  window.onTurnstileLoad = () => {
    document.querySelectorAll("form[data-endpoint]").forEach((form) => {
      const el = form.querySelector(".turnstile");
      const id = window.turnstile.render(el, {
        sitekey: config.turnstileSiteKey,
        theme: "light",
        appearance: "interaction-only",
        action: form.dataset.endpoint.slice(1),
      });
      widgets.set(form, id);
    });
  };

  function setStatus(form, message, kind) {
    const el = form.querySelector(".status");
    el.textContent = message;
    el.classList.toggle("is-ok", kind === "ok");
    el.classList.toggle("is-err", kind === "err");
  }

  async function submit(form) {
    const data = Object.fromEntries(new FormData(form));
    const button = form.querySelector("button[type=submit]");

    if (!EMAIL_RE.test(data.email || "")) {
      return setStatus(form, "Please enter a valid email address.", "err");
    }
    if (form.dataset.endpoint === "/contact" && (!data.name?.trim() || !data.message?.trim())) {
      return setStatus(form, "Please add your name and a message.", "err");
    }

    const widgetId = widgets.get(form);
    const token = window.turnstile && widgetId !== undefined
      ? window.turnstile.getResponse(widgetId)
      : "";
    if (!token) {
      return setStatus(form, "Verifying you’re human… try again in a moment.", "err");
    }

    button.disabled = true;
    setStatus(form, "Sending…");
    try {
      const res = await fetch(config.api + form.dataset.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) throw new Error(body.error || "Something went wrong.");
      form.reset();
      setStatus(form, form.dataset.endpoint === "/subscribe"
        ? "Thanks. We’ll be in touch as we make progress."
        : "Thanks for reaching out. We’ll reply soon.", "ok");
    } catch (err) {
      setStatus(form, err.message || "Something went wrong. Please try again.", "err");
    } finally {
      button.disabled = false;
      if (window.turnstile && widgetId !== undefined) window.turnstile.reset(widgetId);
    }
  }

  document.querySelectorAll("form[data-endpoint]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit(form);
    });
  });
})();
