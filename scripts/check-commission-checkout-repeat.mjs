import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommissionCheckoutWorkflow } from '../src/lib/commission-checkout-workflow.ts';

const start = Date.parse('2026-10-11T12:00:00Z');
function setup() {
  let clock = start, calls = 0;
  let db = { users: ['seller', 'other'].map(id => ({ id, role: 'approved_seller', sellerStatus: 'approved_seller' })),
    commissionRecords: [], auditLogs: [], notifications: [] };
  const api = createCommissionCheckoutWorkflow({
    read: async () => structuredClone(db), now: () => clock, random: () => 668,
    atomic: async fn => { const next = structuredClone(db); const result = fn(next); db = next; return result; },
    destination: () => 'canonical', verify: async () => { calls++; return { verified: true }; },
  });
  async function issue(n, sellerId = 'seller') {
    clock = start + n * 10_000;
    db.commissionRecords.push({ id: `cm${n}`, sellerId, commissionAmount: 3.54, rate: .01,
      paymentStatus: 'pending', createdAt: new Date(clock - 1000).toISOString(),
      paymentExpectedAmount: 3.54 + (n + 1) / 1e6, paymentExpectedAmountMode: 'unique_v1' });
    return api.issue({ sellerId, network: 'BEP20', desiredAmount: '3.54' });
  }
  async function pay(n, deposits) {
    clock = start + n * 10_000 + 2000;
    return api.reconcile({ deposits, deadline: clock + 55_000, limit: 10 });
  }
  const receipt = n => ({ signature: `0x${String(n + 1).repeat(64)}`, network: 'BEP20',
    amountMicros: 3_600_000, timestamp: start + n * 10_000 + 1000 });
  return { api, issue, pay, receipt, db: () => db, calls: () => calls };
}

for (const seller of ['seller', 'other']) test(`three distinct 3.6 receipts settle successive 3.54 dues, next seller ${seller}`, async () => {
  const x = setup();
  for (let n = 0; n < 3; n++) {
    const c = await x.issue(n, n ? seller : 'seller');
    if (n) assert.notEqual(c.expectedMicros, 3_540_000);
    const receipts = Array.from({ length: n + 1 }, (_, i) => x.receipt(i));
    // The provider may repeat the same transaction under another hash spelling.
    receipts.push({ ...x.receipt(n), signature: x.receipt(n).signature.slice(2).toUpperCase() });
    assert.equal((await x.pay(n, receipts)).verified, 1);
    assert.equal((await x.pay(n, receipts)).verified, 0);
  }
  assert.equal(x.calls(), 3);
  assert.equal(x.db().notifications.length, 3);
  assert.ok(x.db().commissionRecords.every(row => row.paymentStatus === 'paid'
    && row.paymentBatchSettlement.receivedMicros === 3_600_000
    && row.paymentBatchSettlement.excessMicros === 60_000
    && row.paymentReservedExpectedAmounts.includes(3.6)));
});

for (const paidAt of [undefined, 'invalid', new Date(start + 11_000).toISOString(), new Date(start + 12_000).toISOString()])
test(`an earlier received amount stays protected without proof it closed before the new receipt: ${paidAt}`, async () => {
  const x = setup(); await x.issue(0); await x.pay(0, [x.receipt(0)]);
  await x.issue(1); x.db().commissionRecords[0].paidAt = paidAt;
  const result = await x.pay(1, [x.receipt(1)]);
  assert.equal(result.verified, 0); assert.equal(x.calls(), 1);
  assert.equal(result.reviewReasons.payment_reference_conflict, 1);
});

test('a received amount cannot excuse an issued legacy payment reference', async () => {
  const x = setup(); await x.issue(0); await x.pay(0, [x.receipt(0)]);
  await x.issue(1); x.db().commissionRecords[0].paymentExpectedAmount = 3.6;
  assert.equal((await x.pay(1, [x.receipt(1)])).verified, 0);
});

test('an incomplete prior group cannot release its observed amount', async () => {
  const x = setup(); const c = await x.issue(0); await x.pay(0, [x.receipt(0)]);
  await x.issue(1);
  const issued = x.db().auditLogs.find(row => row.id === `${c.id}:issued`).newValue.checkout;
  issued.commissions.push({ id: 'missing', dueMicros: 1, createdAt: issued.commissions[0].createdAt });
  issued.dueMicros++;
  assert.equal((await x.pay(1, [x.receipt(1)])).verified, 0);
});

test('the same transaction cannot pay the next commission even with a later provider timestamp', async () => {
  const x = setup(); await x.issue(0); await x.pay(0, [x.receipt(0)]); await x.issue(1);
  const replay = { ...x.receipt(1), signature: x.receipt(0).signature };
  assert.equal((await x.pay(1, [replay])).verified, 0);
  assert.equal(x.calls(), 1); assert.equal(x.db().commissionRecords[1].paymentStatus, 'pending');
});
