/* What an order cost, AS IT WAS RECORDED.
 *
 * Read off the stored order, never recomputed from today's catalogue or fee
 * table, because a buyer looking at an order is checking what they were asked
 * to pay, not what the same basket would cost now. A fee changed in site.json
 * after the order was placed must not reach a screen that describes that order.
 *
 * Two readers: /api/track, which adds county and area for a buyer recognising
 * their own order, and /api/mpesa/status, which /order-received polls and which
 * sends these and nothing else. One copy, so the confirmation and the lookup
 * cannot disagree about what one order cost.
 *
 * The three amounts are already formatted, so the page puts each value straight
 * into its slot with textContent and the cart carries no formatting for it. A key
 * that is absent hides its line, which is how an order placed before delivery
 * fees existed shows a total and nothing it does not have.
 *
 * An order that used a promo code adds four more keys, promoCode, promoPercent,
 * discountKsh and itemsSubtotal, and those four are NOT formatted: the code is a
 * string and the rest are raw integers. An order without a code has none of them.
 */

/* Matches price() in src/lib/products.ts and money() in the cart: integer KSh,
 * en-KE grouping. A third copy, because this side of the wire cannot import
 * either; the format is one line and the comment is the link between them. */
const money = (value) => `KSh ${value.toLocaleString("en-KE")}`;

export function amounts(record) {
  const out = {};
  const fee = record.delivery && record.delivery.fee;
  if (Number.isInteger(fee)) out.fee = fee === 0 ? "Free" : money(fee);
  if (Number.isInteger(record.subtotal)) out.subtotal = money(record.subtotal);
  if (Number.isInteger(record.amount)) out.total = money(record.amount);

  /* The promo, as the order recorded it — never looked up again. A code edited
   * or deleted after the order was placed must not rewrite what that order was
   * charged. Present only on an order that used a code, so an order without one
   * answers with exactly the keys it always did.
   *
   * RAW INTEGERS, unlike the three above, because the names carry the unit
   * (promoPercent, discountKsh, itemsSubtotal) and the cart script has no byte
   * budget to format them. Whatever shows them formats them. */
  if (typeof record.promoCode === "string" && record.promoCode) {
    out.promoCode = record.promoCode;
    if (Number.isInteger(record.promoPercent)) out.promoPercent = record.promoPercent;
    if (Number.isInteger(record.discountKsh)) out.discountKsh = record.discountKsh;
    if (Number.isInteger(record.itemsSubtotal)) out.itemsSubtotal = record.itemsSubtotal;
  }
  return out;
}
