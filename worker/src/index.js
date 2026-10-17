// Form backend for invivion.bio.
//   POST /subscribe  { email, token }                 -> adds a Resend contact
//   POST /contact    { name, email, message, token }  -> emails CONTACT_TO
// Every request must carry a Cloudflare Turnstile token, verified server-side.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RESEND = "https://api.resend.com";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = list(env.ALLOWED_ORIGINS);
    const cors = allowed.includes(origin)
      ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        }
      : { Vary: "Origin" };
    const reply = (status, body) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...cors },
      });

    const { pathname } = new URL(request.url);
    const route = { "/subscribe": subscribe, "/contact": contact }[pathname];

    if (!route) return reply(404, { ok: false, error: "Not found." });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return reply(405, { ok: false, error: "Method not allowed." });
    if (!allowed.includes(origin)) return reply(403, { ok: false, error: "Forbidden." });

    let data;
    try {
      data = await request.json();
    } catch {
      return reply(400, { ok: false, error: "Invalid request." });
    }
    if (typeof data !== "object" || data === null) {
      return reply(400, { ok: false, error: "Invalid request." });
    }

    // Honeypot filled in: pretend it worked and do nothing.
    if (data.website) return reply(200, { ok: true });

    const email = str(data.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) return reply(400, { ok: false, error: "Please enter a valid email address." });

    const human = await verifyTurnstile(env, str(data.token, 2048), request, pathname.slice(1));
    if (!human) return reply(403, { ok: false, error: "Verification failed. Please refresh and try again." });

    try {
      return await route({ ...data, email }, env, reply);
    } catch (err) {
      console.error(pathname, err);
      return reply(502, { ok: false, error: "We couldn’t send that just now. Please try again later." });
    }
  },
};

async function subscribe(data, env, reply) {
  const body = { email: data.email, unsubscribed: false };
  if (env.RESEND_SEGMENT_ID) body.segments = [{ id: env.RESEND_SEGMENT_ID }];

  const res = await resend(env, "/contacts", body);
  // An existing contact is a success from the visitor's point of view.
  if (!res.ok && res.status !== 409 && !/already exists/i.test(res.text)) {
    throw new Error(`Resend contacts ${res.status}: ${res.text}`);
  }
  return reply(200, { ok: true });
}

async function contact(data, env, reply) {
  const name = str(data.name, 120).replace(/[\r\n]+/g, " ");
  const message = str(data.message, 5000);
  if (!name || !message) return reply(400, { ok: false, error: "Please add your name and a message." });

  const res = await resend(env, "/emails", {
    from: env.MAIL_FROM,
    to: list(env.CONTACT_TO),
    reply_to: data.email,
    subject: `invivion.bio inquiry from ${name}`,
    text: `Name: ${name}\nEmail: ${data.email}\n\n${message}\n`,
  });
  if (!res.ok) throw new Error(`Resend emails ${res.status}: ${res.text}`);
  return reply(200, { ok: true });
}

async function verifyTurnstile(env, token, request, action) {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.append("remoteip", ip);

  const res = await fetch(SITEVERIFY, { method: "POST", body: form });
  if (!res.ok) return false;
  const outcome = await res.json();
  if (!outcome.success) {
    console.warn("turnstile rejected", outcome["error-codes"]);
    return false;
  }

  // Test keys report hostname "example.com" and no action; real keys must match.
  const hostnames = list(env.TURNSTILE_HOSTNAMES);
  if (hostnames.length && !hostnames.includes(outcome.hostname)) {
    console.warn("turnstile hostname mismatch", outcome.hostname);
    return false;
  }
  if (outcome.action && outcome.action !== action) {
    console.warn("turnstile action mismatch", outcome.action, action);
    return false;
  }
  return true;
}

async function resend(env, path, body) {
  const res = await fetch(RESEND + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

function str(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function list(value) {
  return (value || "").split(",").map((s) => s.trim()).filter(Boolean);
}
