import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { console, structuredClone };
vm.createContext(ctx);
for (const rel of ['shared/reference-data.js','shared/config.js','shared/validation.js','shared/planning.js','shared/money.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
}
const api = vm.runInContext('({REFERENCE_DATA,DEFAULT_CONFIG,SCENARIO_FIRE,Validation,Planning,Money})', ctx);

test('官方通膨快照包含來源與日期', () => {
  assert.ok(api.REFERENCE_DATA.twInflation.sourceUrl.startsWith('https://'));
  assert.match(api.REFERENCE_DATA.twInflation.observedThrough, /^\d{4}-\d{2}-\d{2}$/);
});

test('今日金額以複利換算未來名目金額', () => {
  assert.equal(api.Planning.futureValue(10000, 0.02, 12), 10200);
  assert.ok(Math.abs(api.Planning.realRate(0.05, 0.02) - 0.0294117647) < 1e-9);
});

test('快速健檢可用少量資料產生三情境', () => {
  const p = structuredClone(api.DEFAULT_CONFIG.quickPlan);
  const r = api.Planning.assess(p, new Date('2026-08-07T00:00:00Z'));
  assert.equal(r.ok, true);
  assert.equal(r.scenarios.length, 3);
  assert.equal(r.monthlySurplus, 800000);
  assert.ok(r.futureGoal >= p.goalAmountTodayCents);
});

test('目標期限採完整月份無條件進位', () => {
  const p = structuredClone(api.DEFAULT_CONFIG.quickPlan);
  p.goalAmountTodayCents = 1001;
  p.liquidAssetsCents = 0;
  p.goalTargetMonth = '2026-10';
  p.inflationAnnualRate = 0;
  p.nominalReturnAnnualRate = 0;
  const r = api.Planning.assess(p, new Date('2026-08-07T00:00:00Z'));
  assert.equal(r.monthsToGoal, 2);
  assert.equal(r.monthlyGoalContribution, 501);
});

test('緊急預備金不重複當作目標本金', () => {
  const p = structuredClone(api.DEFAULT_CONFIG.quickPlan);
  p.monthlyEssentialExpenseCents = 1000;
  p.liquidAssetsCents = 6000;
  p.goalAmountTodayCents = 12000;
  p.goalTargetMonth = '2027-08';
  p.inflationAnnualRate = 0;
  p.nominalReturnAnnualRate = 0;
  const r = api.Planning.assess(p, new Date('2026-08-07T00:00:00Z'));
  assert.equal(r.goalStartingAssets, 0);
  assert.equal(r.monthlyGoalContribution, 1000);
});

test('無效快速設定被拒絕，不產生 Infinity', () => {
  const p = structuredClone(api.DEFAULT_CONFIG.quickPlan);
  p.inflationAnnualRate = Infinity;
  const r = api.Planning.assess(p);
  assert.equal(r.ok, false);
});

test('帳本拒絕重複 ID、錯誤日期與無效匯率', () => {
  const d = { schemaVersion: 2, entries: [
    { id:'x', date:'2026-02-30', type:'expense', amountCents:-100, currency:'USD', rateToTWD:0 },
    { id:'x', date:'2026-02-01', type:'expense', amountCents:-100, currency:'TWD', rateToTWD:1 }
  ]};
  const r = api.Validation.validateLedger(d);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => e.code === 'DUPLICATE_ID'));
  assert.ok(r.errors.some(e => e.code === 'INVALID_DATE'));
  assert.ok(r.errors.some(e => e.code === 'INVALID_RATE'));
});

test('外幣匯率必須大於零', () => {
  assert.throws(() => api.Money.toTWDCents(100, 'USD', 0));
  assert.equal(api.Money.toTWDCents(100, 'USD', 32), 3200);
});

test('工時設定拒絕零時薪', () => {
  const s = { schemaVersion:1, targetAmountCents:100, baseRateCentsPerHour:0, currency:'TWD', rateToTWD:1, conversionChain:[] };
  assert.equal(api.Validation.validateWage(s).valid, false);
});

test('月總工資可一次回算時薪、勞健保與實領', () => {
  const rates = api.DEFAULT_CONFIG.insuranceRates;
  const result = api.Money.calcPayroll(3300000, 160, 3300000, rates);
  assert.equal(result.hourlyRateCents, 20625);
  assert.equal(result.net, result.gross - result.laborFee - result.healthFee);
  assert.ok(result.laborFee > 0);
  assert.ok(result.healthFee > 0);
});

test('薪資回算拒絕零工時', () => {
  assert.throws(() => api.Money.calcPayroll(3300000, 0, 3300000, api.DEFAULT_CONFIG.insuranceRates), /月工時/);
});

test('帳戶轉帳必須指定兩個不同帳戶', () => {
  const ledger = { schemaVersion: 2, entries: [{ id: 't1', date: '2026-08-07', type: 'transfer', amountCents: 10000, currency: 'TWD', rateToTWD: 1, account: 'a', fromAccount: 'a', toAccount: 'a' }] };
  assert.equal(api.Validation.validateLedger(ledger).valid, false);
  ledger.entries[0].toAccount = 'b';
  assert.equal(api.Validation.validateLedger(ledger).valid, true);
});

test('正職、兼職與接案可分別決定是否扣勞健保', () => {
  const flows = [
    { id: 'job', name: '正職', type: 'income', kind: 'salary', amountCents: 4000000, monthlyWorkHours: 160, applyInsurance: true, insuredSalaryFollowsGross: true, dayOfMonth: 5, accountId: 'bank' },
    { id: 'side', name: '接案', type: 'income', kind: 'freelance', amountCents: 1000000, monthlyWorkHours: 20, applyInsurance: false, dayOfMonth: 15, accountId: 'bank' },
    { id: 'rent', name: '房租', type: 'expense', kind: 'fixed_expense', amountCents: 1200000, essential: true, dayOfMonth: 1, accountId: 'bank' }
  ];
  const result = api.Money.calcRecurringMonthly(flows, api.DEFAULT_CONFIG.insuranceRates);
  assert.equal(result.items[1].netCents, 1000000);
  assert.ok(result.items[0].netCents < 4000000);
  assert.equal(result.essentialExpenseCents, 1200000);
  assert.equal(result.monthlySavingsCents, result.incomeCents - 1200000);
  assert.equal(api.Validation.validateRecurringFlows(flows).valid, true);
});

test('工時反推可直接沿用固定收入的工資、工時與保險設定', () => {
  const linked = api.Money.wageSettingsFromIncome({ type: 'income', amountCents: 4800000, monthlyWorkHours: 120, applyInsurance: false, insuredSalaryFollowsGross: true });
  assert.equal(linked.grossMonthlySalaryCents, 4800000);
  assert.equal(linked.baseRateCentsPerHour, 40000);
  assert.equal(linked.applyInsurance, false);
  assert.equal(linked.insuredSalaryCents, 4800000);
});

test('多帳戶分配先滿足生活、固定支出與緊急預備金', () => {
  const result = api.Planning.allocateMonthly({
    incomeCents: 5000000, livingCents: 1800000, fixedExpenseCents: 1200000, emergencyGapCents: 1200000,
    savingCents: 300000, livingAccountId: 'living', fixedExpenseAccountId: 'fixed', emergencyAccountId: 'emergency', savingsAccountId: 'saving',
    goals: [{ key: 'trip', label: '旅行', gapCents: 2400000, months: 12, accountId: 'trip' }]
  });
  assert.deepEqual(Array.from(result.rows, r => r.accountId), ['living', 'fixed', 'emergency', 'saving', 'trip']);
  assert.deepEqual(Array.from(result.rows, r => r.allocatedCents), [1800000, 1200000, 100000, 300000, 200000]);
  assert.equal(result.unallocatedCents, 1400000);
});

test('收入不足時可選成本目標不會排擠必備分配', () => {
  const result = api.Planning.allocateMonthly({ incomeCents: 2000000, livingCents: 1500000, fixedExpenseCents: 1000000, emergencyGapCents: 1200000, goals: [{ key: 'goal', label: '目標', gapCents: 1200000, months: 12 }] });
  assert.equal(result.rows[0].allocatedCents, 1500000);
  assert.equal(result.rows[1].allocatedCents, 500000);
  assert.equal(result.rows[3].allocatedCents, 0);
});

test('固定儲蓄不列為支出並驗證不同轉出入帳戶', () => {
  const flows = [{ id: 'save', name: '儲蓄', type: 'saving', amountCents: 500000, dayOfMonth: 6, fromAccountId: 'checking', accountId: 'saving' }];
  const result = api.Money.calcRecurringMonthly(flows, api.DEFAULT_CONFIG.insuranceRates);
  assert.equal(result.fixedSavingCents, 500000);
  assert.equal(result.essentialExpenseCents + result.otherExpenseCents, 0);
  assert.equal(api.Validation.validateRecurringFlows(flows).valid, true);
  flows[0].accountId = 'checking';
  assert.equal(api.Validation.validateRecurringFlows(flows).valid, false);
});

test('每月儲蓄健康度、每日生活費與達成率可自動計算', () => {
  const result = api.Planning.assessMonthlySavings({ incomeCents: 4000000, fixedExpenseCents: 1500000, fixedSavingCents: 500000, actualIncomeCents: 4000000, actualExpenseCents: 3000000, daysInMonth: 31 });
  assert.equal(result.recommendedSavingCents, 800000);
  assert.equal(result.actualSavingsCents, 1000000);
  assert.equal(result.actualSavingsRate, 0.25);
  assert.equal(result.attainmentRate, 1.25);
  assert.equal(result.health.label, '健康');
  assert.equal(result.dailyLivingCents, Math.floor(1700000 / 31));
  assert.ok(result.strengths.some(text => text.includes('已達 20%')));
  assert.ok(result.strengths.some(text => text.includes('已達成建議金額')));
  assert.ok(result.strengths.some(text => text.includes('固定儲蓄')));
});

test('分類花費可計算跨月平均與占比，包含中間空白月份', () => {
  const entries = [
    { type: 'expense', date: '2026-01-05', category: '食', amountCents: -30000, currency: 'TWD', rateToTWD: 1 },
    { type: 'expense', date: '2026-03-08', category: '食', amountCents: -60000, currency: 'TWD', rateToTWD: 1 },
    { type: 'expense', date: '2026-03-09', category: '行', amountCents: -10000, currency: 'TWD', rateToTWD: 1 }
  ];
  const result = api.Money.calcExpenseAverages(entries);
  assert.equal(result.monthCount, 3);
  assert.equal(result.totalCents, 100000);
  assert.equal(result.rows.find(r => r.label === '食').monthlyAverageCents, 30000);
  assert.equal(result.rows.find(r => r.label === '食').share, 0.9);
});

test('學貸依現行年金法估算月繳、年限與年齡啟用狀態', () => {
  const repayment = { graduationAge: 22, graceYears: 2, annualRate: 0.00775, termPlan: 'standard' };
  const waiting = api.Money.calcStudentLoanRepayment(10000000, 8, repayment, 23);
  assert.equal(waiting.termMonths, 96);
  assert.equal(waiting.termYears, 8);
  assert.equal(waiting.repaymentStartAge, 24);
  assert.equal(waiting.status, 'waiting');
  assert.ok(waiting.monthlyPaymentCents > Math.ceil(10000000 / 96));
  assert.equal(api.Money.calcStudentLoanRepayment(10000000, 8, repayment, 25).status, 'repaying');
  assert.equal(api.Money.calcStudentLoanRepayment(10000000, 8, { ...repayment, termPlan: 'low_income' }, 25).termYears, 16);
});

test('房貸可計算寬限期、正常月繳、總利息與升息壓力', () => {
  const mortgage = { purchaseAge: 30, annualRate: 0.03, termYears: 30, graceYears: 2 };
  const plan = api.Money.calcMortgageRepayment(1000000000, mortgage, 30);
  assert.equal(plan.status, 'grace');
  assert.equal(plan.graceMonths, 24);
  assert.equal(plan.termMonths, 360);
  assert.equal(plan.currentPaymentCents, plan.interestOnlyPaymentCents);
  assert.ok(plan.monthlyPaymentCents > plan.interestOnlyPaymentCents);
  assert.ok(plan.totalInterestCents > 0);
  const stressed = api.Money.calcMortgageRepayment(1000000000, { ...mortgage, annualRate: 0.05 }, 32);
  assert.ok(stressed.monthlyPaymentCents > plan.monthlyPaymentCents);
});

test('FIRE反推納入其他目標：提高買房目標不得提早退休', () => {
  const c = structuredClone(api.DEFAULT_CONFIG);
  const base = structuredClone(api.SCENARIO_FIRE);
  base.retireAgeSolveMode = 'given_growth_rate';
  base.assumedSalaryGrowthRate = 0.03;
  const age1 = api.Money.calcScenario(base, c).solvedRetireAge;
  const larger = structuredClone(base);
  larger.buyHouseGoalCents *= 2;
  const age2 = api.Money.calcScenario(larger, c).solvedRetireAge;
  assert.ok(age2 === null || age1 === null || age2 >= age1);
});

test('FIRE拒絕零除與錯誤年齡順序', () => {
  const c = structuredClone(api.DEFAULT_CONFIG);
  const s = structuredClone(api.SCENARIO_FIRE);
  s.retireAge = s.startAge;
  assert.throws(() => api.Money.calcScenario(s, c), /年齡/);
});

test('FIRE零報酬率以固定年限支出計算，不回傳 Infinity', () => {
  const c = structuredClone(api.DEFAULT_CONFIG);
  const s = structuredClone(api.SCENARIO_FIRE);
  s.postRetirementAnnualReturnRate = 0;
  const r = api.Money.calcScenario(s, c);
  assert.ok(Number.isFinite(r.retirementAssetTarget));
  assert.equal(r.retirementAssetTarget, s.retirementMonthlyExpenseCents * 12 * (s.deathAge - s.retireAge));
});
