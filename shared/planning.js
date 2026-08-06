// planning.js — 今日幣值、少輸入財務健檢與固定壓力情境；純函式、無網路、無 AI。
const Planning = (() => {
  const addMonths = (year, month, count) => {
    const d = new Date(Date.UTC(year, month - 1 + count, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  };
  const monthsBetween = (fromDate, targetMonth) => {
    const [y, m] = targetMonth.split('-').map(Number);
    return Math.max(0, (y - fromDate.getFullYear()) * 12 + (m - 1 - fromDate.getMonth()));
  };
  const futureValue = (todayCents, annualInflation, months) => Math.round(todayCents * Math.pow(1 + annualInflation, months / 12));
  const realRate = (nominal, inflation) => (1 + nominal) / (1 + inflation) - 1;
  const requiredMonthlyContribution = (targetFutureCents, currentCents, annualReturn, months) => {
    if (months <= 0) return Math.max(0, targetFutureCents - currentCents);
    const monthlyRate = Math.pow(1 + annualReturn, 1 / 12) - 1;
    const grownCurrent = currentCents * Math.pow(1 + monthlyRate, months);
    const gap = Math.max(0, targetFutureCents - grownCurrent);
    if (Math.abs(monthlyRate) < 1e-12) return Math.ceil(gap / months);
    const annuityFactor = (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate;
    return Math.ceil(gap / annuityFactor);
  };
  const allocateMonthly = ({ incomeCents, livingCents, fixedExpenseCents, emergencyGapCents, emergencyMonthlyCents, savingCents = 0, livingAccountId, fixedExpenseAccountId, emergencyAccountId, savingsAccountId, goals = [] }) => {
    let remaining = Math.max(0, Math.round(incomeCents || 0));
    const rows = [];
    const assign = (key, label, requestedCents, accountId, required, extra = {}) => {
      const requested = Math.max(0, Math.round(requestedCents || 0));
      const allocated = Math.min(remaining, requested);
      remaining -= allocated;
      rows.push({ key, label, requestedCents: requested, allocatedCents: allocated, shortfallCents: requested - allocated, accountId, required, ...extra });
    };
    assign('living', '基本生活需求', livingCents, livingAccountId, true);
    assign('fixed', '固定支出', fixedExpenseCents, fixedExpenseAccountId, true);
    assign('emergency', '緊急預備金', emergencyMonthlyCents ?? Math.ceil(Math.max(0, emergencyGapCents || 0) / 12), emergencyAccountId, true);
    if (savingCents > 0) assign('saving', '固定儲蓄', savingCents, savingsAccountId, true);
    [...goals].sort((a, b) => (a.months || Infinity) - (b.months || Infinity)).forEach(g => {
      const requested = g.monthlyRequiredCents ?? Math.ceil(Math.max(0, g.gapCents || 0) / Math.max(1, g.months || 1));
      assign(g.key, g.label, requested, g.accountId, false, g);
    });
    return { incomeCents: Math.round(incomeCents || 0), rows, unallocatedCents: remaining, totalAllocatedCents: rows.reduce((s, r) => s + r.allocatedCents, 0) };
  };
  const assessMonthlySavings = ({ incomeCents, fixedExpenseCents, fixedSavingCents, actualIncomeCents, actualExpenseCents, daysInMonth }) => {
    const income = Math.max(0, Math.round(incomeCents || 0));
    const fixedExpense = Math.max(0, Math.round(fixedExpenseCents || 0));
    const fixedSaving = Math.max(0, Math.round(fixedSavingCents || 0));
    const recommendedSavingCents = Math.max(fixedSaving, Math.ceil(income * 0.20));
    const plannedSavingsRate = income > 0 ? recommendedSavingCents / income : null;
    const actualSavingsCents = Math.round((actualIncomeCents || 0) - Math.max(0, actualExpenseCents || 0));
    const actualSavingsRate = actualIncomeCents > 0 ? actualSavingsCents / actualIncomeCents : null;
    const attainmentRate = recommendedSavingCents > 0 ? actualSavingsCents / recommendedSavingCents : null;
    const dailyLivingCents = Math.floor(Math.max(0, income - fixedExpense - recommendedSavingCents) / Math.max(1, daysInMonth || 30));
    let health = { level: 'unknown', label: '資料不足' };
    const issues = [];
    if (actualSavingsRate !== null) {
      if (actualSavingsRate < 0) health = { level: 'critical', label: '收支失衡' };
      else if (actualSavingsRate < 0.10) health = { level: 'risk', label: '偏低' };
      else if (actualSavingsRate < 0.20) health = { level: 'watch', label: '待改善' };
      else if (actualSavingsRate <= 0.40) health = { level: 'healthy', label: '健康' };
      else health = { level: 'strong', label: '充足' };
    }
    if (income <= 0) issues.push('尚無本月收入，無法判斷儲蓄率');
    if (actualSavingsCents < 0) issues.push('本月支出已高於收入');
    else if (actualSavingsRate !== null && actualSavingsRate < 0.10) issues.push('本月儲蓄率低於 10%，緩衝不足');
    else if (actualSavingsRate !== null && actualSavingsRate < 0.20) issues.push('本月儲蓄率尚未達到 20% 規劃基準');
    if (dailyLivingCents <= 0 && income > 0) issues.push('扣除固定支出與應儲蓄後，已無每日生活費空間');
    if (attainmentRate !== null && attainmentRate < 1) issues.push('本月儲蓄尚未達成建議金額');
    return { recommendedSavingCents, plannedSavingsRate, actualSavingsCents, actualSavingsRate, attainmentRate, dailyLivingCents, health, issues };
  };

  const assess = (p, now = new Date()) => {
    const checked = Validation.validateQuickPlan(p);
    if (!checked.valid) return { ok: false, errors: checked.errors };
    const monthlyExpense = p.monthlyEssentialExpenseCents + p.monthlyOtherExpenseCents;
    const monthlySurplus = p.monthlyNetIncomeCents - monthlyExpense;
    const savingsRate = p.monthlyNetIncomeCents > 0 ? monthlySurplus / p.monthlyNetIncomeCents : null;
    const emergencyMonths = p.monthlyEssentialExpenseCents > 0 ? p.liquidAssetsCents / p.monthlyEssentialExpenseCents : null;
    const emergencyTarget = p.monthlyEssentialExpenseCents * 6;
    const emergencyGap = Math.max(0, emergencyTarget - p.liquidAssetsCents);
    // 緊急預備金不可同時充當目標本金；只有超過六個月必要支出的部分可投入第一目標。
    const goalStartingAssets = Math.max(0, p.liquidAssetsCents - emergencyTarget);
    const months = monthsBetween(now, p.goalTargetMonth);
    const futureGoal = futureValue(p.goalAmountTodayCents, p.inflationAnnualRate, months);
    const monthlyGoalContribution = requiredMonthlyContribution(futureGoal, goalStartingAssets, p.nominalReturnAnnualRate, months);
    const contributionLoad = monthlySurplus > 0 ? monthlyGoalContribution / monthlySurplus : Infinity;
    const estimatedMonths = monthlySurplus > 0 ? Math.ceil(Math.max(0, futureGoal - goalStartingAssets) / monthlySurplus) : null;
    const completion = estimatedMonths === null ? null : addMonths(now.getFullYear(), now.getMonth() + 1, estimatedMonths);
    const realAnnualReturnRate = realRate(p.nominalReturnAnnualRate, p.inflationAnnualRate);

    const scenarios = [
      { key: 'favorable', label: '有利', inflation: Math.max(-0.99, p.inflationAnnualRate - 0.005), incomeFactor: 1, returnRate: p.nominalReturnAnnualRate + 0.02 },
      { key: 'base', label: '基準', inflation: p.inflationAnnualRate, incomeFactor: 1, returnRate: p.nominalReturnAnnualRate },
      { key: 'stress', label: '壓力', inflation: Math.min(0.20, p.inflationAnnualRate + 0.015), incomeFactor: 0.8, returnRate: 0 }
    ].map((s) => {
      const goal = futureValue(p.goalAmountTodayCents, s.inflation, months);
      const surplus = Math.round(p.monthlyNetIncomeCents * s.incomeFactor) - monthlyExpense;
      const need = requiredMonthlyContribution(goal, goalStartingAssets, s.returnRate, months);
      return { ...s, futureGoalCents: goal, monthlySurplusCents: surplus, monthlyRequiredCents: need, feasible: surplus >= need && surplus >= 0 };
    });

    const risks = [];
    if (monthlySurplus < 0) risks.push({ severity: 'high', code: 'NEGATIVE_CASHFLOW', text: '目前每月收支為負數' });
    if (emergencyMonths !== null && emergencyMonths < 3) risks.push({ severity: 'high', code: 'LOW_EMERGENCY', text: `緊急預備金僅可支應 ${emergencyMonths.toFixed(1)} 個月必要支出` });
    else if (emergencyMonths !== null && emergencyMonths < 6) risks.push({ severity: 'medium', code: 'EMERGENCY_BELOW_SIX', text: `緊急預備金未達 6 個月，仍差 ${emergencyGap} 分` });
    if (!Number.isFinite(contributionLoad) || contributionLoad > 1) risks.push({ severity: 'high', code: 'GOAL_INFEASIBLE', text: '目前月結餘不足以在期限內完成目標' });
    else if (contributionLoad > 0.8) risks.push({ severity: 'medium', code: 'GOAL_TIGHT', text: '目標提撥占月結餘超過 80%，緩衝有限' });
    if (!scenarios.find(s => s.key === 'stress').feasible) risks.push({ severity: 'medium', code: 'INCOME_STRESS', text: '收入下降 20% 且零報酬時，目標無法如期完成' });

    return { ok: true, monthlyExpense, monthlySurplus, savingsRate, emergencyMonths, emergencyTarget, emergencyGap, goalStartingAssets, monthsToGoal: months, futureGoal, monthlyGoalContribution, contributionLoad, estimatedMonths, completion, realAnnualReturnRate, scenarios, risks };
  };
  return { monthsBetween, futureValue, realRate, requiredMonthlyContribution, allocateMonthly, assessMonthlySavings, assess };
})();
