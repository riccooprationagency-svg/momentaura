/* Alerting the shop owner when an order is paid.
 *
 * OWNER DECISION (Ric, 20 Nov 2026): Telegram first, email second, WhatsApp later.
 * WhatsApp is out of scope and not stubbed here.
 *
 * NEVER BREAK THE MONEY PATH:
 *   - An alert failure, a timeout, a missing secret, or an API error must not
 *     change what settle() returns, must not delay the callback acknowledgement
 *     to Safaricom, and must not throw.
 *   - Run with waitUntil (when available in handler context).
 *   - Catch everything and log one line with reference and failure code, never
 *     the buyer's details and never the bot token or secrets.
 *
 * DUPLICATE BEATS MISSING:
 *   KV has no compare-and-set, so two concurrent settles (e.g. callback and
 *   status poll) can both observe "pending". A duplicate alert in that rare
 *   race is acceptable; a lost alert is not.
 *
 * NO MARKUP INJECTION:
 *   Buyer-supplied text is sent as plain text. Telegram omits parse_mode;
 *   email sends a `text` body, not HTML. All buyer-supplied fields are truncated
 *   to sane lengths (name 80, area 80, landmark 120) so Telegram limits (4096)
 *   cannot be exceeded.
 *
 * ENVIRONMENT:
 *   Alerts fire only in the production environment. Preview deployments must
 *   not alert.
 */

import { nameForSlug } from "./_order.js";

const MAX_NAME = 80;
const MAX_AREA = 80;
const MAX_LANDMARK = 120;

export function formatEastAfricaTime(timestamp) {
  const d = new Date(timestamp);
  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Nairobi",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d) + " EAT"
  );
}

export function formatAlertMessage(record) {
  const ref = record.reference || "";
  const total = `KSh ${Number(record.amount || 0).toLocaleString("en-KE")}`;

  const items = Array.isArray(record.items) ? record.items : [];
  const itemLines = items.map((item) => {
    const name = nameForSlug(item.slug);
    const sizePart = item.size ? ` (${item.size})` : "";
    return `${item.qty}x ${name}${sizePart}`;
  });

  const name = typeof record.name === "string" ? record.name.trim().slice(0, MAX_NAME) : "";
  const phone = typeof record.msisdn === "string" ? record.msisdn : "";

  const d = record.delivery || {};
  const county = d.label || d.county || "";
  const area = typeof d.area === "string" ? d.area.trim().slice(0, MAX_AREA) : "";
  const landmark = typeof d.landmark === "string" ? d.landmark.trim().slice(0, MAX_LANDMARK) : "";
  const delivery = [county, area, landmark].filter(Boolean).join(", ");

  const lines = [
    ref,
    total,
    ...itemLines,
    name,
    phone,
    delivery,
  ];

  /* The promo code only, never the amount off. */
  if (typeof record.promoCode === "string" && record.promoCode) {
    lines.push(`Promo: ${record.promoCode}`);
  }

  const time = formatEastAfricaTime(record.createdAt || record.settledAt || Date.now());
  lines.push(time);

  return lines.join("\n");
}

export function isProduction(env) {
  /* Cloudflare Pages sets CF_PAGES_ENVIRONMENT to 'production' on production deployments
   * and 'preview' on preview deployments. CF_PAGES_BRANCH is also 'main' for production. */
  if (env.CF_PAGES_ENVIRONMENT) {
    return env.CF_PAGES_ENVIRONMENT === "production";
  }
  if (env.CF_PAGES_BRANCH) {
    return env.CF_PAGES_BRANCH === "main";
  }
  return env.ENVIRONMENT === "production" || env.ALERT_ENVIRONMENT === "production";
}

async function sendTelegram(env, reference, text) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      console.log(JSON.stringify({ at: "alert", reference, channel: "telegram", code: "http_error", status: res.status }));
    }
  } catch {
    /* Log without error message to avoid ever leaking bot token or URL */
    console.log(JSON.stringify({ at: "alert", reference, channel: "telegram", code: "network_error" }));
  }
}

async function sendEmail(env, reference, text) {
  const apiKey = env.ALERT_EMAIL_API_KEY;
  const from = env.ALERT_EMAIL_FROM;
  const to = env.ALERT_EMAIL_TO;
  if (!apiKey || !from || !to) return;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "MomentAura/1.0",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Order ${reference} paid`,
        text,
      }),
    });
    if (!res.ok) {
      console.log(JSON.stringify({ at: "alert", reference, channel: "email", code: "http_error", status: res.status }));
    }
  } catch {
    console.log(JSON.stringify({ at: "alert", reference, channel: "email", code: "network_error" }));
  }
}

export async function sendAlerts(env, record) {
  try {
    if (!isProduction(env)) return;

    const message = formatAlertMessage(record);
    const ref = record.reference || "";

    await Promise.allSettled([
      sendTelegram(env, ref, message),
      sendEmail(env, ref, message),
    ]);
  } catch {
    console.log(JSON.stringify({ at: "alert", reference: record.reference, code: "alert_failed" }));
  }
}
