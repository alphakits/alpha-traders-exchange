import "server-only";
import { prepareMarketplaceEmailOutbox } from "@/lib/marketplace-email-outbox";
import { prepareTradeEventEmails } from "@/lib/marketplace-email-events";
import type { PurchaseRequest } from "@/types/alpha-exchange";

/** Recovers the commit → after() gap. Only receipts from this feature create notices;
 * viewing or reconciling old trade history must never trigger a customer email. */
export async function recoverTradeReceiptEmails() {
  const pool = await prepareMarketplaceEmailOutbox();
  const result = await pool.query<{ payload: PurchaseRequest }>(`
    select trade.payload from alpha_exchange.purchase_requests trade
    where trade.status in ('completed','review_open','locked')
      and trade.payload->'completionReceipt'->>'version' = '1'
      and trade.payload->'completionReceipt'->>'source' = 'completion'
      and exists (
        select 1 from alpha_exchange.users account
        where account.id in (trade.buyer_id, trade.seller_id)
          and coalesce(account.payload->>'disabled','false') <> 'true'
          and account.email is not null and account.email <> ''
          and not exists (
            select 1 from alpha_exchange.marketplace_email_outbox job
            where job.idempotency_key = 'trade-lifecycle:' || trade.id || ':trade_completed:' || account.id
          )
      )
    order by trade.payload->'completionReceipt'->>'completedAt', trade.id limit 25
  `);
  let failed = false;
  for (const { payload } of result.rows) {
    try {
      const deliver = await prepareTradeEventEmails({ event: "trade_completed", request: payload });
      const outcomes = await deliver();
      if (outcomes.some(outcome => !outcome.ok)) failed = true;
    } catch { failed = true; }
  }
  if (failed) throw new Error("Trade receipt email preparation failed.");
  return { recoveredTrades: result.rows.length };
}
