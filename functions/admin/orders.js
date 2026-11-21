/* GET /admin/orders — read-only list of paid orders for the shop owner on a phone.
 *
 * AUTHENTICATION:
 *   - Protected by Cloudflare Access. The deployment is served on custom domain,
 *     momentaura.pages.dev and preview hostnames, so this function MUST NOT
 *     rely on edge Access rules alone. It verifies the Cf-Access-Jwt-Assertion
 *     header itself, on every request, and fails closed.
 *   - RS256 signature against the team JWKS at https://<team>.cloudflareaccess.com/cdn-cgi/access/certs
 *     via WebCrypto.
 *   - Verified claims: exp, nbf, iss, and aud.
 *   - Algorithms other than RS256 (e.g. none, HS256) are strictly rejected.
 *   - Missing ACCESS_TEAM_DOMAIN or ACCESS_AUD answers plain 503.
 *   - Missing/invalid token answers plain 401. No bypass, no debug switch.
 *   - Response headers on EVERY response:
 *       Cache-Control: no-store
 *       X-Robots-Tag: noindex, nofollow
 *       Referrer-Policy: no-referrer
 *
 * READ-ONLY & ZERO CLIENT JAVASCRIPT:
 *   - Minimal plain HTML with inline CSS. No client-side scripts.
 *   - Relative units only, system colours (color-scheme: light dark). No raw hex anywhere.
 *   - Touch targets 44px (2.75rem) minimum.
 *   - Every buyer-supplied string is HTML-escaped.
 */

import { nameForSlug } from "../api/_order.js";
import { formatEastAfricaTime } from "../api/_alert.js";

/* A hard cap of 500 records. KV orders expire after 7 days (TTL_SECONDS in
 * _pending.js), and Cloudflare Workers caps subrequests per invocation (50 on
 * free plans, 1,000 on paid). Bounding the number of keys read keeps the
 * isolate within memory and subrequest budgets, preventing runaway execution if
 * a large volume of orders arrives. */
const MAX_ORDERS_TO_READ = 500;
const PAGE_SIZE = 20;

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

let cachedJwks = null;
let jwksCachedAt = 0;
const JWKS_TTL_MS = 60 * 60 * 1000;

export function _resetJwksCache() {
  cachedJwks = null;
  jwksCachedAt = 0;
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeJson(str) {
  const bytes = base64UrlDecode(str);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function getJwksKey(teamDomain, kid) {
  const domain = teamDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const certsUrl = `https://${domain}/cdn-cgi/access/certs`;

  const now = Date.now();
  if (cachedJwks && now - jwksCachedAt < JWKS_TTL_MS) {
    const found = cachedJwks.keys?.find((k) => k.kid === kid);
    if (found) return found;
  }

  try {
    const res = await fetch(certsUrl);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.keys)) return null;

    cachedJwks = data;
    jwksCachedAt = Date.now();

    return cachedJwks.keys.find((k) => k.kid === kid) || null;
  } catch {
    return null;
  }
}

export async function verifyAccessJwt(assertion, teamDomain, expectedAud) {
  if (typeof assertion !== "string") return false;
  const parts = assertion.split(".");
  if (parts.length !== 3) return false;

  let header;
  try {
    header = base64UrlDecodeJson(parts[0]);
  } catch {
    return false;
  }

  /* Refuse anything but RS256. Read algorithm from our own code, never honour alg: none or HS256. */
  if (header?.alg !== "RS256" || typeof header?.kid !== "string" || !header.kid) {
    return false;
  }

  const jwk = await getJwksKey(teamDomain, header.kid);
  if (!jwk || jwk.kty !== "RSA") return false;

  let cryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  } catch {
    return false;
  }

  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let signature;
  try {
    signature = base64UrlDecode(parts[2]);
  } catch {
    return false;
  }

  let validSig = false;
  try {
    validSig = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, data);
  } catch {
    return false;
  }
  if (!validSig) return false;

  let payload;
  try {
    payload = base64UrlDecodeJson(parts[1]);
  } catch {
    return false;
  }

  /* Check aud */
  const audMatches = Array.isArray(payload?.aud)
    ? payload.aud.includes(expectedAud)
    : payload?.aud === expectedAud;
  if (!audMatches) return false;

  /* Check iss */
  const cleanDomain = teamDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const expectedIss = `https://${cleanDomain}`;
  if (payload?.iss !== expectedIss) return false;

  /* Check exp and nbf */
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload?.exp !== "number" || nowSec >= payload.exp) return false;
  if (typeof payload?.nbf === "number" && nowSec < payload.nbf) return false;

  return true;
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderOrder(order) {
  const ref = escapeHtml(order.reference || "");
  const time = escapeHtml(formatEastAfricaTime(order.createdAt || order.settledAt || Date.now()));
  const total = `KSh ${Number(order.amount || 0).toLocaleString("en-KE")}`;

  const items = Array.isArray(order.items) ? order.items : [];
  const linesHtml = items
    .map((item) => {
      const name = escapeHtml(nameForSlug(item.slug));
      const sizePart = item.size ? ` (${escapeHtml(item.size)})` : "";
      return `<li>${escapeHtml(item.qty)} &times; ${name}${sizePart}</li>`;
    })
    .join("");

  const name = typeof order.name === "string" ? escapeHtml(order.name.trim()) : "";
  const phone = typeof order.msisdn === "string" ? escapeHtml(order.msisdn) : "";
  const email = typeof order.email === "string" && order.email ? escapeHtml(order.email.trim()) : null;

  const d = order.delivery || {};
  const county = d.label || d.county ? escapeHtml(d.label || d.county) : "";
  const area = typeof d.area === "string" && d.area ? escapeHtml(d.area.trim()) : "";
  const landmark = typeof d.landmark === "string" && d.landmark ? escapeHtml(d.landmark.trim()) : "";
  const deliveryParts = [county, area, landmark].filter(Boolean).join(", ");

  const promoHtml =
    typeof order.promoCode === "string" && order.promoCode
      ? `<div class="order-promo">Promo: ${escapeHtml(order.promoCode)}</div>`
      : "";

  const emailHtml = email
    ? `<div><a class="contact-link" href="mailto:${email}">${email}</a></div>`
    : "";

  return `
    <article class="order">
      <header class="order-header">
        <span class="order-ref">${ref}</span>
        <time class="order-time">${time}</time>
      </header>
      <ul class="order-items">
        ${linesHtml}
      </ul>
      <div class="order-buyer">
        <div class="order-name">${name}</div>
        <div><a class="contact-link" href="tel:${phone}">${phone}</a></div>
        ${emailHtml}
        ${deliveryParts ? `<div class="order-delivery">${deliveryParts}</div>` : ""}
      </div>
      <div class="order-total">${total}</div>
      ${promoHtml}
    </article>
  `;
}

export async function onRequest(context) {
  const { request, env } = context;

  /* Authenticate: ACCESS_TEAM_DOMAIN and ACCESS_AUD must be set */
  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;

  if (!teamDomain || !aud) {
    return new Response(
      "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Service Unavailable</title></head><body><p>Service Unavailable</p></body></html>",
      { status: 503, headers: HEADERS }
    );
  }

  const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!assertion) {
    return new Response(
      "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Unauthorized</title></head><body><p>Unauthorized</p></body></html>",
      { status: 401, headers: HEADERS }
    );
  }

  const authenticated = await verifyAccessJwt(assertion, teamDomain, aud);
  if (!authenticated) {
    return new Response(
      "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Unauthorized</title></head><body><p>Unauthorized</p></body></html>",
      { status: 401, headers: HEADERS }
    );
  }

  const kv = env.ORDERS;
  if (!kv) {
    return new Response(
      "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Service Unavailable</title></head><body><p>Service Unavailable</p></body></html>",
      { status: 503, headers: HEADERS }
    );
  }

  /* List ref: keys up to MAX_ORDERS_TO_READ */
  const keys = [];
  let cursor = undefined;
  while (keys.length < MAX_ORDERS_TO_READ) {
    const limit = Math.min(1000, MAX_ORDERS_TO_READ - keys.length);
    let res;
    try {
      res = await kv.list({ prefix: "ref:", cursor, limit });
    } catch {
      return new Response(
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Service Unavailable</title></head><body><p>Service Unavailable</p></body></html>",
        { status: 503, headers: HEADERS }
      );
    }
    if (Array.isArray(res?.keys)) {
      for (const k of res.keys) {
        keys.push(k.name);
        if (keys.length >= MAX_ORDERS_TO_READ) break;
      }
    }
    if (!res || res.list_complete || !res.cursor) break;
    cursor = res.cursor;
  }

  const records = [];
  for (const key of keys) {
    try {
      const record = await kv.get(key, "json");
      if (record && record.status === "paid") {
        records.push(record);
      }
    } catch {
      // Individual key read failure does not abort other orders
    }
  }

  /* Newest first */
  records.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const url = new URL(request.url);
  const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const start = (page - 1) * PAGE_SIZE;
  const pageRecords = records.slice(start, start + PAGE_SIZE);
  const hasNextPage = start + PAGE_SIZE < records.length;

  const ordersHtml =
    pageRecords.length > 0
      ? pageRecords.map(renderOrder).join("\n")
      : '<p class="empty">No paid orders.</p>';

  let paginationHtml = "";
  if (hasNextPage || page > 1) {
    const prevLink =
      page > 1
        ? `<a class="pagination-link" href="/admin/orders?page=${page - 1}">Previous page</a>`
        : "<span></span>";
    const nextLink = hasNextPage
      ? `<a class="pagination-link" href="/admin/orders?page=${page + 1}">Next page</a>`
      : "<span></span>";
    paginationHtml = `<nav class="pagination">${prevLink}${nextLink}</nav>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Orders — MomentAura</title>
  <style>
    :root {
      color-scheme: light dark;
    }
    body {
      margin: 0;
      padding: 1rem;
      font-family: system-ui, -apple-system, sans-serif;
      line-height: 1.5;
      background-color: Canvas;
      color: CanvasText;
    }
    .wrap {
      max-width: 38rem;
      margin-inline: auto;
    }
    h1 {
      font-size: 1.5rem;
      margin-block: 0 1.25rem;
    }
    .order {
      border: 0.0625rem solid GrayText;
      padding: 1rem;
      margin-block-end: 1rem;
    }
    .order-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-block-end: 0.75rem;
    }
    .order-ref {
      font-family: monospace;
      font-weight: 600;
      font-size: 1.125rem;
    }
    .order-time {
      font-size: 0.875rem;
      color: GrayText;
    }
    .order-items {
      margin: 0.5rem 0;
      padding-inline-start: 1.25rem;
    }
    .order-items li {
      margin-block: 0.25rem;
    }
    .order-buyer {
      margin-block: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .order-name {
      font-weight: 500;
    }
    .contact-link {
      display: inline-flex;
      align-items: center;
      min-height: 2.75rem;
      min-width: 2.75rem;
      color: LinkText;
    }
    .contact-link:visited {
      color: VisitedText;
    }
    .order-delivery {
      color: CanvasText;
    }
    .order-total {
      font-weight: 600;
      font-size: 1.125rem;
      margin-block-start: 0.5rem;
    }
    .order-promo {
      font-size: 0.875rem;
      color: GrayText;
      margin-block-start: 0.25rem;
    }
    .pagination {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-block-start: 1.5rem;
    }
    .pagination-link {
      display: inline-flex;
      align-items: center;
      min-height: 2.75rem;
      min-width: 2.75rem;
      padding: 0.5rem 1rem;
      color: LinkText;
      text-decoration: underline;
    }
    .pagination-link:visited {
      color: VisitedText;
    }
    .empty {
      color: GrayText;
      padding-block: 2rem;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Orders</h1>
    ${ordersHtml}
    ${paginationHtml}
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: HEADERS,
  });
}
