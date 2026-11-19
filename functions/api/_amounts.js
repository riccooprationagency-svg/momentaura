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
 * An order that used a promo code adds one more key, promoCode, a string. An order
 * without a code has none. The discount is NEVER among them, whatever the stored
 * order holds: see the end of amounts().
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

  /* The code, as the order recorded it — never looked up again. Present only on
   * an order that used one, so an order without one answers with exactly the keys
   * it always did.
   *
   * THE DISCOUNT IS NOT SENT. Orders stored before this change carry promoPercent,
   * discountKsh and itemsSubtotal, and orders stored after it carry discountKsh and
   * promoAmountOff for accounting. This function builds `out` by naming the keys it
   * copies, so none of those can reach a browser; there is deliberately no
   * allow-by-default spread of the record here. */
  if (typeof record.promoCode === "string" && record.promoCode) out.promoCode = record.promoCode;
  return out;
}
