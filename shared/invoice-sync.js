// invoice-sync.js — 財政部載具發票資料轉換與去重（不保存載具驗證碼）
const InvoiceSync = (() => {
  const supportedCurrencies = new Set(['TWD', 'EUR', 'JPY', 'USD']);
  const pad = (value) => String(value).padStart(2, '0');
  const invoiceDate = (value) => {
    if (typeof value === 'string') {
      const digits = value.replace(/\D/g, '');
      if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    }
    if (value && typeof value === 'object') {
      const year = Number(value.year);
      const westernYear = year < 1911 ? year + 1911 : year;
      return `${westernYear}-${pad(value.month)}-${pad(value.date)}`;
    }
    throw new Error('發票日期格式不正確');
  };
  const invoiceId = (invoice) => {
    const number = String(invoice.invNum || '').replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{8}$/.test(number)) throw new Error('發票號碼格式不正確');
    return `einvoice-${number}-${invoiceDate(invoice.invDate)}`;
  };
  const categoryFromText = (invoice) => {
    const text = [invoice.sellerName, ...(invoice.details || []).map(item => item.description)].join(' ');
    const rules = [
      ['交通', /捷運|高鐵|台鐵|客運|加油|停車|計程車|uber/i],
      ['餐飲', /餐|咖啡|茶|飲料|食品|超商|便利商店|便當|麵|飯/i],
      ['醫療', /醫院|診所|藥局|藥品/i],
      ['居家', /家居|五金|水電|家具|生活百貨/i],
      ['學習', /書店|書局|課程|學費/i]
    ];
    return rules.find(([, pattern]) => pattern.test(text))?.[0] || '未分類';
  };
  const toLedgerEntry = (invoice, { account = null } = {}) => {
    const amount = Number(invoice.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('發票金額格式不正確');
    const currency = supportedCurrencies.has(invoice.currency) ? invoice.currency : 'TWD';
    const itemSummary = (invoice.details || []).map(item => item.description).filter(Boolean).slice(0, 3).join('、');
    return {
      id: invoiceId(invoice), date: invoiceDate(invoice.invDate), type: 'expense',
      category: categoryFromText(invoice), account, amountCents: -Math.round(amount * 100),
      currency, essential: false, reimbursable: false, status: 'realized',
      note: [invoice.sellerName, itemSummary, `電子發票 ${invoice.invNum}`].filter(Boolean).join('｜'),
      source: 'mof-einvoice', sourceInvoiceNumber: invoice.invNum, importedAt: new Date().toISOString()
    };
  };
  const mergeInvoices = (ledger, invoices, options = {}) => {
    if (!ledger || !Array.isArray(ledger.entries)) throw new Error('帳本格式不正確');
    if (!Array.isArray(invoices)) throw new Error('同步結果缺少 invoices 陣列');
    const known = new Set(ledger.entries.map(entry => entry.id));
    const added = [], skipped = [], errors = [];
    for (const invoice of invoices) {
      if (String(invoice.donateMark) === '1') { skipped.push({ invoice, reason: '已捐贈' }); continue; }
      try {
        const entry = toLedgerEntry(invoice, options);
        if (known.has(entry.id)) { skipped.push({ invoice, reason: '重複' }); continue; }
        known.add(entry.id); added.push(entry);
      } catch (error) { errors.push({ invoice, reason: error.message }); }
    }
    ledger.entries.push(...added);
    return { added, skipped, errors };
  };
  return { invoiceDate, invoiceId, categoryFromText, toLedgerEntry, mergeInvoices };
})();
