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
import { paidIndexKey, putPending, refKey } from "../api/_pending.js";

const PAGE_SIZE = 20;
const TTL_SECONDS = 60 * 60 * 24 * 7;

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

const backfilledKvs = new Set();

export function _resetBackfillCache() {
  backfilledKvs.clear();
}

/**
 * Backfills existing paid orders from ref: keys into the paid-at: time-ordered index.
 *
 * Orders placed before the introduction of paid-at: index only have ref:<ref> keys.
 * To ensure these orders remain visible alongside newly paid orders throughout the
 * seven-day transition window, this scans existing ref: keys once and creates any missing
 * paid-at:<invertedTimestamp>:<ref> index keys.
 *
 * EXPIRY PRESERVATION:
 * To avoid extending existing entries or creating orphaned index entries that outlive
 * their source records and pollute pagination with phantom/empty slots:
 * 1. If an index entry already exists for a record, it is never overwritten or extended.
 * 2. Each new index entry inherits the exact expiration timestamp of its source ref:
 *    record (or its remaining lifetime based on creation/settlement time).
 * 3. Expired or near-expiry (<60s remaining) records are skipped.
 */
export async function ensurePaidIndex(env) {
  const kv = env.ORDERS;
  if (!kv) return;

  if (backfilledKvs.has(kv)) return;

  try {
    const marker = await kv.get("meta:paid-index-backfilled");
    if (marker) {
      backfilledKvs.add(kv);
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    let cursor = undefined;
    while (true) {
      const res = await kv.list({ prefix: "ref:", cursor, limit: 100 });
      if (Array.isArray(res?.keys)) {
        for (const k of res.keys) {
          try {
            const record = await kv.get(k.name, "json");
            if (record && record.status === "paid" && typeof record.reference === "string" && record.reference) {
              const indexKey = paidIndexKey(record.createdAt || record.settledAt, record.reference);

              // Avoid extending existing index entries
              const existing = await kv.get(indexKey);
              if (existing !== null) continue;

              // Preserve source record's expiry
              const sourceExp = Number.isFinite(k.expiration) ? k.expiration : undefined;
              const recordTime = record.settledAt || record.createdAt;
              const fallbackExp =
                Number.isFinite(recordTime) && recordTime >= 1_000_000_000_000
                  ? Math.floor(recordTime / 1000) + TTL_SECONDS
                  : nowSec + TTL_SECONDS;
              const expiration = sourceExp ?? fallbackExp;

              // Skip if already expired or within 60s of expiring (Cloudflare KV limit)
              if (expiration <= nowSec + 60) continue;

              await kv.put(indexKey, JSON.stringify(record.reference), { expiration });
            }
          } catch {
            // Individual key read/write failure does not abort migration
          }
        }
      }
      if (!res || res.list_complete || !res.cursor) break;
      cursor = res.cursor;
    }

    await kv.put("meta:paid-index-backfilled", "1");
    backfilledKvs.add(kv);
  } catch {
    // Failure in backfill should not crash the orders page
  }
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

  /* Fill the time-ordered index with any paid orders that predate paid-at: */
  await ensurePaidIndex(env);

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const prevParam = url.searchParams.get("prev") || "";
  const prevStack = prevParam ? prevParam.split(";").filter(Boolean) : [];

  let listRes;
  try {
    listRes = await kv.list({ prefix: "paid-at:", limit: PAGE_SIZE, cursor });
  } catch {
    return new Response(
      "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Service Unavailable</title></head><body><p>Service Unavailable</p></body></html>",
      { status: 503, headers: HEADERS }
    );
  }

  const records = [];
  if (Array.isArray(listRes?.keys)) {
    for (const k of listRes.keys) {
      const ref = k.name.replace(/^paid-at:\d+:/, "");
      if (!ref) continue;
      try {
        const record = await kv.get(refKey(ref), "json");
        if (record && record.status === "paid") {
          records.push(record);
        }
      } catch {
        // Individual key read failure does not abort other orders
      }
    }
  }

  const hasNextPage = Boolean(listRes && !listRes.list_complete && listRes.cursor);
  const nextCursor = hasNextPage ? listRes.cursor : null;
  const hasPrevPage = Boolean(cursor);

  const ordersHtml =
    records.length > 0
      ? records.map(renderOrder).join("\n")
      : '<p class="empty">No paid orders.</p>';

  let paginationHtml = "";
  if (hasNextPage || hasPrevPage) {
    let prevLink = "<span></span>";
    if (hasPrevPage) {
      let prevHref = "/admin/orders";
      if (prevStack.length > 1) {
        const targetCursor = prevStack[prevStack.length - 1];
        const targetPrev = prevStack.slice(0, -1).join(";");
        prevHref = `/admin/orders?cursor=${encodeURIComponent(targetCursor)}${targetPrev ? `&prev=${encodeURIComponent(targetPrev)}` : ""}`;
      } else if (prevStack.length === 1) {
        const targetCursor = prevStack[0];
        prevHref = targetCursor ? `/admin/orders?cursor=${encodeURIComponent(targetCursor)}` : "/admin/orders";
      }
      prevLink = `<a class="pagination-link" href="${prevHref}">PREVIOUS PAGE</a>`;
    }

    let nextLink = "<span></span>";
    if (hasNextPage) {
      const updatedPrev = cursor ? (prevParam ? `${prevParam};${cursor}` : cursor) : "";
      const nextHref = `/admin/orders?cursor=${encodeURIComponent(nextCursor)}${updatedPrev ? `&prev=${encodeURIComponent(updatedPrev)}` : ""}`;
      nextLink = `<a class="pagination-link" href="${nextHref}">NEXT PAGE</a>`;
    }

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
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .order {
      border: 0.0625rem solid GrayText;
      padding: 1rem;
      margin-block-end: 1rem;
      overflow-wrap: anywhere;
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
      font-weight: 500;
      font-size: 1.125rem;
      overflow-wrap: anywhere;
    }
    .order-time {
      font-size: 0.875rem;
      color: GrayText;
    }
    .order-items {
      margin: 0.5rem 0;
      padding-inline-start: 1.25rem;
      overflow-wrap: anywhere;
    }
    .order-items li {
      margin-block: 0.25rem;
    }
    .order-buyer {
      margin-block: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      overflow-wrap: anywhere;
    }
    .order-name {
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    .contact-link {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      min-height: 2.75rem;
      min-width: 2.75rem;
      max-width: 100%;
      color: LinkText;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .contact-link:visited {
      color: VisitedText;
    }
    .order-delivery {
      color: CanvasText;
      overflow-wrap: anywhere;
    }
    .order-total {
      font-weight: 500;
      font-size: 1.125rem;
      margin-block-start: 0.5rem;
    }
    .order-promo {
      font-size: 0.875rem;
      color: GrayText;
      margin-block-start: 0.25rem;
      overflow-wrap: anywhere;
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
      text-transform: uppercase;
      letter-spacing: 0.08em;
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
    <h1>ORDERS</h1>
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
