import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../shared/invoice-sync.js', import.meta.url), 'utf8');
const context = vm.createContext({ Date });
vm.runInContext(source, context);
const InvoiceSync = vm.runInContext('InvoiceSync', context);

test('財政部民國日期可轉為帳本日期', () => {
  assert.equal(InvoiceSync.invoiceDate({ year: '115', month: '8', date: '7' }), '2026-08-07');
  assert.equal(InvoiceSync.invoiceDate('20260807'), '2026-08-07');
});

test('發票轉帳目並自動分類', () => {
  const entry = InvoiceSync.toLedgerEntry({ invNum: 'AB12345678', invDate: '20260807', amount: '120', sellerName: '測試便利商店', currency: 'TWD', details: [{ description: '茶' }] }, { account: 'cash' });
  assert.equal(entry.id, 'einvoice-AB12345678-2026-08-07');
  assert.equal(entry.amountCents, -12000);
  assert.equal(entry.category, '餐飲');
  assert.equal(entry.account, 'cash');
});

test('同步會去重並跳過已捐贈發票', () => {
  const duplicate = { invNum: 'AB12345678', invDate: '20260807', amount: '120' };
  const donated = { invNum: 'CD12345678', invDate: '20260807', amount: '50', donateMark: '1' };
  const ledger = { entries: [{ id: 'einvoice-AB12345678-2026-08-07' }] };
  const result = InvoiceSync.mergeInvoices(ledger, [duplicate, donated]);
  assert.equal(result.added.length, 0);
  assert.equal(result.skipped.length, 2);
  assert.equal(ledger.entries.length, 1);
});
