// money.js — 金額換算與計算引擎（帳本 + 成本試算 + 工時反推 共用）
// 設計原則：一律用整數「分」計算，避免浮點數誤差累積。
// v8 更新：匯率不再查共用設定表，改用每筆紀錄自帶的 currency + rateToTWD 手動換算。

const CURRENCY_UNITS = { TWD: '元', EUR: '€', JPY: '¥', USD: '$' };

const Money = (() => {
  const toCents = (yuan) => Math.round(Number(yuan) * 100);
  const toYuan = (cents) => cents / 100;

  // 幣別感知格式化：TWD 顯示「元」、EUR 顯示「€」...未知幣別直接顯示代碼，避免裸數字看不出單位
  const formatMoney = (cents, currency = 'TWD') => {
    const yuan = toYuan(cents);
    const sign = yuan < 0 ? '-' : '';
    const num = Math.abs(yuan).toLocaleString('zh-Hant-TW', { maximumFractionDigits: 2 });
    const unit = CURRENCY_UNITS[currency] || currency;
    return currency === 'EUR' || currency === 'USD' ? `${sign}${unit}${num}` : `${sign}${num}${unit}`;
  };
  // 向下相容別名（原本呼叫 formatTWD 的地方仍可用，等同 formatMoney(cents,'TWD')）
  const formatTWD = (cents) => formatMoney(cents, 'TWD');

  // 換算成台幣分：非台幣一律用該筆紀錄自己帶的 rateToTWD 換算，缺少匯率就丟出明確錯誤，不靜默出 NaN
  const toTWDCents = (amountCents, currency, rateToTWD) => {
    if (!currency || currency === 'TWD') return amountCents;
    if (rateToTWD === undefined || rateToTWD === null || Number.isNaN(rateToTWD)) {
      throw new Error(`幣別 ${currency} 缺少匯率，請先輸入這筆的「當下匯率」`);
    }
    return Math.round(amountCents * rateToTWD);
  };

  // 依 key 分組加總（key 可以是分類、帳戶、年月...），加總前一律先換算成台幣，避免混幣別直接相加
  const groupSum = (entries, keyFn, filterFn = () => true) => {
    const out = {};
    for (const e of entries) {
      if (!filterFn(e)) continue;
      const k = keyFn(e);
      if (k === null || k === undefined) continue;
      let twd;
      try {
        twd = toTWDCents(e.amountCents, e.currency, e.rateToTWD);
      } catch (err) {
        twd = 0; // 缺匯率的紀錄先跳過加總，畫面上另外會提示
      }
      out[k] = (out[k] || 0) + twd;
    }
    return out;
  };

  const sumItems = (items) => items.reduce((s, i) => s + i.amountCents, 0);

  // 反推驗證後的通膨公式：inflated = total * multiplier（單次直接相乘，非複利、不需要年數）
  // 驗證依據：買房 20,001,143 × 1.58 = 31,601,806（原表數字一致）
  //           買地自建 12,940,676 × 1.58 = 20,446,268（原表數字一致）
  //           旅費 55,300 × 1.3 = 71,890（原表數字一致）
  const applyInflation = (totalCents, multiplier) => Math.round(totalCents * multiplier);

  // 勞健保正推／反推：互為反函式，費率由使用者自填（不內建會過期的官方分級表）
  const grossToNet = (grossMonthlyCents, insuredSalaryCents, rates) => {
    const laborFee = Math.round(insuredSalaryCents * rates.laborInsuranceRate * rates.laborInsurancePersonalShare);
    const healthFee = Math.round(insuredSalaryCents * rates.healthInsuranceRate * rates.healthInsurancePersonalShare);
    return { laborFee, healthFee, net: grossMonthlyCents - laborFee - healthFee };
  };
  const netToGross = (targetNetCents, insuredSalaryCents, rates) => {
    const laborFee = Math.round(insuredSalaryCents * rates.laborInsuranceRate * rates.laborInsurancePersonalShare);
    const healthFee = Math.round(insuredSalaryCents * rates.healthInsuranceRate * rates.healthInsurancePersonalShare);
    return { laborFee, healthFee, gross: targetNetCents + laborFee + healthFee };
  };


  // 一次性情境（買房／買地自建／旅費／喪葬）
  const calcOneTimeScenario = (scenario, config) => {
    const total = sumItems(scenario.items);
    const multiplier = scenario.inflationKey ? (config.inflationMultipliers[scenario.inflationKey] ?? 1) : 1;
    const inflated = scenario.applyInflation ? applyInflation(total, multiplier) : total;
    const afterLoan = (scenario.loanAmountCents !== undefined && scenario.loanAmountCents !== null)
      ? total - scenario.loanAmountCents
      : null;
    const inflatedAfterLoan = (afterLoan !== null && scenario.applyInflation)
      ? applyInflation(afterLoan, multiplier)
      : afterLoan;
    const gap = (scenario.currentSavedCents !== undefined && scenario.currentSavedCents !== null)
      ? (scenario.applyInflation ? inflated : total) - scenario.currentSavedCents
      : null;

    const formulaText = scenario.applyInflation
      ? `通膨後總額 = 總額 × ${scenario.inflationKey}通膨倍數(${multiplier})\n` +
        `           = ${formatTWD(total)} × ${multiplier}\n` +
        `           = ${formatTWD(inflated)}`
      : `總額 = 各項目加總 = ${formatTWD(total)}（此情境未套用通膨）`;

    return { total, inflated, afterLoan, inflatedAfterLoan, gap, multiplier, formulaText };
  };

  // 養老金情境：總額 = 每月生活費 × 12 × (身故年齡－退休年齡)，可選套用通膨倍數
  const calcRetirementFundScenario = (scenario, config) => {
    const retirementYears = scenario.deathAge - scenario.retireAge;
    const baseTotal = scenario.monthlyLivingCostCents * 12 * retirementYears;
    const multiplier = scenario.inflationKey ? (config.inflationMultipliers[scenario.inflationKey] ?? 1) : 1;
    const inflated = scenario.applyInflation ? applyInflation(baseTotal, multiplier) : baseTotal;
    const gap = inflated - (scenario.currentSavedCents || 0);
    const formulaText =
      `退休後年數 = 身故年齡(${scenario.deathAge}) － 退休年齡(${scenario.retireAge}) = ${retirementYears} 年\n` +
      `養老所需總額 = 每月生活費 × 12 × 退休後年數\n` +
      `            = ${formatTWD(scenario.monthlyLivingCostCents)} × 12 × ${retirementYears}\n` +
      `            = ${formatTWD(baseTotal)}` +
      (scenario.applyInflation
        ? `\n通膨後總額 = ${formatTWD(baseTotal)} × ${multiplier} = ${formatTWD(inflated)}`
        : '') +
      `\n差額 = 通膨後總額 － 目前已存 = ${formatTWD(inflated)} － ${formatTWD(scenario.currentSavedCents || 0)} = ${formatTWD(gap)}`;
    return { retirementYears, baseTotal, inflated, gap, multiplier, formulaText };
  };

  // FIRE／財務獨立退休試算：逐步計算，每一步都已用原表數字驗證吻合
  // v8 更新：salaryType 切換稅前/稅後（透過勞健保函式換算一致）；retireAgeSolveMode 可切換成
  // 「已知薪資成長率，反推幾歲能退休」（同一組公式，解不同的未知數）
  const calcFireScenario = (scenario, config) => {
    const workingYearsLeft = scenario.retireAge - scenario.startAge;
    const retirementYears = scenario.deathAge - scenario.retireAge;
    const annualRetirementExpense = scenario.retirementMonthlyExpenseCents * 12;
    const retirementAssetTarget = Math.round(annualRetirementExpense / scenario.postRetirementAnnualReturnRate);
    const emergencyFundTotal = scenario.currentMonthlyExpenseCents * scenario.emergencyFundMonths;
    const totalNeededBeforeRetire = retirementAssetTarget + scenario.buyHouseGoalCents
      + scenario.studyAbroadFundCents + emergencyFundTotal;
    const totalFundingGap = totalNeededBeforeRetire - scenario.totalSavedCents;
    const totalExpenseBeforeRetire = scenario.currentMonthlyExpenseCents * 12 * workingYearsLeft;
    const totalIncomeNeeded = totalFundingGap + totalExpenseBeforeRetire;
    const requiredAvgMonthlySalaryNet = Math.round(totalIncomeNeeded / (workingYearsLeft * 12));
    // salaryType 一律在「淨額」這個共同基準上比較（因為支出是用淨收入支付的），
    // 只有要顯示「應有月薪」給人看、要對照薪資單時，才換算回使用者選擇的 salaryType
    const requiredAvgMonthlySalaryDisplay = scenario.salaryType === 'gross'
      ? netToGross(requiredAvgMonthlySalaryNet, scenario.insuredSalaryCents, config.insuranceRates).gross
      : requiredAvgMonthlySalaryNet;
    const currentSalaryNet = scenario.salaryType === 'gross'
      ? grossToNet(scenario.currentMonthlySalaryCents, scenario.insuredSalaryCents, config.insuranceRates).net
      : scenario.currentMonthlySalaryCents;
    // 防呆：投保薪資高於實際月薪時，換算出的淨薪可能是負數，此時「年成長率」在數學上無意義
    // （負數開非整數次方在實數範圍內無解），改回傳 null，畫面上顯示「無法計算」而不是 NaN%
    const impliedCAGR = currentSalaryNet > 0
      ? Math.pow(requiredAvgMonthlySalaryNet / currentSalaryNet, 1 / workingYearsLeft) - 1
      : null;
    const nextYearTargetSalary = Math.round(scenario.currentMonthlySalaryCents * (1 + scenario.assumedSalaryGrowthRate));

    // 月薪分配：一律以「稅後實拿淨薪」為基準分配，因為勞健保是先扣才發薪，
    // 稅前月薪你根本拿不到那筆錢，用稅前金額分配會高估實際可運用的錢。
    const allocationBaseNet = currentSalaryNet;
    const allocation = Object.entries(scenario.allocationPercents).map(([label, pct]) => ({
      label, pct, amountCents: Math.round(allocationBaseNet * pct)
    }));
    const allocationSumPct = Object.values(scenario.allocationPercents).reduce((s, p) => s + p, 0);

    let solvedRetireAge = null;
    if (scenario.retireAgeSolveMode === 'given_growth_rate') {
      solvedRetireAge = solveFireRetireAge(scenario, config);
    }

    const formulaText =
      `退休資產目標 = 退休後年支出 ÷ 退休後年化報酬率\n` +
      `            = (${formatTWD(scenario.retirementMonthlyExpenseCents)} × 12) ÷ ${scenario.postRetirementAnnualReturnRate}\n` +
      `            = ${formatTWD(retirementAssetTarget)}\n` +
      `退休前總需求資金 = 退休資產目標 + 買房目標 + 留學預備金 + 緊急儲備金總額\n` +
      `              = ${formatTWD(totalNeededBeforeRetire)}\n` +
      `尚欠總資金缺口 = 退休前總需求資金 － 目前已存 = ${formatTWD(totalFundingGap)}\n` +
      `往後總收入需求 = 尚欠總資金缺口 + 退休前總支出預估 = ${formatTWD(totalIncomeNeeded)}\n` +
      `往後應有平均月薪(淨) = 往後總收入需求 ÷ (剩餘工作年數 × 12) = ${formatTWD(requiredAvgMonthlySalaryNet)}\n` +
      (scenario.salaryType === 'gross'
        ? `往後應有平均月薪(稅前，含勞健保換算) = ${formatTWD(requiredAvgMonthlySalaryDisplay)}\n`
        : '') +
      (impliedCAGR !== null
        ? `理論所需年成長率 ≈ ${(impliedCAGR * 100).toFixed(2)}%（供對照，實際採用你設定的 ${(scenario.assumedSalaryGrowthRate * 100).toFixed(0)}%）\n`
        : `理論所需年成長率：無法計算（目前月薪換算成稅後淨薪後為負數，代表你填的「投保薪資」比實際月薪高很多，請檢查這兩個欄位是否合理）\n`) +
      `月薪分配基準 = 稅後實拿淨薪 = ${formatTWD(allocationBaseNet)}（分配是以「實際到手的錢」計算，不是稅前月薪，因為勞健保先扣才發薪，稅前金額你根本拿不到）` +
      (Math.abs(allocationSumPct - 1) > 0.001 ? `\n⚠ 目前分配比例加總為 ${(allocationSumPct * 100).toFixed(1)}%，不等於 100%，請調整` : '');

    return {
      workingYearsLeft, retirementYears, retirementAssetTarget, emergencyFundTotal,
      totalNeededBeforeRetire, totalFundingGap, totalExpenseBeforeRetire,
      requiredAvgMonthlySalary: requiredAvgMonthlySalaryDisplay, requiredAvgMonthlySalaryNet,
      impliedCAGR, nextYearTargetSalary, allocation, allocationBaseNet, allocationSumPct,
      solvedRetireAge, formulaText
    };
  };

  // 反推「幾歲能退休」：同一組正推公式，改用逐年疊代搜尋解「退休年齡」這個未知數。
  // 簡化假設：以目前薪水按 assumedSalaryGrowthRate 逐年成長，並假設固定比例（用 FIRE 分配裡的
  // 「投資提撥」比例）存下來，累積到能覆蓋當年度的退休資產目標時，即為可退休年齡。
  const solveFireRetireAge = (scenario, config) => {
    const investPct = scenario.allocationPercents['投資提撥（FIRE 基金）'] || 0.2;
    let accumulated = scenario.totalSavedCents;
    let salary = scenario.currentMonthlySalaryCents;
    for (let age = scenario.startAge + 1; age <= 70; age++) {
      salary = Math.round(salary * (1 + scenario.assumedSalaryGrowthRate));
      accumulated += Math.round(salary * investPct * 12);
      const target = calcFireScenario({ ...scenario, retireAge: age, retireAgeSolveMode: 'given_age' }, config)
        .retirementAssetTarget;
      if (accumulated >= target) return age;
    }
    return null; // 70 歲前都達不到
  };


  // 期別型情境（學貸）：itemTemplate 逐期套用，periods 內的 overrides 覆寫個別項目
  // v8 更新：期別可標記 isLeaveOfAbsence（休學），該期金額自動算 0 但仍保留在時間軸上顯示
  const calcPeriodScenario = (scenario) => {
    const periods = scenario.periods.map((p) => {
      if (p.isLeaveOfAbsence) {
        return { label: p.label, items: [], total: 0, isLeaveOfAbsence: true };
      }
      const items = scenario.itemTemplate.map((tpl) => {
        const override = p.overrides && Object.prototype.hasOwnProperty.call(p.overrides, tpl.label)
          ? p.overrides[tpl.label]
          : null;
        return { label: tpl.label, amountCents: override !== null ? override : tpl.amountCents };
      });
      const periodTotal = sumItems(items);
      return { label: p.label, items, total: periodTotal };
    });
    const grandTotal = periods.reduce((s, p) => s + p.total, 0);
    return { periods, grandTotal };
  };

  // 工時反推計算機：全站唯一實作，成本試算頁面的「自動提示」也是呼叫這個函式，不另外寫簡化公式。
  // 精度規則（已用「期望收益910,626」「學貸還款155,893」兩組真實數字重新驗證修正）：
  // 每一層要用「上一層無條件進位後的整數」往下除，是無條件進位（ceiling），不是四捨五入——
  // 例如 867.4 要進位成 868、542.125 要進位成 543，用 Math.round 會算錯，必須用 Math.ceil。
  const calcWageReverseChain = (targetAmountCents, chain) => {
    const steps = [];
    let current = targetAmountCents;
    for (const step of chain) {
      const raw = current / step.factor;
      const rounded = Math.ceil(raw);
      steps.push({ label: step.toLabel, raw, rounded });
      current = rounded; // 進位給下一層用「無條件進位後」的值，不是 raw
    }
    return steps;
  };

  const calcWageReverse = (scenario, config) => {
    const targetTWD = toTWDCents(scenario.targetAmountCents, scenario.currency, scenario.rateToTWD);
    const effectiveTarget = scenario.applyInsurance
      ? netToGross(targetTWD, scenario.insuredSalaryCents, config.insuranceRates).gross
      : targetTWD;
    const baseUnits = Math.ceil(effectiveTarget / scenario.baseRateCentsPerHour);
    const chain = calcWageReverseChain(baseUnits, scenario.conversionChain);
    const altChain = scenario.altChain ? calcWageReverseChain(baseUnits, scenario.altChain) : null;
    return { targetTWD, effectiveTarget, baseUnits, chain, altChain };
  };

  // 工時反推＋存款版雙提示（成本試算/願望清單各項目下方的「自動提示」都呼叫這個，唯讀顯示、不寫回資料）
  const calcAchievabilityHint = (amountCents, currency, rateToTWD, wageScenario, config) => {
    const twd = toTWDCents(amountCents, currency, rateToTWD);
    const wage = calcWageReverse({ ...wageScenario, targetAmountCents: twd, currency: 'TWD', rateToTWD: 1 }, config);
    const monthsViaSaving = config.personalBaseline.monthlySavingsCapacityCents > 0
      ? Math.round(twd / config.personalBaseline.monthlySavingsCapacityCents)
      : null;
    const ageAtCompletion = monthsViaSaving !== null
      ? Math.round((config.personalBaseline.currentAge + monthsViaSaving / 12) * 10) / 10
      : null;
    return { twd, hoursNeeded: wage.baseUnits, monthsViaSaving, ageAtCompletion };
  };


  const calcScenario = (scenario, config) => {
    const type = scenario.calcType || (scenario.periods ? 'periods' : 'items');
    if (type === 'periods') return calcPeriodScenario(scenario);
    if (type === 'retirement_fund') return calcRetirementFundScenario(scenario, config);
    if (type === 'fire') return calcFireScenario(scenario, config);
    return calcOneTimeScenario(scenario, config);
  };

  // 純 SVG 趨勢圖：月度支出長條 + 薪資折線，無任何第三方套件依賴
  const buildTrendChartSVG = (monthlyExpenseTWD, monthlySalaryTWD) => {
    const months = [...new Set([...Object.keys(monthlyExpenseTWD), ...Object.keys(monthlySalaryTWD)])].sort();
    if (months.length === 0) return '<svg viewBox="0 0 400 160"></svg>';
    const w = 400, h = 160, padding = 24;
    const values = months.flatMap((m) => [Math.abs(monthlyExpenseTWD[m] || 0), monthlySalaryTWD[m] || 0]);
    const maxV = Math.max(...values, 1);
    const barW = (w - padding * 2) / months.length * 0.6;
    const scaleY = (v) => h - padding - (Math.abs(v) / maxV) * (h - padding * 2);
    const stepX = (w - padding * 2) / Math.max(months.length - 1, 1);

    const bars = months.map((m, i) => {
      const x = padding + i * stepX - barW / 2;
      const val = Math.abs(monthlyExpenseTWD[m] || 0);
      const y = scaleY(val);
      return `<rect x="${x}" y="${y}" width="${barW}" height="${h - padding - y}" fill="var(--negative)" opacity="0.6"><title>${m} 支出 ${formatTWD(val)}</title></rect>`;
    }).join('');

    const points = months.map((m, i) => {
      const x = padding + i * stepX;
      const y = scaleY(monthlySalaryTWD[m] || 0);
      return `${x},${y}`;
    }).join(' ');

    const labels = months.map((m, i) => {
      const x = padding + i * stepX;
      return `<text x="${x}" y="${h - 4}" font-size="9" text-anchor="middle" fill="var(--ink-soft)">${m.slice(5)}</text>`;
    }).join('');

    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto">
      ${bars}
      <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2"/>
      ${labels}
    </svg>`;
  };

  return {
    toCents, toYuan, formatMoney, formatTWD, toTWDCents, groupSum, sumItems, applyInflation,
    grossToNet, netToGross, calcWageReverse, calcAchievabilityHint, calcScenario, buildTrendChartSVG
  };
})();
