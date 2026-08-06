// validation.js — 所有畫面輸入、匯入資料與計算入口共用的資料驗證。
const Validation = (() => {
  const error = (path, code, message) => ({ path, code, message });
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const integer = (v) => Number.isInteger(v);
  const datePattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
  const currencies = new Set(['TWD', 'EUR', 'JPY', 'USD']);

  const isValidDate = (value) => {
    if (typeof value !== 'string' || !datePattern.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
  };
  const isValidMonth = (value) => typeof value === 'string' && monthPattern.test(value);

  const validateQuickPlan = (p) => {
    const errors = [];
    if (!integer(p.currentAge) || p.currentAge < 0 || p.currentAge > 120) errors.push(error('currentAge', 'OUT_OF_RANGE', '目前年齡須為 0–120 的整數'));
    for (const key of ['monthlyNetIncomeCents', 'monthlyEssentialExpenseCents', 'monthlyOtherExpenseCents', 'liquidAssetsCents', 'goalAmountTodayCents']) {
      if (!finite(p[key]) || p[key] < 0) errors.push(error(key, 'INVALID_MONEY', `${key} 必須是大於或等於 0 的有限金額`));
    }
    if (!isValidMonth(p.goalTargetMonth)) errors.push(error('goalTargetMonth', 'INVALID_MONTH', '目標月份必須是 YYYY-MM'));
    if (!finite(p.inflationAnnualRate) || p.inflationAnnualRate <= -1 || p.inflationAnnualRate > 0.20) errors.push(error('inflationAnnualRate', 'OUT_OF_RANGE', '年通膨率須大於 -100% 且不高於 20%'));
    if (!finite(p.nominalReturnAnnualRate) || p.nominalReturnAnnualRate <= -1 || p.nominalReturnAnnualRate > 0.50) errors.push(error('nominalReturnAnnualRate', 'OUT_OF_RANGE', '名目年報酬率須大於 -100% 且不高於 50%'));
    return { valid: errors.length === 0, errors, warnings: [] };
  };

  const validateLedger = (data) => {
    const errors = [];
    if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) return { valid: false, errors: [error('', 'INVALID_LEDGER', '帳本必須包含 entries 陣列')], warnings: [] };
    const ids = new Set();
    data.entries.forEach((e, i) => {
      const p = `entries[${i}]`;
      if (!e || typeof e !== 'object') { errors.push(error(p, 'INVALID_ENTRY', '帳目必須是物件')); return; }
      if (typeof e.id !== 'string' || !e.id) errors.push(error(`${p}.id`, 'MISSING_ID', '帳目缺少 ID'));
      else if (ids.has(e.id)) errors.push(error(`${p}.id`, 'DUPLICATE_ID', `帳目 ID 重複：${e.id}`));
      else ids.add(e.id);
      if (!isValidDate(e.date)) errors.push(error(`${p}.date`, 'INVALID_DATE', '日期必須是有效的 YYYY-MM-DD'));
      if (!['expense', 'income', 'wishlist', 'transfer'].includes(e.type)) errors.push(error(`${p}.type`, 'INVALID_TYPE', '帳目類型不合法'));
      if (e.type === 'transfer' && (!e.fromAccount || !e.toAccount || e.fromAccount === e.toAccount)) errors.push(error(p, 'INVALID_TRANSFER', '轉帳必須指定兩個不同帳戶'));
      if (!finite(e.amountCents) || !integer(e.amountCents)) errors.push(error(`${p}.amountCents`, 'INVALID_MONEY', '金額必須是有限整數分'));
      if (!currencies.has(e.currency || 'TWD')) errors.push(error(`${p}.currency`, 'INVALID_CURRENCY', '不支援此幣別'));
      if ((e.currency || 'TWD') !== 'TWD' && (!finite(e.rateToTWD) || e.rateToTWD <= 0)) errors.push(error(`${p}.rateToTWD`, 'INVALID_RATE', '外幣匯率必須大於 0'));
    });
    return { valid: errors.length === 0, errors, warnings: [] };
  };

  const validateScenario = (s, path = 'scenario') => {
    const errors = [];
    if (!s || typeof s !== 'object') return { valid: false, errors: [error(path, 'INVALID_SCENARIO', '情境必須是物件')], warnings: [] };
    if (typeof s.scenarioId !== 'string' || !s.scenarioId) errors.push(error(`${path}.scenarioId`, 'MISSING_ID', '情境缺少 scenarioId'));
    if (Array.isArray(s.items)) s.items.forEach((item, i) => {
      if (!item || typeof item.label !== 'string' || !finite(item.amountCents) || !integer(item.amountCents)) errors.push(error(`${path}.items[${i}]`, 'INVALID_ITEM', '項目必須包含名稱與整數分金額'));
    });
    if (s.mortgage) {
      if (!finite(s.mortgage.purchaseAge) || s.mortgage.purchaseAge < 0) errors.push(error(`${path}.mortgage.purchaseAge`, 'INVALID_AGE', '購屋年齡必須為非負數'));
      if (!finite(s.mortgage.annualRate) || s.mortgage.annualRate < 0 || s.mortgage.annualRate > 0.20) errors.push(error(`${path}.mortgage.annualRate`, 'INVALID_RATE', '房貸年利率須介於 0%–20%'));
      if (!finite(s.mortgage.termYears) || s.mortgage.termYears < 1) errors.push(error(`${path}.mortgage.termYears`, 'INVALID_TERM', '房貸年限至少一年'));
      if (!finite(s.mortgage.graceYears) || s.mortgage.graceYears < 0 || s.mortgage.graceYears >= s.mortgage.termYears) errors.push(error(`${path}.mortgage.graceYears`, 'INVALID_TERM', '房貸寬限期必須小於總年限'));
      if (!['estimated', 'manual'].includes(s.mortgage.principalMode || 'estimated')) errors.push(error(`${path}.mortgage.principalMode`, 'INVALID_MODE', '房貸本金來源不合法'));
      if (s.mortgage.principalMode === 'manual' && (!finite(s.mortgage.manualPrincipalCents) || s.mortgage.manualPrincipalCents < 0)) errors.push(error(`${path}.mortgage.manualPrincipalCents`, 'INVALID_MONEY', '房貸未償本金必須為非負金額'));
    }
    if (s.calcType === 'retirement_fund') {
      if (!integer(s.currentAge) || !integer(s.retireAge) || !integer(s.deathAge) || !(s.currentAge < s.retireAge && s.retireAge < s.deathAge)) errors.push(error(path, 'AGE_ORDER', '養老金必須符合目前年齡 < 退休年齡 < 預期壽命'));
      if (!finite(s.monthlyLivingCostCents) || s.monthlyLivingCostCents < 0) errors.push(error(`${path}.monthlyLivingCostCents`, 'INVALID_MONEY', '每月生活費必須是非負有限金額'));
    }
    if (s.calcType === 'periods') {
      if (!Array.isArray(s.itemTemplate) || !Array.isArray(s.periods)) errors.push(error(path, 'INVALID_PERIODS', '期別情境缺少範本或期別陣列'));
      if (s.repayment) {
        if (!finite(s.repayment.graduationAge) || s.repayment.graduationAge < 0) errors.push(error(`${path}.repayment.graduationAge`, 'INVALID_AGE', '預計畢業年齡必須為非負數'));
        if (!finite(s.repayment.graceYears) || s.repayment.graceYears < 0) errors.push(error(`${path}.repayment.graceYears`, 'INVALID_TERM', '寬限年數必須為非負數'));
        if (!finite(s.repayment.annualRate) || s.repayment.annualRate < 0 || s.repayment.annualRate > 0.20) errors.push(error(`${path}.repayment.annualRate`, 'INVALID_RATE', '學貸年利率須介於 0%–20%'));
        if (!['standard', 'extended', 'low_income'].includes(s.repayment.termPlan)) errors.push(error(`${path}.repayment.termPlan`, 'INVALID_TERM', '學貸攤還方案不合法'));
        if (!['estimated', 'manual'].includes(s.repayment.principalMode || 'estimated')) errors.push(error(`${path}.repayment.principalMode`, 'INVALID_MODE', '學貸本金來源不合法'));
        if (s.repayment.principalMode === 'manual' && (!finite(s.repayment.manualPrincipalCents) || s.repayment.manualPrincipalCents < 0)) errors.push(error(`${path}.repayment.manualPrincipalCents`, 'INVALID_MONEY', '銀行未償本金必須為非負金額'));
        if (!finite(s.repayment.reserveMonths) || s.repayment.reserveMonths < 0) errors.push(error(`${path}.repayment.reserveMonths`, 'INVALID_TERM', '預備金月數必須為非負數'));
      }
    }
    if (s.calcType === 'fire') {
      if (!integer(s.startAge) || !integer(s.retireAge) || !integer(s.deathAge)) errors.push(error(path, 'INVALID_AGE', 'FIRE 年齡必須是整數'));
      else if (!(s.startAge < s.retireAge && s.retireAge < s.deathAge)) errors.push(error(path, 'AGE_ORDER', '必須符合開始工作年齡 < 退休年齡 < 預期壽命'));
      if (!finite(s.postRetirementAnnualReturnRate) || s.postRetirementAnnualReturnRate < 0 || s.postRetirementAnnualReturnRate > 0.20) errors.push(error(`${path}.postRetirementAnnualReturnRate`, 'INVALID_RATE', '退休後年化報酬率須介於 0%–20%'));
      if (!finite(s.assumedSalaryGrowthRate) || s.assumedSalaryGrowthRate <= -1 || s.assumedSalaryGrowthRate > 0.50) errors.push(error(`${path}.assumedSalaryGrowthRate`, 'INVALID_RATE', '薪資成長率須大於 -100% 且不高於 50%'));
      const preRetirementRate = s.preRetirementAnnualReturnRate ?? 0;
      if (!finite(preRetirementRate) || preRetirementRate < 0 || preRetirementRate > 0.50) errors.push(error(`${path}.preRetirementAnnualReturnRate`, 'INVALID_RATE', '退休前年報酬率須介於 0%–50%'));
    }
    return { valid: errors.length === 0, errors, warnings: [] };
  };

  const validateScenarios = (data) => {
    const errors = [];
    if (!data || !Array.isArray(data.scenarios) || data.scenarios.length === 0) return { valid: false, errors: [error('scenarios', 'INVALID_SCENARIOS', '試算情境必須是非空陣列')], warnings: [] };
    const ids = new Set();
    data.scenarios.forEach((s, i) => {
      const checked = validateScenario(s, `scenarios[${i}]`);
      errors.push(...checked.errors);
      if (s?.scenarioId && ids.has(s.scenarioId)) errors.push(error(`scenarios[${i}].scenarioId`, 'DUPLICATE_ID', `情境 ID 重複：${s.scenarioId}`));
      else if (s?.scenarioId) ids.add(s.scenarioId);
    });
    return { valid: errors.length === 0, errors, warnings: [] };
  };

  const validateWage = (s) => {
    const errors = [];
    if (!s || typeof s !== 'object') return { valid: false, errors: [error('', 'INVALID_WAGE', '工時情境必須是物件')], warnings: [] };
    if (!finite(s.targetAmountCents) || s.targetAmountCents < 0) errors.push(error('targetAmountCents', 'INVALID_MONEY', '目標金額必須為非負有限數字'));
    if (!finite(s.baseRateCentsPerHour) || s.baseRateCentsPerHour <= 0) errors.push(error('baseRateCentsPerHour', 'INVALID_RATE', '時薪必須大於 0'));
    if (!currencies.has(s.currency || 'TWD')) errors.push(error('currency', 'INVALID_CURRENCY', '不支援此幣別'));
    if ((s.currency || 'TWD') !== 'TWD' && (!finite(s.rateToTWD) || s.rateToTWD <= 0)) errors.push(error('rateToTWD', 'INVALID_RATE', '外幣匯率必須大於 0'));
    if (!Array.isArray(s.conversionChain) || s.conversionChain.some(x => !finite(x.factor) || x.factor <= 0)) errors.push(error('conversionChain', 'INVALID_CHAIN', '換算鏈的每個係數都必須大於 0'));
    if (s.grossMonthlySalaryCents !== undefined && (!finite(s.grossMonthlySalaryCents) || s.grossMonthlySalaryCents <= 0)) errors.push(error('grossMonthlySalaryCents', 'INVALID_MONEY', '月總工資必須大於 0'));
    if (s.monthlyWorkHours !== undefined && (!finite(s.monthlyWorkHours) || s.monthlyWorkHours <= 0)) errors.push(error('monthlyWorkHours', 'INVALID_HOURS', '月工時必須大於 0'));
    return { valid: errors.length === 0, errors, warnings: [] };
  };
  const validateRecurringFlows = (flows) => {
    const errors = [], ids = new Set();
    if (!Array.isArray(flows)) return { valid: false, errors: [error('recurringCashFlows', 'INVALID_RECURRING', '固定出入帳必須是陣列')], warnings: [] };
    flows.forEach((f, i) => {
      const p = `recurringCashFlows[${i}]`;
      if (!f || typeof f !== 'object') { errors.push(error(p, 'INVALID_FLOW', '固定項目必須是物件')); return; }
      if (typeof f.id !== 'string' || !f.id || ids.has(f.id)) errors.push(error(`${p}.id`, 'INVALID_ID', '固定項目 ID 不可空白或重複')); else ids.add(f.id);
      if (!['income', 'expense', 'saving'].includes(f.type)) errors.push(error(`${p}.type`, 'INVALID_TYPE', '固定項目只能是收入、支出或儲蓄'));
      if (!integer(f.amountCents) || f.amountCents < 0) errors.push(error(`${p}.amountCents`, 'INVALID_MONEY', '固定金額必須是非負整數分'));
      if (!integer(f.dayOfMonth) || f.dayOfMonth < 1 || f.dayOfMonth > 31) errors.push(error(`${p}.dayOfMonth`, 'INVALID_DAY', '固定日期須介於 1–31 日'));
      if (f.type === 'income' && (!finite(f.monthlyWorkHours) || f.monthlyWorkHours <= 0)) errors.push(error(`${p}.monthlyWorkHours`, 'INVALID_HOURS', '收入來源的月工時必須大於 0'));
      if (typeof f.accountId !== 'string' || !f.accountId) errors.push(error(`${p}.accountId`, 'MISSING_ACCOUNT', '固定項目必須指定帳戶'));
      if (f.type === 'saving' && (typeof f.fromAccountId !== 'string' || !f.fromAccountId || f.fromAccountId === f.accountId)) errors.push(error(p, 'INVALID_SAVING_TRANSFER', '固定儲蓄必須指定兩個不同帳戶'));
    });
    return { valid: errors.length === 0, errors, warnings: [] };
  };

  const validateImported = (data, kind) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { valid: false, errors: [error('', 'INVALID_ROOT', 'JSON 根節點必須是物件')], warnings: [] };
    if (!integer(data.schemaVersion)) return { valid: false, errors: [error('schemaVersion', 'MISSING_VERSION', '資料缺少整數 schemaVersion')], warnings: [] };
    if (kind === 'ledger') return validateLedger(data);
    return { valid: true, errors: [], warnings: [] };
  };

  return { finite, isValidDate, isValidMonth, validateQuickPlan, validateLedger, validateScenario, validateScenarios, validateWage, validateRecurringFlows, validateImported };
})();
