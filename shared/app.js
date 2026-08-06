// app.js — 主應用邏輯（Tab 切換 + 帳本 + 成本試算）

const App = (() => {
  let config = structuredClone(DEFAULT_CONFIG);
  let ledger = structuredClone(DEFAULT_LEDGER);
  let scenarios = structuredClone(DEFAULT_SCENARIOS);
  let wageReverseScenario = structuredClone(WAGE_REVERSE_SCENARIO);
  let currentScenarioId = scenarios[0].scenarioId;
  let compareMode = false;
  const workspaceSnapshot = () => ({ config, ledger, scenarios, wageReverseScenario });
  const restoreWorkspace = (saved) => {
    if (!saved || typeof saved !== 'object') return false;
    if (saved.config && typeof saved.config === 'object') {
      config = { ...structuredClone(DEFAULT_CONFIG), ...saved.config, quickPlan: { ...structuredClone(DEFAULT_CONFIG.quickPlan), ...(saved.config.quickPlan || {}) }, personalBaseline: { ...structuredClone(DEFAULT_CONFIG.personalBaseline), ...(saved.config.personalBaseline || {}) }, insuranceRates: { ...structuredClone(DEFAULT_CONFIG.insuranceRates), ...(saved.config.insuranceRates || {}) } };
    }
    if (saved.ledger && Validation.validateLedger(saved.ledger).valid) ledger = saved.ledger;
    if (Array.isArray(saved.scenarios) && saved.scenarios.length) scenarios = saved.scenarios;
    if (saved.wageReverseScenario && typeof saved.wageReverseScenario === 'object') wageReverseScenario = { ...structuredClone(WAGE_REVERSE_SCENARIO), ...saved.wageReverseScenario };
    currentScenarioId = scenarios[0]?.scenarioId;
    return true;
  };
  const updateStorageStatus = ({ message, ok, lastSavedAt, bindingName }) => {
    const box = document.querySelector('#storage-status');
    const text = document.querySelector('#storage-status-text');
    if (box) box.classList.toggle('failed', !ok);
    if (text) text.textContent = message;
    const indicator = document.querySelector('#save-indicator');
    const indicatorText = document.querySelector('#save-indicator-text');
    if (indicator) indicator.classList.toggle('failed', !ok);
    if (indicatorText) indicatorText.textContent = lastSavedAt
      ? `上次保存 ${new Date(lastSavedAt).toLocaleString('zh-Hant-TW')}${bindingName ? `・已綁定 ${bindingName}` : '・Edge 本機'}`
      : message;
  };
  const createEntryId = () => globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const accountNatures = { checking: '活存／收支', savings: '儲蓄', cash: '現金', investment: '投資', credit: '信用／負債', earmarked: '專款' };
  const ensureAccountProfiles = () => {
    if (!Array.isArray(config.accountProfiles) || !config.accountProfiles.length) {
      const legacy = Array.isArray(config.accounts) ? config.accounts : [];
      config.accountProfiles = legacy.map((name, i) => ({ id: `legacy-${i + 1}`, name, nature: name === '現金' ? 'cash' : 'checking', initialBalanceCents: 0 }));
    }
    config.accounts = config.accountProfiles.map(a => a.name);
    for (const entry of ledger.entries || []) {
      const matched = config.accountProfiles.find(a => a.name === entry.account);
      if (matched) entry.account = matched.id;
    }
    for (const flow of config.recurringCashFlows || []) {
      const matched = config.accountProfiles.find(a => a.name === flow.accountId);
      if (matched) flow.accountId = matched.id;
      const fromMatched = config.accountProfiles.find(a => a.name === flow.fromAccountId);
      if (fromMatched) flow.fromAccountId = fromMatched.id;
    }
  };
  const accountName = (idOrName) => config.accountProfiles.find(a => a.id === idOrName || a.name === idOrName)?.name || idOrName || '—';
  const ensureSavingsAccount = (fromAccountId) => {
    let target = config.accountProfiles.find(a => a.id !== fromAccountId && ['savings', 'earmarked', 'investment'].includes(a.nature)) || config.accountProfiles.find(a => a.id !== fromAccountId);
    if (!target) {
      target = { id: createEntryId(), name: '儲蓄帳戶', nature: 'savings', initialBalanceCents: 0 };
      config.accountProfiles.push(target);
    }
    return target.id;
  };
  const recurringKinds = { salary: '正職薪資', part_time: '兼職薪資', freelance: '接案收入', other_income: '其他收入', fixed_expense: '固定支出' };
  const ensureDashboard = () => {
    const first = config.accountProfiles[0]?.id || null;
    config.dashboard = { scenarioSelections: {}, scenarioAccountMap: {}, scenarioTargetMonths: {}, ...(config.dashboard || {}) };
    for (const key of ['scenarioSelections', 'scenarioAccountMap', 'scenarioTargetMonths']) if (!config.dashboard[key] || typeof config.dashboard[key] !== 'object' || Array.isArray(config.dashboard[key])) config.dashboard[key] = {};
    for (const key of ['livingAccountId', 'fixedExpenseAccountId', 'emergencyAccountId']) {
      if (!config.accountProfiles.some(a => a.id === config.dashboard[key])) config.dashboard[key] = first;
    }
  };
  const getAccountBalances = () => {
    ensureAccountProfiles();
    const balances = Object.fromEntries(config.accountProfiles.map(a => [a.id, a.initialBalanceCents || 0]));
    for (const entry of ledger.entries) {
      if (entry.type === 'wishlist') continue;
      let amount;
      try { amount = Money.toTWDCents(entry.amountCents, entry.currency, entry.rateToTWD); } catch { continue; }
      if (entry.type === 'transfer') {
        balances[entry.fromAccount] = (balances[entry.fromAccount] || 0) - Math.abs(amount);
        balances[entry.toAccount] = (balances[entry.toAccount] || 0) + Math.abs(amount);
      } else if (entry.account) balances[entry.account] = (balances[entry.account] || 0) + amount;
    }
    return balances;
  };
  const scenarioTargetCents = (scenario) => {
    try {
      const r = Money.calcScenario(scenario, config);
      if (scenario.calcType === 'periods') return Math.max(0, r.grandTotal);
      if (scenario.calcType === 'retirement_fund') return Math.max(0, r.gap);
      if (scenario.calcType === 'fire') return Math.max(0, r.totalFundingGap);
      return Math.max(0, r.gap ?? r.inflatedAfterLoan ?? r.afterLoan ?? (scenario.applyInflation ? r.inflated : r.total));
    } catch { return 0; }
  };
  const currentMonthSavingsHealth = (now = new Date()) => {
    ensureAccountProfiles(); ensureDashboard();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const recurring = recurringSummary();
    const hasRecurringIncome = recurring.items.some(f => f.type === 'income');
    const plannedIncome = hasRecurringIncome ? recurring.incomeCents : config.quickPlan.monthlyNetIncomeCents;
    let actualIncome = 0, actualExpense = 0;
    for (const entry of ledger.entries) {
      if (!entry.date?.startsWith(ym)) continue;
      let amount;
      try { amount = Money.toTWDCents(entry.amountCents, entry.currency, entry.rateToTWD); } catch { continue; }
      if (entry.type === 'income') actualIncome += Math.max(0, amount);
      else if (entry.type === 'expense') actualExpense += Math.abs(amount);
    }
    const fixedExpense = recurring.essentialExpenseCents + recurring.otherExpenseCents;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const assessed = Planning.assessMonthlySavings({ incomeCents: plannedIncome, fixedExpenseCents: fixedExpense, fixedSavingCents: recurring.fixedSavingCents, actualIncomeCents: actualIncome, actualExpenseCents: actualExpense, daysInMonth });
    const balances = getAccountBalances();
    const emergencyGap = Math.max(0, config.quickPlan.monthlyEssentialExpenseCents * 6 - Math.max(0, balances[config.dashboard.emergencyAccountId] || 0));
    const rawEmergencyMonthly = Math.ceil(emergencyGap / 12);
    const savingsFlow = recurring.items.find(f => f.type === 'saving');
    const savingsAccountId = savingsFlow?.accountId || config.dashboard.emergencyAccountId;
    const sameAccount = savingsAccountId === config.dashboard.emergencyAccountId;
    const emergencyMonthlyCents = sameAccount ? Math.max(rawEmergencyMonthly, recurring.fixedSavingCents) : rawEmergencyMonthly;
    const committedSaving = sameAccount ? emergencyMonthlyCents : emergencyMonthlyCents + recurring.fixedSavingCents;
    const recommendedSavingCents = Math.max(Math.ceil(plannedIncome * 0.20), committedSaving);
    const savingBeyondEmergencyCents = Math.max(0, recommendedSavingCents - emergencyMonthlyCents);
    return { ...assessed, recommendedSavingCents, plannedSavingsRate: plannedIncome > 0 ? recommendedSavingCents / plannedIncome : null, attainmentRate: recommendedSavingCents > 0 ? assessed.actualSavingsCents / recommendedSavingCents : null, dailyLivingCents: Math.floor(Math.max(0, plannedIncome - fixedExpense - recommendedSavingCents) / daysInMonth), emergencyMonthlyCents, savingBeyondEmergencyCents, savingsAccountId };
  };
  const recurringSummary = () => Money.calcRecurringMonthly(config.recurringCashFlows || [], config.insuranceRates);
  const syncWageFromLinkedIncome = () => {
    const flows = (config.recurringCashFlows || []).filter(f => f.type === 'income' && f.active !== false);
    if ((!wageReverseScenario.linkedRecurringFlowId || wageReverseScenario.linkedRecurringFlowId === 'auto') && flows.length) wageReverseScenario.linkedRecurringFlowId = flows[0].id;
    const flow = flows.find(f => f.id === wageReverseScenario.linkedRecurringFlowId);
    if (!flow) return null;
    Object.assign(wageReverseScenario, Money.wageSettingsFromIncome(flow));
    return flow;
  };
  const materializeDueRecurringEntries = (now = new Date()) => {
    ensureAccountProfiles();
    if (!Array.isArray(config.recurringCashFlows)) config.recurringCashFlows = [];
    const year = now.getFullYear(), month = now.getMonth() + 1;
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const lastDay = new Date(year, month, 0).getDate();
    const summary = recurringSummary();
    for (const flow of summary.items) {
      const day = Math.min(Math.max(1, Math.trunc(flow.dayOfMonth || 1)), lastDay);
      if (now.getDate() < day) continue;
      const id = `recurring-${flow.id}-${ym}`;
      const isIncome = flow.type === 'income';
      if (!(flow.grossCents > 0)) continue;
      const isSaving = flow.type === 'saving';
      if (isSaving && (!flow.fromAccountId || flow.fromAccountId === flow.accountId)) continue;
      const entryData = isSaving ? {
        id, recurringFlowId: flow.id, date: `${ym}-${String(day).padStart(2, '0')}`,
        type: 'transfer', category: null, account: flow.fromAccountId, fromAccount: flow.fromAccountId, toAccount: flow.accountId,
        currency: 'TWD', rateToTWD: 1, amountCents: flow.grossCents, incomeSource: null,
        essential: null, reimbursable: false, status: 'realized', note: `${flow.name || '固定儲蓄'}（每月自動轉帳）`
      } : {
        id, recurringFlowId: flow.id, date: `${ym}-${String(day).padStart(2, '0')}`,
        type: flow.type, category: isIncome ? null : '固定支出', account: flow.accountId || config.accountProfiles[0]?.id || null,
        currency: 'TWD', rateToTWD: 1, amountCents: isIncome ? flow.netCents : -flow.grossCents,
        incomeSource: isIncome ? (recurringKinds[flow.kind] || flow.name || '其他') : null,
        essential: isIncome ? null : flow.essential !== false, reimbursable: false, status: 'realized',
        note: `${flow.name || recurringKinds[flow.kind] || '固定項目'}（每月自動入帳）`
      };
      const existing = ledger.entries.find(e => e.id === id);
      if (existing) Object.assign(existing, entryData);
      else ledger.entries.push(entryData);
      IO.markDirty();
    }
    if (config.recurringCashFlows.length) config.personalBaseline.monthlySavingsCapacityCents = summary.monthlySavingsCents;
  };

  // ---------- 共用小工具 ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue; // 避免 setAttribute(k, undefined) 被當成屬性存在
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) node.appendChild(c);
    return node;
  };
  const empty = () => document.createDocumentFragment();

  // ---------- Tab 切換 ----------
  const initTabs = () => {
    $$('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.tab-btn').forEach((b) => b.classList.remove('active'));
        $$('.tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        $(`#panel-${btn.dataset.tab}`).classList.add('active');
      });
    });
  };

  // ================= 少輸入財務健檢 =================
  const healthMoneyField = (label, key) => el('div', { class: 'field' }, [
    el('label', { text: label }),
    el('input', {
      type: 'number', min: '0', step: '1', value: Money.toYuan(config.quickPlan[key]),
      onchange: (ev) => { config.quickPlan[key] = Money.toCents(ev.target.value); IO.markDirty(); renderHealth(); }
    })
  ]);

  const renderAllocationDashboard = () => {
    const root = $('#allocation-dashboard');
    if (!root) return;
    ensureAccountProfiles(); ensureDashboard();
    const q = config.quickPlan;
    const recurring = recurringSummary();
    const balances = getAccountBalances();
    const hasRecurringIncome = recurring.items.some(f => f.type === 'income');
    const income = hasRecurringIncome ? recurring.incomeCents : q.monthlyNetIncomeCents;
    const fixedExpense = recurring.essentialExpenseCents + recurring.otherExpenseCents;
    const plannedLivingTotal = q.monthlyEssentialExpenseCents + q.monthlyOtherExpenseCents;
    const basicLiving = Math.max(0, plannedLivingTotal - fixedExpense);
    const emergencyBalance = Math.max(0, balances[config.dashboard.emergencyAccountId] || 0);
    const emergencyGap = Math.max(0, q.monthlyEssentialExpenseCents * 6 - emergencyBalance);
    const savingsHealth = currentMonthSavingsHealth();
    const goals = scenarios.filter(s => config.dashboard.scenarioSelections[s.scenarioId]).map(s => {
      const accountId = config.dashboard.scenarioAccountMap[s.scenarioId] || config.accountProfiles[0]?.id;
      const configuredMonth = config.dashboard.scenarioTargetMonths[s.scenarioId];
      const targetMonth = Validation.isValidMonth(configuredMonth) ? configuredMonth : q.goalTargetMonth;
      const months = Math.max(1, Planning.monthsBetween(new Date(), targetMonth));
      const target = scenarioTargetCents(s);
      const saved = Math.max(0, balances[accountId] || 0);
      return { key: s.scenarioId, label: s.label, accountId, targetMonth, months, targetCents: target, savedCents: saved, gapCents: Math.max(0, target - saved) };
    });
    const allocation = Planning.allocateMonthly({
      incomeCents: income, livingCents: basicLiving, fixedExpenseCents: fixedExpense, emergencyGapCents: emergencyGap,
      emergencyMonthlyCents: savingsHealth.emergencyMonthlyCents, savingCents: savingsHealth.savingBeyondEmergencyCents,
      livingAccountId: config.dashboard.livingAccountId, fixedExpenseAccountId: config.dashboard.fixedExpenseAccountId,
      emergencyAccountId: config.dashboard.emergencyAccountId, savingsAccountId: savingsHealth.savingsAccountId, goals
    });
    const accountSelect = (value, onchange) => el('select', { onchange }, config.accountProfiles.map(a => el('option', { value: a.id, text: a.name, selected: value === a.id ? 'selected' : undefined })));
    const requiredSettings = el('details', { class: 'compact-settings' }, [
      el('summary', { text: '必備分配帳戶' }),
      el('div', { class: 'toolbar' }, [
        el('label', {}, [document.createTextNode('基本生活　'), accountSelect(config.dashboard.livingAccountId, e => { config.dashboard.livingAccountId = e.target.value; IO.markDirty(); renderAllocationDashboard(); })]),
        el('label', {}, [document.createTextNode('固定支出　'), accountSelect(config.dashboard.fixedExpenseAccountId, e => { config.dashboard.fixedExpenseAccountId = e.target.value; IO.markDirty(); renderAllocationDashboard(); })]),
        el('label', {}, [document.createTextNode('緊急預備金　'), accountSelect(config.dashboard.emergencyAccountId, e => { config.dashboard.emergencyAccountId = e.target.value; IO.markDirty(); renderAllocationDashboard(); })])
      ])
    ]);
    const optionalGoals = el('details', { class: 'compact-settings' }, [
      el('summary', { text: `選擇成本目標（已選 ${goals.length}）` }),
      ...scenarios.map(s => {
        const selected = !!config.dashboard.scenarioSelections[s.scenarioId];
        const accountId = config.dashboard.scenarioAccountMap[s.scenarioId] || config.accountProfiles[0]?.id;
        const configuredMonth = config.dashboard.scenarioTargetMonths[s.scenarioId];
        const targetMonth = Validation.isValidMonth(configuredMonth) ? configuredMonth : q.goalTargetMonth;
        return el('div', { class: 'goal-picker' }, [
          el('label', {}, [el('input', { type: 'checkbox', checked: selected ? 'checked' : undefined, onchange: e => { config.dashboard.scenarioSelections[s.scenarioId] = e.target.checked; IO.markDirty(); renderAllocationDashboard(); } }), document.createTextNode(` ${s.label}`)]),
          selected ? accountSelect(accountId, e => { config.dashboard.scenarioAccountMap[s.scenarioId] = e.target.value; IO.markDirty(); renderAllocationDashboard(); }) : null,
          selected ? el('input', { type: 'month', value: targetMonth, onchange: e => { config.dashboard.scenarioTargetMonths[s.scenarioId] = e.target.value; IO.markDirty(); renderAllocationDashboard(); } }) : null
        ]);
      })
    ]);
    const selectedGoalLists = goals.length ? el('div', { class: 'selected-goals' }, goals.map(goal => {
      const scenario = scenarios.find(s => s.scenarioId === goal.key);
      const items = scenario?.items || scenario?.itemTemplate || [];
      return el('details', { class: 'compact-settings' }, [
        el('summary', { text: `${goal.label}清單・尚需 ${Money.formatTWD(goal.gapCents)}` }),
        items.length ? el('table', {}, [el('tbody', {}, items.map(item => el('tr', {}, [el('td', { text: item.label }), el('td', { class: 'mono', text: Money.formatTWD(item.amountCents) })])))]) : el('p', { class: 'notice', text: '此試算為固定公式型，詳細參數請至成本試算頁調整。' })
      ]);
    })) : el('div', { class: 'selected-goals' });
    root.innerHTML = '';
    root.append(
      el('div', { class: 'health-grid dashboard-summary' }, [
        el('div', { class: 'summary-block highlight' }, [el('h3', { text: '可分配月收入' }), el('p', { class: 'mono big', text: Money.formatTWD(income) }), el('p', { class: 'notice', text: hasRecurringIncome ? '由多份工作實領自動加總' : '沿用財務健檢收入' })]),
        el('div', { class: 'summary-block highlight' }, [el('h3', { text: '每月應儲蓄' }), el('p', { class: 'mono big', text: Money.formatTWD(savingsHealth.recommendedSavingCents) }), el('p', { class: 'notice', text: `規劃儲蓄率 ${savingsHealth.plannedSavingsRate === null ? '—' : (savingsHealth.plannedSavingsRate * 100).toFixed(1) + '%'}` })]),
        el('div', { class: 'summary-block highlight' }, [el('h3', { text: '每日可用生活費' }), el('p', { class: 'mono big', text: Money.formatTWD(savingsHealth.dailyLivingCents) }), el('p', { class: 'notice', text: '收入扣除固定支出與應儲蓄後計算' })]),
        el('div', { class: 'summary-block highlight' }, [el('h3', { text: '本月儲蓄率' }), el('p', { class: 'mono big', text: savingsHealth.actualSavingsRate === null ? '尚無資料' : `${(savingsHealth.actualSavingsRate * 100).toFixed(1)}%` }), el('p', { class: `notice health-${savingsHealth.health.level}`, text: `${savingsHealth.health.label}・達成率 ${savingsHealth.attainmentRate === null ? '—' : Math.max(0, savingsHealth.attainmentRate * 100).toFixed(0) + '%'}` })])
      ]),
      el('div', { class: 'table-scroll' }, [el('table', { class: 'allocation-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: '用途' }), el('th', { text: '搭配帳戶' }), el('th', { text: '每月需要' }), el('th', { text: '建議分配' }), el('th', { text: '狀態' })])]),
        el('tbody', {}, allocation.rows.map(r => el('tr', { class: r.shortfallCents > 0 ? 'allocation-short' : '' }, [
          el('td', {}, [document.createTextNode(r.label), r.required ? el('span', { class: 'badge', text: '必備' }) : null, !r.required ? el('div', { class: 'notice', text: `目標 ${Money.formatTWD(r.targetCents)}・帳戶已有 ${Money.formatTWD(r.savedCents)}・${r.targetMonth}` }) : null]),
          el('td', { text: accountName(r.accountId) }), el('td', { class: 'mono', text: Money.formatTWD(r.requestedCents) }),
          el('td', { class: 'mono', text: Money.formatTWD(r.allocatedCents) }),
          el('td', { class: r.shortfallCents > 0 ? 'neg' : '', text: r.shortfallCents > 0 ? `不足 ${Money.formatTWD(r.shortfallCents)}` : '足額' })
        ])))
      ])]),
      selectedGoalLists,
      savingsHealth.issues.length ? el('div', { class: 'savings-issues' }, [el('strong', { text: '本月問題點' }), el('ul', {}, savingsHealth.issues.map(issue => el('li', { text: issue })))]) : empty(),
      requiredSettings, optionalGoals,
      el('p', { class: 'notice', text: '此表會自動重算建議用途；不會連線或操作真實銀行帳戶。成本目標的已存金額取自所指定帳戶目前餘額。' })
    );
  };

  const renderHealth = () => {
    const form = $('#health-form');
    const resultRoot = $('#health-results');
    if (!form || !resultRoot) return;
    form.innerHTML = '';
    const q = config.quickPlan;
    renderAllocationDashboard();
    const recurringForHealth = recurringSummary();
    const hasRecurringIncome = recurringForHealth.items.some(f => f.type === 'income');
    const liquidBalances = getAccountBalances();
    const derivedLiquidAssets = config.accountProfiles.filter(a => ['cash', 'checking', 'savings', 'earmarked'].includes(a.nature)).reduce((sum, a) => sum + Math.max(0, liquidBalances[a.id] || 0), 0);
    const hasAccountAssets = derivedLiquidAssets > 0 || ledger.entries.length > 0;
    const derivedField = (label, cents, note) => el('div', { class: 'field' }, [el('label', { text: label }), el('span', { class: 'mono readonly-value', text: Money.formatTWD(cents) }), el('small', { class: 'notice', text: note })]);
    form.append(
      el('div', { class: 'field' }, [el('label', { text: '目前年齡' }), el('input', { type: 'number', min: '0', max: '120', value: q.currentAge, onchange: (e) => { q.currentAge = Number(e.target.value); IO.markDirty(); renderHealth(); } })]),
      hasRecurringIncome ? derivedField('每月稅後收入', recurringForHealth.incomeCents, '由固定收入自動帶入') : healthMoneyField('每月稅後收入（元）', 'monthlyNetIncomeCents'),
      healthMoneyField('每月必要支出（元）', 'monthlyEssentialExpenseCents'),
      healthMoneyField('每月其他支出（元）', 'monthlyOtherExpenseCents'),
      hasAccountAssets ? derivedField('可動用資產', derivedLiquidAssets, '由流動性帳戶餘額自動加總') : healthMoneyField('可動用資產（元）', 'liquidAssetsCents'),
      healthMoneyField('第一目標・今日金額（元）', 'goalAmountTodayCents'),
      el('div', { class: 'field' }, [el('label', { text: '目標月份' }), el('input', { type: 'month', value: q.goalTargetMonth, onchange: (e) => { q.goalTargetMonth = e.target.value; IO.markDirty(); renderHealth(); } })]),
      el('details', {}, [
        el('summary', { text: '進階假設（可選）' }),
        el('div', { class: 'field' }, [el('label', { text: '年通膨率' }), el('input', { type: 'number', step: '0.001', value: q.inflationAnnualRate, onchange: (e) => { q.inflationAnnualRate = Number(e.target.value); IO.markDirty(); renderHealth(); } })]),
        el('div', { class: 'field' }, [el('label', { text: '名目年報酬率' }), el('input', { type: 'number', step: '0.001', value: q.nominalReturnAnnualRate, onchange: (e) => { q.nominalReturnAnnualRate = Number(e.target.value); IO.markDirty(); renderHealth(); } })]),
        el('p', { class: 'notice', text: `${REFERENCE_DATA.twInflation.source}；資料日 ${REFERENCE_DATA.twInflation.observedThrough}。預設值可手動覆寫。` })
      ])
    );
    const effectivePlan = { ...q, monthlyNetIncomeCents: hasRecurringIncome ? recurringForHealth.incomeCents : q.monthlyNetIncomeCents, liquidAssetsCents: hasAccountAssets ? derivedLiquidAssets : q.liquidAssetsCents };
    const result = Planning.assess(effectivePlan);
    resultRoot.innerHTML = '';
    if (!result.ok) {
      resultRoot.append(el('h3', { text: '請修正輸入' }), el('ul', {}, result.errors.map(e => el('li', { class: 'neg', text: e.message }))));
      return;
    }
    const pct = (v) => v === null ? '無法計算' : `${(v * 100).toFixed(1)}%`;
    resultRoot.append(
      el('h3', { text: '健檢結果' }),
      el('div', { class: 'health-grid' }, [
        el('div', { class: 'summary-block highlight' }, [el('h3', { text: '每月結餘' }), el('p', { class: 'mono big', text: Money.formatTWD(result.monthlySurplus) }), el('p', { text: `儲蓄率 ${pct(result.savingsRate)}` })]),
        el('div', { class: 'summary-block highlight' }, [el('h3', { text: '緊急預備金' }), el('p', { class: 'mono big', text: result.emergencyMonths === null ? '無法計算' : `${result.emergencyMonths.toFixed(1)} 個月` }), el('p', { text: `距6個月目標差 ${Money.formatTWD(result.emergencyGap)}` })]),
        el('div', { class: 'summary-block highlight' }, [el('h3', { text: '第一目標' }), el('p', { class: 'mono big', text: Money.formatTWD(result.futureGoal) }), el('p', { text: `每月至少提撥 ${Money.formatTWD(result.monthlyGoalContribution)}` })]),
        el('div', { class: 'summary-block highlight' }, [el('h3', { text: '實質報酬假設' }), el('p', { class: 'mono big', text: pct(result.realAnnualReturnRate) }), el('p', { text: '由名目報酬扣除通膨影響' })])
      ]),
      el('h3', { text: '固定情境' }),
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [el('th', { text: '情境' }), el('th', { text: '通膨後目標' }), el('th', { text: '月結餘' }), el('th', { text: '每月所需' }), el('th', { text: '結果' })])]),
        el('tbody', {}, result.scenarios.map(s => el('tr', {}, [el('td', { text: s.label }), el('td', { class: 'mono', text: Money.formatTWD(s.futureGoalCents) }), el('td', { class: 'mono', text: Money.formatTWD(s.monthlySurplusCents) }), el('td', { class: 'mono', text: Money.formatTWD(s.monthlyRequiredCents) }), el('td', { class: s.feasible ? '' : 'neg', text: s.feasible ? '可行' : '無法如期' })])))
      ]),
      el('h3', { text: '主要風險' }),
      result.risks.length ? el('ul', {}, result.risks.map(r => el('li', { class: r.severity === 'high' ? 'neg' : '', text: r.text }))) : el('p', { text: '目前固定檢查未發現高風險；仍須定期更新收入、支出與假設。' })
    );
  };

  let lastRateByCurrency = {}; // session 記憶，不持久化

  // ================= 帳本 Tab =================
  const renderLedgerForm = () => {
    ensureAccountProfiles();
    const wrap = $('#ledger-form');
    wrap.innerHTML = '';
    const typeSel = el('select', { id: 'f-type' }, [
      el('option', { value: 'expense', text: '支出' }),
      el('option', { value: 'income', text: '收入' }),
      el('option', { value: 'transfer', text: '帳戶轉帳' }),
      el('option', { value: 'wishlist', text: '願望清單' })
    ]);
    const dateInput = el('input', { type: 'date', id: 'f-date', value: new Date().toISOString().slice(0, 10) });
    const catSel = el('select', { id: 'f-category' },
      config.categories.map((c) => el('option', { value: c, text: c })));
    const accSel = el('select', { id: 'f-account' },
      config.accountProfiles.map((a) => el('option', { value: a.id, text: `${a.name}（${accountNatures[a.nature] || a.nature}）` })));
    const toAccSel = el('select', { id: 'f-to-account' },
      config.accountProfiles.map((a) => el('option', { value: a.id, text: `${a.name}（${accountNatures[a.nature] || a.nature}）` })));
    const amountInput = el('input', { type: 'number', id: 'f-amount', step: '1', placeholder: '金額（原始幣別，支出可留正數，系統自動處理正負號）' });
    const currencySel = el('select', { id: 'f-currency' }, [
      el('option', { value: 'TWD', text: 'TWD 台幣' }),
      el('option', { value: 'EUR', text: 'EUR 歐元' }),
      el('option', { value: 'JPY', text: 'JPY 日圓' }),
      el('option', { value: 'USD', text: 'USD 美元' })
    ]);
    const rateInput = el('input', { type: 'number', id: 'f-rate', step: '0.0001', placeholder: '當下匯率（1 單位 = ? 台幣）' });
    const rateField = el('div', { class: 'field', id: 'f-rate-field' }, [el('label', { text: '台幣匯率' }), rateInput]);
    rateField.style.display = 'none';
    currencySel.addEventListener('change', () => {
      const c = currencySel.value;
      if (c === 'TWD') { rateField.style.display = 'none'; }
      else { rateField.style.display = ''; rateInput.value = lastRateByCurrency[c] || ''; }
    });

    const incomeSourceSel = el('select', { id: 'f-income-source' }, [
      el('option', { value: '薪資', text: '薪資' }),
      el('option', { value: '接案', text: '接案' }),
      el('option', { value: '其他', text: '其他' })
    ]);
    const incomeSourceField = el('div', { class: 'field', id: 'f-income-source-field' }, [el('label', { text: '收入來源' }), incomeSourceSel]);

    const essentialChk = el('label', {}, [
      el('input', { type: 'checkbox', id: 'f-essential', checked: 'checked' }), document.createTextNode(' 必要支出')
    ]);
    const reimbChk = el('label', {}, [
      el('input', { type: 'checkbox', id: 'f-reimb' }), document.createTextNode(' 可報銷')
    ]);
    const noteInput = el('input', { type: 'text', id: 'f-note', placeholder: '備註' });
    const addBtn = el('button', { class: 'btn primary', text: '新增紀錄', onclick: addEntry });

    const catField = el('div', { class: 'field', id: 'f-category-field' }, [el('label', { text: '分類' }), catSel]);
    const accField = el('div', { class: 'field', id: 'f-account-field' }, [el('label', { text: '帳戶' }), accSel]);
    const toAccField = el('div', { class: 'field', id: 'f-to-account-field' }, [el('label', { text: '轉入帳戶' }), toAccSel]);

    typeSel.addEventListener('change', () => {
      const t = typeSel.value;
      catField.style.display = (t === 'income' || t === 'transfer') ? 'none' : '';
      accField.style.display = t === 'wishlist' ? 'none' : '';
      accField.querySelector('label').textContent = t === 'transfer' ? '轉出帳戶' : '帳戶';
      toAccField.style.display = t === 'transfer' ? '' : 'none';
      $('#f-essential-field').style.display = t === 'expense' ? '' : 'none';
      $('#f-reimb-field').style.display = t === 'expense' ? '' : 'none';
      incomeSourceField.style.display = t === 'income' ? '' : 'none';
    });

    wrap.append(
      el('div', { class: 'field' }, [el('label', { text: '類型' }), typeSel]),
      el('div', { class: 'field' }, [el('label', { text: '日期' }), dateInput]),
      catField, accField, toAccField,
      el('div', { class: 'field' }, [el('label', { text: '幣別' }), currencySel]),
      el('div', { class: 'field' }, [el('label', { text: '金額' }), amountInput]),
      rateField,
      incomeSourceField,
      el('div', { class: 'field', id: 'f-essential-field' }, [essentialChk]),
      el('div', { class: 'field', id: 'f-reimb-field' }, [reimbChk]),
      el('div', { class: 'field wide' }, [el('label', { text: '備註' }), noteInput]),
      addBtn
    );
    accField.style.display = '';
    toAccField.style.display = 'none';
    incomeSourceField.style.display = 'none';
  };

  const addEntry = () => {
    const type = $('#f-type').value;
    const rawAmount = Number($('#f-amount').value || 0);
    if (!rawAmount) { alert('請輸入金額'); return; }
    const currency = $('#f-currency').value;
    let rateToTWD = 1;
    if (currency !== 'TWD') {
      rateToTWD = Number($('#f-rate').value || 0);
      if (!rateToTWD) { alert('請輸入這筆的當下匯率'); return; }
      lastRateByCurrency[currency] = rateToTWD;
    }
    const amountYuan = type === 'expense' ? -Math.abs(rawAmount) : Math.abs(rawAmount);
    if (type === 'transfer' && $('#f-account').value === $('#f-to-account').value) { alert('轉出與轉入帳戶不可相同'); return; }
    const entry = {
      id: createEntryId(),
      date: $('#f-date').value,
      type,
      category: type === 'income' ? null : $('#f-category').value,
      account: type === 'wishlist' ? null : $('#f-account').value,
      fromAccount: type === 'transfer' ? $('#f-account').value : null,
      toAccount: type === 'transfer' ? $('#f-to-account').value : null,
      currency, rateToTWD,
      amountCents: Money.toCents(amountYuan),
      incomeSource: type === 'income' ? $('#f-income-source').value : null,
      essential: type === 'expense' ? $('#f-essential').checked : null,
      reimbursable: type === 'expense' ? $('#f-reimb').checked : null,
      status: type === 'wishlist' ? 'want' : 'realized',
      note: $('#f-note').value
    };
    ledger.entries.push(entry);
    IO.markDirty();
    $('#f-amount').value = '';
    $('#f-note').value = '';
    renderLedger();
  };

  const deleteEntry = (id) => {
    ledger.entries = ledger.entries.filter((e) => e.id !== id);
    IO.markDirty();
    renderLedger();
  };

  const renderLedgerList = () => {
    const body = $('#ledger-table-body');
    body.innerHTML = '';
    const sorted = [...ledger.entries].sort((a, b) => (a.date < b.date ? 1 : -1));
    for (const e of sorted) {
      const typeLabel = { expense: '支出', income: '收入', wishlist: '願望', transfer: '轉帳' }[e.type];
      const currency = e.currency || 'TWD';
      const twdEquivalent = (() => {
        try { return Money.toTWDCents(e.amountCents, e.currency, e.rateToTWD); }
        catch (err) { return null; }
      })();
      const amountCell = twdEquivalent !== null && currency !== 'TWD'
        ? el('td', {}, [
            el('div', { class: e.amountCents < 0 ? 'neg mono' : 'mono', text: Money.formatMoney(e.amountCents, currency) }),
            el('div', { class: 'mono notice', text: '≈ ' + Money.formatMoney(twdEquivalent, 'TWD') })
          ])
        : el('td', { class: e.amountCents < 0 ? 'neg mono' : 'mono', text: Money.formatMoney(e.amountCents, currency) });
      body.appendChild(el('tr', {}, [
        el('td', { text: e.date }),
        el('td', { text: typeLabel + (e.type === 'income' && e.incomeSource ? `（${e.incomeSource}）` : '') }),
        el('td', { text: e.type === 'transfer' ? `${accountName(e.fromAccount)} → ${accountName(e.toAccount)}` : ([e.category, e.account ? accountName(e.account) : null].filter(Boolean).join('／') || '—') }),
        amountCell,
        el('td', { text: e.type === 'expense' ? (e.essential ? '必要' : '非必要') : '—' }),
        el('td', { text: e.type === 'expense' ? (e.reimbursable ? '可報銷' : '—') : '—' }),
        el('td', { text: e.note || '' }),
        el('td', {}, [el('button', { class: 'btn small danger', text: '刪除', onclick: () => deleteEntry(e.id) })])
      ]));
    }
  };

  const renderLedgerSummary = () => {
    const box = $('#ledger-summary');
    box.innerHTML = '';
    const ledgerCheck = Validation.validateLedger(ledger);
    if (!ledgerCheck.valid) {
      box.append(el('h3', { class: 'neg', text: '帳本資料無法安全加總' }), el('ul', {}, ledgerCheck.errors.map(e => el('li', { class: 'neg', text: `${e.path}：${e.message}` }))));
      return;
    }

    // 換算成台幣後才能加總，避免不同幣別的原始金額直接相加（先前修正過的重點原則）
    const twd = (e) => { try { return Money.toTWDCents(e.amountCents, e.currency, e.rateToTWD); } catch (err) { return 0; } };

    const balancesById = getAccountBalances();
    const byAccount = Object.fromEntries(config.accountProfiles.map(a => [a.name, balancesById[a.id] || 0]));
    const byMonth = Money.groupSum(ledger.entries, (e) => e.date?.slice(0, 7), (e) => e.type !== 'wishlist' && e.type !== 'transfer');
    const nonEssential = ledger.entries.filter((e) => e.type === 'expense' && e.essential === false)
      .reduce((s, e) => s + twd(e), 0);
    const reimbursable = ledger.entries.filter((e) => e.type === 'expense' && e.reimbursable)
      .reduce((s, e) => s + twd(e), 0);
    const income = ledger.entries.filter((e) => e.type === 'income').reduce((s, e) => s + twd(e), 0);
    const expense = ledger.entries.filter((e) => e.type === 'expense').reduce((s, e) => s + twd(e), 0);
    const available = income + expense;
    const savingsHealth = currentMonthSavingsHealth();
    const expenseAverages = Money.calcExpenseAverages(ledger.entries);

    const table = (title, obj, limits) => {
      const rows = Object.entries(obj).map(([k, v]) => {
        const limit = limits && limits[k];
        const over = limit !== undefined && Math.abs(v) > limit;
        return el('tr', {}, [
          el('td', { text: k }),
          el('td', { class: 'mono' + (over ? ' over' : ''), text: Money.formatTWD(v) }),
          el('td', { text: limit !== undefined ? Money.formatTWD(limit) : '—' })
        ]);
      });
      return el('div', { class: 'summary-block' }, [
        el('h3', { text: title }),
        el('table', {}, [el('tbody', {}, rows)])
      ]);
    };

    const byMonthExpense = Money.groupSum(ledger.entries, (e) => e.date?.slice(0, 7), (e) => e.type === 'expense');
    const byMonthSalary = Money.groupSum(ledger.entries, (e) => e.date?.slice(0, 7), (e) => e.type === 'income');
    const trendSVG = Money.buildTrendChartSVG(byMonthExpense, byMonthSalary);

    const trendBlock = el('div', { class: 'summary-block' }, [
      el('h3', { text: '趨勢總覽（紅色長條＝月支出，綠線＝月收入）' })
    ]);
    const trendChartHolder = el('div', {});
    trendChartHolder.innerHTML = trendSVG;
    trendBlock.appendChild(trendChartHolder);
    const expenseAverageBlock = el('div', { class: 'summary-block' }, [
      el('h3', { text: `分類花費分析・平均 ${expenseAverages.monthCount} 個月` }),
      el('p', { class: 'notice', text: '平均月份從第一筆支出到最後一筆支出連續計算，包含期間內沒有消費的月份；占比以全部支出為分母。' }),
      expenseAverages.rows.length ? el('div', { class: 'table-scroll' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, [el('th', { text: '分類' }), el('th', { text: '累計花費' }), el('th', { text: '平均每月' }), el('th', { text: '占全部支出' }), el('th', { text: '月預算上限' })])]),
        el('tbody', {}, expenseAverages.rows.map(row => {
          const limit = config.budgetLimitsCents[row.label];
          const over = limit !== undefined && row.monthlyAverageCents > limit;
          return el('tr', {}, [el('td', { text: row.label }), el('td', { class: 'mono', text: Money.formatTWD(row.totalCents) }), el('td', { class: `mono${over ? ' over' : ''}`, text: Money.formatTWD(row.monthlyAverageCents) }), el('td', { class: 'mono', text: `${(row.share * 100).toFixed(1)}%` }), el('td', { class: 'mono', text: limit !== undefined ? Money.formatTWD(limit) : '—' })]);
        }))
      ])]) : el('p', { class: 'notice', text: '尚無支出資料。' })
    ]);

    box.append(
      el('div', { class: 'health-grid' }, [
        el('div', { class: 'summary-block highlight' }, [el('h3', { text: '本月實際儲蓄' }), el('p', { class: 'mono big', text: Money.formatTWD(savingsHealth.actualSavingsCents) })]),
        el('div', { class: 'summary-block highlight' }, [el('h3', { text: '本月儲蓄率' }), el('p', { class: 'mono big', text: savingsHealth.actualSavingsRate === null ? '尚無收入' : `${(savingsHealth.actualSavingsRate * 100).toFixed(1)}%` }), el('p', { class: `notice health-${savingsHealth.health.level}`, text: savingsHealth.health.label })]),
        el('div', { class: 'summary-block highlight' }, [el('h3', { text: '月儲蓄達成率' }), el('p', { class: 'mono big', text: savingsHealth.attainmentRate === null ? '—' : `${Math.max(0, savingsHealth.attainmentRate * 100).toFixed(0)}%` }), el('p', { class: 'notice', text: `應儲蓄 ${Money.formatTWD(savingsHealth.recommendedSavingCents)}` })])
      ]),
      el('div', { class: 'summary-block highlight' }, [
        el('h3', { text: '總覽' }),
        el('p', {}, [document.createTextNode('可動用資金：'), el('span', { class: 'mono big', text: Money.formatTWD(available) })]),
        el('p', {}, [document.createTextNode('非必要支出總額：'), el('span', { class: 'mono', text: Money.formatTWD(nonEssential) })]),
        el('p', {}, [document.createTextNode('可報銷總額：'), el('span', { class: 'mono', text: Money.formatTWD(reimbursable) })])
      ]),
      expenseAverageBlock,
      table('各帳戶目前餘額（起始餘額＋收入－支出）', byAccount, null),
      table('月度彙總', byMonth, null),
      trendBlock
    );
  };

  const renderPersonalSettings = () => {
    const box = $('#personal-settings');
    if (!box) return;
    ensureAccountProfiles();
    box.innerHTML = '';
    const numField = (label, value, onchange) => el('div', { class: 'field' }, [
      el('label', { text: label }),
      el('input', { type: 'number', class: 'mono', value, onchange: (ev) => onchange(Number(ev.target.value)) })
    ]);
    const accountRows = config.accountProfiles.map((account) => {
      const used = ledger.entries.some(e => e.account === account.id || e.account === account.name || e.fromAccount === account.id || e.toAccount === account.id) || (config.recurringCashFlows || []).some(f => f.accountId === account.id || f.fromAccountId === account.id);
      return el('div', { class: 'toolbar account-row' }, [
        el('div', { class: 'field' }, [el('label', { text: '帳戶名稱' }), el('input', { value: account.name, onchange: (ev) => { const name = ev.target.value.trim(); if (name) { account.name = name; IO.markDirty(); renderLedgerForm(); renderLedger(); } } })]),
        el('div', { class: 'field' }, [el('label', { text: '性質' }), el('select', { onchange: (ev) => { account.nature = ev.target.value; IO.markDirty(); renderLedger(); } }, Object.entries(accountNatures).map(([value, text]) => el('option', { value, text, selected: account.nature === value ? 'selected' : undefined })))]),
        numField('起始餘額（元）', Money.toYuan(account.initialBalanceCents || 0), (v) => { account.initialBalanceCents = Money.toCents(v); IO.markDirty(); renderLedger(); }),
        el('button', { class: 'btn small danger', text: used ? '已有紀錄' : '刪除', disabled: used ? 'disabled' : undefined, onclick: () => { config.accountProfiles = config.accountProfiles.filter(a => a.id !== account.id); IO.markDirty(); renderPersonalSettings(); renderLedgerForm(); renderLedger(); } })
      ]);
    });
    const accountManager = el('details', {}, [
      el('summary', { text: '帳戶管理（名稱、性質、起始餘額）' }),
      ...accountRows,
      el('button', { class: 'btn small', text: '＋新增帳戶', onclick: () => { config.accountProfiles.push({ id: createEntryId(), name: `新帳戶 ${config.accountProfiles.length + 1}`, nature: 'checking', initialBalanceCents: 0 }); IO.markDirty(); renderPersonalSettings(); renderLedgerForm(); renderLedger(); } }),
      el('p', { class: 'notice', text: '收入與支出都會計入指定帳戶；已有交易的帳戶不可直接刪除，以免餘額失去歸屬。' })
    ]);
    if (!Array.isArray(config.recurringCashFlows)) config.recurringCashFlows = [];
    const saveFlow = () => { materializeDueRecurringEntries(); IO.markDirty(); renderPersonalSettings(); renderLedger(); };
    const flowRows = config.recurringCashFlows.map(flow => {
      const isIncome = flow.type === 'income';
      const isSaving = flow.type === 'saving';
      const summaryItem = recurringSummary().items.find(x => x.id === flow.id);
      return el('div', { class: 'card' }, [
        el('div', { class: 'toolbar' }, [
          el('label', {}, [el('input', { type: 'checkbox', checked: flow.active !== false ? 'checked' : undefined, onchange: (ev) => { flow.active = ev.target.checked; saveFlow(); } }), document.createTextNode(' 啟用')]),
          el('div', { class: 'field' }, [el('label', { text: '名稱' }), el('input', { value: flow.name || '', onchange: (ev) => { flow.name = ev.target.value.trim(); saveFlow(); } })]),
          el('div', { class: 'field' }, [el('label', { text: '類型' }), el('select', { onchange: (ev) => { flow.type = ev.target.value; flow.kind = flow.type === 'income' ? 'salary' : (flow.type === 'saving' ? 'fixed_saving' : 'fixed_expense'); saveFlow(); } }, [el('option', { value: 'income', text: '固定收入', selected: isIncome ? 'selected' : undefined }), el('option', { value: 'expense', text: '固定支出', selected: flow.type === 'expense' ? 'selected' : undefined }), el('option', { value: 'saving', text: '固定儲蓄', selected: isSaving ? 'selected' : undefined })])]),
          isIncome ? el('div', { class: 'field' }, [el('label', { text: '收入性質' }), el('select', { onchange: (ev) => { flow.kind = ev.target.value; saveFlow(); } }, Object.entries(recurringKinds).filter(([k]) => k !== 'fixed_expense').map(([value, text]) => el('option', { value, text, selected: flow.kind === value ? 'selected' : undefined })))]) : null,
          numField(isIncome ? '月總工資／收入（元）' : (isSaving ? '每月儲蓄（元）' : '每月金額（元）'), Money.toYuan(flow.amountCents || 0), (v) => { flow.amountCents = Money.toCents(Math.abs(v)); saveFlow(); }),
          numField(isIncome ? '發薪日' : (isSaving ? '轉存日' : '扣款日'), flow.dayOfMonth || 1, (v) => { flow.dayOfMonth = Math.min(31, Math.max(1, Math.trunc(v))); saveFlow(); }),
          isSaving ? el('div', { class: 'field' }, [el('label', { text: '轉出帳戶' }), el('select', { onchange: (ev) => { flow.fromAccountId = ev.target.value; saveFlow(); } }, config.accountProfiles.map(a => el('option', { value: a.id, text: a.name, selected: flow.fromAccountId === a.id ? 'selected' : undefined })))]) : null,
          el('div', { class: 'field' }, [el('label', { text: isSaving ? '儲蓄帳戶' : '入／扣款帳戶' }), el('select', { onchange: (ev) => { flow.accountId = ev.target.value; saveFlow(); } }, config.accountProfiles.map(a => el('option', { value: a.id, text: a.name, selected: flow.accountId === a.id ? 'selected' : undefined })))])
        ]),
        isIncome ? el('div', { class: 'toolbar' }, [
          numField('每月工時', flow.monthlyWorkHours || 160, (v) => { if (v > 0) { flow.monthlyWorkHours = v; saveFlow(); } }),
          el('label', {}, [el('input', { type: 'checkbox', checked: flow.applyInsurance ? 'checked' : undefined, onchange: (ev) => { flow.applyInsurance = ev.target.checked; saveFlow(); } }), document.createTextNode(' 此收入扣勞健保')]),
          flow.applyInsurance ? el('label', {}, [el('input', { type: 'checkbox', checked: flow.insuredSalaryFollowsGross !== false ? 'checked' : undefined, onchange: (ev) => { flow.insuredSalaryFollowsGross = ev.target.checked; saveFlow(); } }), document.createTextNode(' 投保薪資同此收入')]) : null,
          flow.applyInsurance && flow.insuredSalaryFollowsGross === false ? numField('投保薪資（元）', Money.toYuan(flow.insuredSalaryCents || flow.amountCents || 0), (v) => { flow.insuredSalaryCents = Money.toCents(v); saveFlow(); }) : null,
          summaryItem ? el('p', { class: 'notice', text: `自動時薪 ${Money.formatTWD(summaryItem.payroll.hourlyRateCents)}；本項每月實入 ${Money.formatTWD(summaryItem.netCents)}` }) : null
        ]) : isSaving ? el('p', { class: 'linked-note', text: '固定儲蓄會建立帳戶間轉帳，不列入收入或支出。' }) : el('label', {}, [el('input', { type: 'checkbox', checked: flow.essential !== false ? 'checked' : undefined, onchange: (ev) => { flow.essential = ev.target.checked; saveFlow(); } }), document.createTextNode(' 必要固定支出')]),
        el('button', { class: 'btn small danger', text: '刪除固定項目', onclick: () => { config.recurringCashFlows = config.recurringCashFlows.filter(f => f.id !== flow.id); IO.markDirty(); renderPersonalSettings(); } })
      ]);
    });
    const monthly = recurringSummary();
    const binding = IO.getBindingInfo();
    const fileBindingManager = el('details', {}, [
      el('summary', { text: '保存與工作區檔案綁定' }),
      el('div', { class: 'toolbar file-binding-row' }, [
        el('span', { class: 'file-binding-name', text: binding.name ? `目前綁定：${binding.name}` : '目前未綁定實體檔案' }),
        el('button', { class: 'btn small', text: binding.name ? '改綁其他檔案' : '綁定／建立工作區檔案', disabled: binding.supported ? undefined : 'disabled', onclick: async () => {
          try { await IO.bindWorkspaceFile(); renderPersonalSettings(); }
          catch (err) { if (err.name !== 'AbortError') alert(err.message); }
        } }),
        binding.name ? el('button', { class: 'btn small', text: '立即同步', onclick: async () => { await IO.saveBoundFile({ requestPermission: true }); } }) : null,
        binding.name ? el('button', { class: 'btn small danger', text: '解除綁定', onclick: async () => { await IO.unbindWorkspaceFile(); renderPersonalSettings(); } }) : null
      ]),
      el('p', { class: 'notice', text: binding.supported ? '每次修改會先保存到 Edge 本機，再於約 1 秒後同步到綁定 JSON。重新開啟瀏覽器時若權限失效，按「立即同步」重新授權即可。' : '目前瀏覽器不支援直接綁定檔案；仍可使用完整工作區 JSON 匯出備份。' })
    ]);
    const recurringManager = el('details', { open: 'open' }, [
      el('summary', { text: '每月固定出入帳（正職／兼職／接案／固定支出）' }),
      el('div', { class: 'health-grid' }, [
        el('div', { class: 'summary-block' }, [el('h3', { text: '每月固定收入' }), el('p', { class: 'mono big', text: Money.formatTWD(monthly.incomeCents) })]),
        el('div', { class: 'summary-block' }, [el('h3', { text: '每月固定支出' }), el('p', { class: 'mono big', text: Money.formatTWD(monthly.essentialExpenseCents + monthly.otherExpenseCents) })]),
        el('div', { class: 'summary-block' }, [el('h3', { text: '每月固定儲蓄' }), el('p', { class: 'mono big', text: Money.formatTWD(monthly.fixedSavingCents) })]),
        el('div', { class: 'summary-block' }, [el('h3', { text: '每月固定淨現金流' }), el('p', { class: 'mono big', text: Money.formatTWD(monthly.monthlySavingsCents) })])
      ]),
      ...flowRows,
      el('div', { class: 'toolbar' }, [
        el('button', { class: 'btn small', text: '＋新增收入來源', onclick: () => { config.recurringCashFlows.push({ id: createEntryId(), name: '新收入', type: 'income', kind: 'salary', amountCents: 0, dayOfMonth: 5, accountId: config.accountProfiles[0]?.id, monthlyWorkHours: 160, applyInsurance: true, insuredSalaryFollowsGross: true, active: true }); IO.markDirty(); renderPersonalSettings(); } }),
        el('button', { class: 'btn small', text: '＋新增固定支出', onclick: () => { config.recurringCashFlows.push({ id: createEntryId(), name: '新固定支出', type: 'expense', kind: 'fixed_expense', amountCents: 0, dayOfMonth: 1, accountId: config.accountProfiles[0]?.id, essential: true, active: true }); IO.markDirty(); renderPersonalSettings(); } }),
        el('button', { class: 'btn small', text: '＋新增固定儲蓄', onclick: () => { const from = config.accountProfiles[0]?.id; const to = ensureSavingsAccount(from); config.recurringCashFlows.push({ id: createEntryId(), name: '固定儲蓄', type: 'saving', kind: 'fixed_saving', amountCents: 0, dayOfMonth: 6, fromAccountId: from, accountId: to, active: true }); IO.markDirty(); renderPersonalSettings(); renderLedgerForm(); } })
      ]),
      el('p', { class: 'notice', text: '到設定日期後，系統會為當月自動建立一次帳目；同一固定項目同月不會重複。每項收入可獨立選擇是否扣勞健保。' })
    ]);
    box.append(
      fileBindingManager,
      recurringManager,
      accountManager,
      el('details', {}, [
        el('summary', { text: '個人參數設定（勞健保費率與存款能力）' }),
        el('div', { class: 'toolbar' }, [
          numField('目前年齡', config.personalBaseline.currentAge, (v) => { config.personalBaseline.currentAge = v; IO.markDirty(); renderAll(); }),
          config.recurringCashFlows.length
            ? el('div', { class: 'field' }, [el('label', { text: '每月固定淨現金流（自動）' }), el('span', { class: 'mono', text: Money.formatTWD(config.personalBaseline.monthlySavingsCapacityCents) })])
            : numField('每月可存（尚未設定固定出入帳）', Money.toYuan(config.personalBaseline.monthlySavingsCapacityCents), (v) => { config.personalBaseline.monthlySavingsCapacityCents = Money.toCents(v); IO.markDirty(); renderAll(); }),
          numField('勞保費率', config.insuranceRates.laborInsuranceRate, (v) => { config.insuranceRates.laborInsuranceRate = v; IO.markDirty(); renderAll(); }),
          numField('勞保個人負擔比例', config.insuranceRates.laborInsurancePersonalShare, (v) => { config.insuranceRates.laborInsurancePersonalShare = v; IO.markDirty(); renderAll(); }),
          numField('健保費率', config.insuranceRates.healthInsuranceRate, (v) => { config.insuranceRates.healthInsuranceRate = v; IO.markDirty(); renderAll(); }),
          numField('健保個人負擔比例', config.insuranceRates.healthInsurancePersonalShare, (v) => { config.insuranceRates.healthInsurancePersonalShare = v; IO.markDirty(); renderAll(); })
        ]),
        el('p', { class: 'notice', text: config.insuranceRates.note })
      ])
    );
  };

  const renderLedger = () => {
    renderLedgerList();
    renderLedgerSummary();
    renderHealth();
  };

  const renderAll = () => {
    renderLedger();
    renderEstimator();
    renderWageReverse();
    renderPersonalSettings();
  };

  // ================= 成本試算 Tab =================
  const currentScenario = () => scenarios.find((s) => s.scenarioId === currentScenarioId);

  const renderScenarioSelector = () => {
    const sel = $('#scenario-select');
    sel.innerHTML = '';
    scenarios.forEach((s) => sel.appendChild(el('option', { value: s.scenarioId, text: s.label })));
    sel.value = currentScenarioId;
    sel.addEventListener('change', () => { currentScenarioId = sel.value; renderEstimator(); });
  };

  // 自動提示：呼叫工時反推引擎正式函式（唯一計算來源，不另寫簡化公式）+ 存款版估算
  const renderAchievabilityBlock = (amountCents, currency = 'TWD', rateToTWD = 1) => {
    if (!amountCents || amountCents <= 0) return null;
    syncWageFromLinkedIncome();
    const hint = Money.calcAchievabilityHint(amountCents, currency, rateToTWD, wageReverseScenario, config);
    const lines = [
      el('p', { class: 'notice' }, [
        document.createTextNode(`以目前連動時薪換算，約需工作 ${hint.hoursNeeded.toLocaleString()} 小時　`),
        el('button', {
          class: 'btn small', text: '帶入工時反推',
          onclick: () => {
            wageReverseScenario.targetAmountCents = hint.twd;
            wageReverseScenario.currency = 'TWD'; wageReverseScenario.rateToTWD = 1;
            IO.markDirty();
            $$('.tab-btn').forEach((b) => b.classList.remove('active'));
            $$('.tab-panel').forEach((p) => p.classList.remove('active'));
            $('.tab-btn[data-tab="wage"]').classList.add('active');
            $('#panel-wage').classList.add('active');
            renderWageReverse();
          }
        })
      ]),
      hint.monthsViaSaving !== null
        ? el('p', { class: 'notice', text: `以每月可存 ${Money.formatTWD(config.personalBaseline.monthlySavingsCapacityCents)} 估算，約需 ${hint.monthsViaSaving} 個月，預計 ${hint.ageAtCompletion} 歲可達成` })
        : el('p', { class: 'notice', text: '尚未設定每月可存金額，無法估算存款版達成時間。' })
    ];
    return el('div', { class: 'achievability' }, lines);
  };

  const renderOneTimeScenario = (scenario) => {
    const root = $('#estimator-body');
    const result = Money.calcScenario(scenario, config);

    const itemRows = scenario.items.map((item, idx) => el('tr', {}, [
      el('td', {}, [el('input', {
        type: 'text', value: item.label, class: 'mono',
        onchange: (ev) => { item.label = ev.target.value; IO.markDirty(); }
      })]),
      el('td', {}, [el('input', {
        type: 'number', value: Money.toYuan(item.amountCents), class: 'mono',
        onchange: (ev) => { item.amountCents = Money.toCents(ev.target.value); IO.markDirty(); renderEstimator(); }
      })]),
      el('td', {}, [el('button', {
        class: 'btn small danger', text: '刪除',
        onclick: () => { scenario.items.splice(idx, 1); IO.markDirty(); renderEstimator(); }
      })])
    ]));

    root.innerHTML = '';
    const targetForHint = result.gap !== null ? result.gap : (scenario.applyInflation ? result.inflated : result.total);
    root.append(
      el('table', { class: 'items-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: '項目' }), el('th', { text: '金額（元）' }), el('th', { text: '' })])]),
        el('tbody', {}, itemRows)
      ]),
      el('button', {
        class: 'btn small', text: '＋新增項目',
        onclick: () => { scenario.items.push({ label: '新項目', amountCents: 0 }); IO.markDirty(); renderEstimator(); }
      }),
      scenario.currentSavedCents !== undefined ? el('div', { class: 'field' }, [
        el('label', { text: '目前已存金額（元）' }),
        el('input', {
          type: 'number', value: Money.toYuan(scenario.currentSavedCents),
          onchange: (ev) => { scenario.currentSavedCents = Money.toCents(ev.target.value); IO.markDirty(); renderEstimator(); }
        })
      ]) : empty(),
      el('div', { class: 'result-block' }, [
        el('p', {}, [document.createTextNode('總額：'), el('span', { class: 'mono big', text: Money.formatTWD(result.total) })]),
        scenario.applyInflation ? el('p', {}, [document.createTextNode('通膨後總額：'), el('span', { class: 'mono big', text: Money.formatTWD(result.inflated) })]) : null,
        result.afterLoan !== null ? el('p', {}, [document.createTextNode('貸後金額：'), el('span', { class: 'mono', text: Money.formatTWD(result.afterLoan) })]) : null,
        result.inflatedAfterLoan !== null ? el('p', {}, [document.createTextNode('通膨後貸後金額：'), el('span', { class: 'mono', text: Money.formatTWD(result.inflatedAfterLoan) })]) : null,
        result.gap !== null ? el('p', {}, [document.createTextNode('與目前已存差額：'), el('span', { class: result.gap > 0 ? 'mono neg' : 'mono', text: Money.formatTWD(result.gap) })]) : null,
        el('details', {}, [
          el('summary', { text: '顯示算式' }),
          el('pre', { class: 'formula', text: result.formulaText })
        ])
      ]),
      renderAchievabilityBlock(targetForHint)
    );
  };

  const renderPeriodScenario = (scenario) => {
    const root = $('#estimator-body');
    const result = Money.calcScenario(scenario, config);
    root.innerHTML = '';
    root.append(
      el('p', { class: 'notice', text: '此情境為期別型（如學貸），每期套用同一組項目範本，個別期別可覆寫單一項目金額。可標記某期為休學，該期金額自動算 0。' }),
      el('details', {}, [
        el('summary', { text: '編輯共用欄目' }),
        el('table', {}, [el('tbody', {}, scenario.itemTemplate.map((item, itemIndex) => el('tr', {}, [
          el('td', {}, [el('input', { value: item.label, onchange: e => { const old = item.label; item.label = e.target.value.trim() || old; scenario.periods.forEach(p => { if (p.overrides && Object.prototype.hasOwnProperty.call(p.overrides, old)) { p.overrides[item.label] = p.overrides[old]; delete p.overrides[old]; } }); IO.markDirty(); renderEstimator(); } })]),
          el('td', {}, [el('input', { type: 'number', value: Money.toYuan(item.amountCents), onchange: e => { item.amountCents = Money.toCents(e.target.value); IO.markDirty(); renderEstimator(); } })]),
          el('td', {}, [el('button', { class: 'btn small danger', text: '刪除', onclick: () => { scenario.itemTemplate.splice(itemIndex, 1); IO.markDirty(); renderEstimator(); } })])
        ])))]),
        el('button', { class: 'btn small', text: '＋新增欄目', onclick: () => { scenario.itemTemplate.push({ label: '新欄目', amountCents: 0 }); IO.markDirty(); renderEstimator(); } })
      ]),
      ...result.periods.map((p, idx) => el('div', { class: 'period-block' + (p.isLeaveOfAbsence ? ' leave' : '') }, [
        el('h4', {}, [
          el('input', { value: p.label, onchange: e => { scenario.periods[idx].label = e.target.value.trim() || p.label; IO.markDirty(); renderEstimator(); } }),
          el('label', { class: 'inline-check' }, [
            el('input', {
              type: 'checkbox', checked: p.isLeaveOfAbsence ? 'checked' : undefined,
              onchange: (ev) => { scenario.periods[idx].isLeaveOfAbsence = ev.target.checked; IO.markDirty(); renderEstimator(); }
            }),
            document.createTextNode(' 標記為休學')
          ]),
          el('button', { class: 'btn small danger', text: '刪除此期', onclick: () => { scenario.periods.splice(idx, 1); IO.markDirty(); renderEstimator(); } })
        ]),
        p.isLeaveOfAbsence
          ? el('p', { class: 'notice', text: '休學期間，不計入學費' })
          : el('table', {}, [el('tbody', {}, p.items.map((i) => el('tr', {}, [
              el('td', { text: i.label }), el('td', { class: 'mono', text: Money.formatTWD(i.amountCents) })
            ])))]),
        el('p', {}, [document.createTextNode('本期小計：'), el('span', { class: 'mono', text: Money.formatTWD(p.total) })])
      ])),
      el('button', { class: 'btn small', text: '＋新增期別', onclick: () => { scenario.periods.push({ label: `新期別 ${scenario.periods.length + 1}`, overrides: {} }); IO.markDirty(); renderEstimator(); } }),
      el('div', { class: 'result-block' }, [
        el('p', {}, [document.createTextNode('全期合計：'), el('span', { class: 'mono big', text: Money.formatTWD(result.grandTotal) })])
      ]),
      renderAchievabilityBlock(result.grandTotal)
    );
  };

  const numField = (label, value, onchange) => el('div', { class: 'field' }, [
    el('label', { text: label }),
    el('input', { type: 'number', class: 'mono', value, onchange: (ev) => onchange(Number(ev.target.value)) })
  ]);

  const renderRetirementFundScenario = (scenario) => {
    const root = $('#estimator-body');
    const result = Money.calcScenario(scenario, config);
    root.innerHTML = '';
    root.append(
      el('div', { class: 'toolbar' }, [
        numField('目前年齡', scenario.currentAge, (v) => { scenario.currentAge = v; IO.markDirty(); renderEstimator(); }),
        numField('預計退休年齡', scenario.retireAge, (v) => { scenario.retireAge = v; IO.markDirty(); renderEstimator(); }),
        numField('預計身故年齡', scenario.deathAge, (v) => { scenario.deathAge = v; IO.markDirty(); renderEstimator(); }),
        numField('每月生活費（元）', Money.toYuan(scenario.monthlyLivingCostCents), (v) => { scenario.monthlyLivingCostCents = Money.toCents(v); IO.markDirty(); renderEstimator(); }),
        numField('目前已存（元）', Money.toYuan(scenario.currentSavedCents || 0), (v) => { scenario.currentSavedCents = Money.toCents(v); IO.markDirty(); renderEstimator(); })
      ]),
      scenario.referenceNote ? el('p', { class: 'notice', text: scenario.referenceNote }) : empty(),
      el('div', { class: 'result-block' }, [
        el('p', {}, [document.createTextNode('退休後年數：'), el('span', { class: 'mono', text: result.retirementYears + ' 年' })]),
        el('p', {}, [document.createTextNode('養老所需總額：'), el('span', { class: 'mono big', text: Money.formatTWD(result.inflated) })]),
        el('p', {}, [document.createTextNode('與目前已存差額：'), el('span', { class: result.gap > 0 ? 'mono neg' : 'mono', text: Money.formatTWD(result.gap) })]),
        el('details', {}, [el('summary', { text: '顯示算式' }), el('pre', { class: 'formula', text: result.formulaText })])
      ]),
      renderAchievabilityBlock(result.gap)
    );
  };

  const renderFireScenario = (scenario) => {
    const root = $('#estimator-body');
    let result;
    try { result = Money.calcScenario(scenario, config); }
    catch (err) { root.innerHTML = ''; root.append(el('p', { class: 'neg', text: err.message })); return; }
    root.innerHTML = '';
    root.append(
      el('div', { class: 'toolbar' }, [
        numField('開始工作年紀', scenario.startAge, (v) => { scenario.startAge = v; IO.markDirty(); renderEstimator(); }),
        numField('預計退休年紀', scenario.retireAge, (v) => { scenario.retireAge = v; IO.markDirty(); renderEstimator(); }),
        numField('預期壽命', scenario.deathAge, (v) => { scenario.deathAge = v; IO.markDirty(); renderEstimator(); }),
        numField('目前月薪（元）', Money.toYuan(scenario.currentMonthlySalaryCents), (v) => { scenario.currentMonthlySalaryCents = Money.toCents(v); IO.markDirty(); renderEstimator(); }),
        numField('目前月支出（元）', Money.toYuan(scenario.currentMonthlyExpenseCents), (v) => { scenario.currentMonthlyExpenseCents = Money.toCents(v); IO.markDirty(); renderEstimator(); }),
        numField('退休後月支出（元）', Money.toYuan(scenario.retirementMonthlyExpenseCents), (v) => { scenario.retirementMonthlyExpenseCents = Money.toCents(v); IO.markDirty(); renderEstimator(); }),
        numField('退休後年化報酬率', scenario.postRetirementAnnualReturnRate, (v) => { scenario.postRetirementAnnualReturnRate = v; IO.markDirty(); renderEstimator(); }),
        numField('目前已存總額（元）', Money.toYuan(scenario.totalSavedCents), (v) => { scenario.totalSavedCents = Money.toCents(v); IO.markDirty(); renderEstimator(); }),
        numField('假設薪資年成長率', scenario.assumedSalaryGrowthRate, (v) => { scenario.assumedSalaryGrowthRate = v; IO.markDirty(); renderEstimator(); }),
        numField('退休前名目年報酬率', scenario.preRetirementAnnualReturnRate || 0, (v) => { scenario.preRetirementAnnualReturnRate = v; IO.markDirty(); renderEstimator(); }),
        numField('投保薪資（元，供勞健保換算）', Money.toYuan(scenario.insuredSalaryCents), (v) => { scenario.insuredSalaryCents = Money.toCents(v); IO.markDirty(); renderEstimator(); })
      ]),
      el('div', { class: 'toolbar' }, [
        el('label', {}, [
          document.createTextNode('薪資基準：'),
          el('select', {
            onchange: (ev) => { scenario.salaryType = ev.target.value; IO.markDirty(); renderEstimator(); }
          }, [
            el('option', { value: 'gross', text: '稅前（毛薪）', selected: scenario.salaryType === 'gross' ? 'selected' : undefined }),
            el('option', { value: 'net', text: '稅後（淨薪）', selected: scenario.salaryType === 'net' ? 'selected' : undefined })
          ])
        ]),
        el('label', {}, [
          document.createTextNode('反推模式：'),
          el('select', {
            onchange: (ev) => { scenario.retireAgeSolveMode = ev.target.value; IO.markDirty(); renderEstimator(); }
          }, [
            el('option', { value: 'given_age', text: '已知退休年齡→算應有月薪', selected: scenario.retireAgeSolveMode === 'given_age' ? 'selected' : undefined }),
            el('option', { value: 'given_growth_rate', text: '已知薪資成長率→反推退休年齡', selected: scenario.retireAgeSolveMode === 'given_growth_rate' ? 'selected' : undefined })
          ])
        ])
      ]),
      el('div', { class: 'result-block' }, [
        el('p', {}, [document.createTextNode('退休資產目標：'), el('span', { class: 'mono big', text: Money.formatTWD(result.retirementAssetTarget) })]),
        el('p', {}, [document.createTextNode('退休前總需求資金：'), el('span', { class: 'mono', text: Money.formatTWD(result.totalNeededBeforeRetire) })]),
        el('p', {}, [document.createTextNode('尚欠總資金缺口：'), el('span', { class: 'mono neg', text: Money.formatTWD(result.totalFundingGap) })]),
        el('p', {}, [document.createTextNode('往後應有平均月薪：'), el('span', { class: 'mono big', text: Money.formatTWD(result.requiredAvgMonthlySalary) })]),
        el('p', {}, [document.createTextNode('明年應有月薪目標（依你設定的成長率）：'), el('span', { class: 'mono', text: Money.formatTWD(result.nextYearTargetSalary) })]),
        scenario.retireAgeSolveMode === 'given_growth_rate' ? el('p', {}, [
          document.createTextNode('以此薪資成長率反推，預計可退休年齡：'),
          el('span', { class: 'mono big', text: result.solvedRetireAge ? result.solvedRetireAge + ' 歲' : '70 歲前無法達成（請調整假設）' })
        ]) : empty(),
        el('details', {}, [el('summary', { text: '顯示算式' }), el('pre', { class: 'formula', text: result.formulaText })])
      ]),
      el('div', { class: 'card' }, [
        el('h3', { text: '目前月薪分配建議（以稅後實拿淨薪為基準）' }),
        el('p', { class: 'notice', text: `分配基準（稅後淨薪）：${Money.formatTWD(result.allocationBaseNet)}　｜　比例加總：${(result.allocationSumPct * 100).toFixed(1)}%${Math.abs(result.allocationSumPct - 1) > 0.001 ? '　｜　未達 100%，建議調整' : '　｜　已完整分配'}` }),
        el('table', {}, [
          el('thead', {}, [el('tr', {}, [el('th', { text: '項目' }), el('th', { text: '比例（可編輯）' }), el('th', { text: '金額' })])]),
          el('tbody', {}, result.allocation.map((a) => el('tr', {}, [
            el('td', { text: a.label }),
            el('td', {}, [el('input', {
              type: 'number', step: '0.01', class: 'mono', value: a.pct,
              onchange: (ev) => {
                scenario.allocationPercents[a.label] = Number(ev.target.value);
                IO.markDirty(); renderEstimator();
              }
            }), document.createTextNode(' (' + (a.pct * 100).toFixed(0) + '%)')]),
            el('td', { class: 'mono', text: Money.formatTWD(a.amountCents) })
          ])))
        ]),
        el('p', { class: 'notice', text: '這些預設比例只是起始值，建議對照帳本「成本試算」分頁的分類支出小計或月度彙總的實際數字，手動調整成符合你真實固定開銷的比例，讓分配貼近實際狀況。' })
      ])
    );
  };

  const renderCompare = () => {
    const root = $('#estimator-body');
    const house = scenarios.find((s) => s.scenarioId === 'buy_house');
    const build = scenarios.find((s) => s.scenarioId === 'self_build');
    if (!house || !build) { root.textContent = '找不到買房或買地自建情境可供比較。'; return; }
    const rh = Money.calcScenario(house, config);
    const rb = Money.calcScenario(build, config);
    root.innerHTML = '';
    root.append(el('table', { class: 'compare-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: '項目' }), el('th', { text: house.label }), el('th', { text: build.label })])]),
      el('tbody', {}, [
        el('tr', {}, [el('td', { text: '總額' }), el('td', { class: 'mono', text: Money.formatTWD(rh.total) }), el('td', { class: 'mono', text: Money.formatTWD(rb.total) })]),
        el('tr', {}, [el('td', { text: '通膨後總額' }), el('td', { class: 'mono', text: Money.formatTWD(rh.inflated) }), el('td', { class: 'mono', text: Money.formatTWD(rb.inflated) })]),
        el('tr', {}, [el('td', { text: '貸後金額' }), el('td', { class: 'mono', text: Money.formatTWD(rh.afterLoan) }), el('td', { class: 'mono', text: Money.formatTWD(rb.afterLoan) })]),
        el('tr', {}, [el('td', { text: '通膨後貸後金額' }), el('td', { class: 'mono', text: Money.formatTWD(rh.inflatedAfterLoan) }), el('td', { class: 'mono', text: Money.formatTWD(rb.inflatedAfterLoan) })])
      ])
    ]));
  };

  const renderEstimator = () => {
    if (compareMode) { renderCompare(); renderAllocationDashboard(); return; }
    const scenario = currentScenario();
    if (!scenario) return;
    const type = scenario.calcType || (scenario.periods ? 'periods' : 'items');
    if (type === 'periods') renderPeriodScenario(scenario);
    else if (type === 'retirement_fund') renderRetirementFundScenario(scenario);
    else if (type === 'fire') renderFireScenario(scenario);
    else renderOneTimeScenario(scenario);
    renderAllocationDashboard();
  };

  const initEstimatorControls = () => {
    renderScenarioSelector();
    $('#compare-toggle').addEventListener('change', (ev) => { compareMode = ev.target.checked; renderEstimator(); });
  };

  // ================= 工時反推 Tab =================
  const renderWageReverse = () => {
    const root = $('#wage-body');
    if (!root) return;
    const s = wageReverseScenario;
    const incomeFlows = (config.recurringCashFlows || []).filter(f => f.type === 'income' && f.active !== false);
    if ((!s.linkedRecurringFlowId || s.linkedRecurringFlowId === 'auto') && incomeFlows.length) s.linkedRecurringFlowId = incomeFlows[0].id;
    else if (!incomeFlows.length && s.linkedRecurringFlowId === 'auto') s.linkedRecurringFlowId = 'custom';
    let linkedFlow = incomeFlows.find(f => f.id === s.linkedRecurringFlowId);
    if (s.linkedRecurringFlowId !== 'custom' && !linkedFlow) s.linkedRecurringFlowId = 'custom';
    linkedFlow = syncWageFromLinkedIncome();
    if (!Number.isFinite(s.grossMonthlySalaryCents)) s.grossMonthlySalaryCents = s.insuredSalaryCents || 0;
    if (!Number.isFinite(s.monthlyWorkHours) || s.monthlyWorkHours <= 0) s.monthlyWorkHours = 160;
    if (s.insuredSalaryFollowsGross === undefined) s.insuredSalaryFollowsGross = false;
    if (s.insuredSalaryFollowsGross) s.insuredSalaryCents = s.grossMonthlySalaryCents;
    const payroll = Money.calcPayroll(s.grossMonthlySalaryCents, s.monthlyWorkHours, s.insuredSalaryCents, config.insuranceRates);
    s.baseRateCentsPerHour = payroll.hourlyRateCents;
    const result = Money.calcWageReverse(s, config);

    root.innerHTML = '';
    root.append(
      el('div', { class: 'card' }, [
        el('div', { class: 'section-heading' }, [el('div', {}, [el('h3', { text: '收入來源與時薪' }), el('p', { class: 'notice', text: '選擇既有收入即可自動沿用；只有自訂模式需要輸入。' })])]),
        el('div', { class: 'field source-field' }, [
          el('label', { text: '使用收入來源' }),
          el('select', { onchange: e => { s.linkedRecurringFlowId = e.target.value; IO.markDirty(); renderWageReverse(); } }, [
            ...incomeFlows.map(f => el('option', { value: f.id, text: `${f.name || recurringKinds[f.kind]}・${Money.formatTWD(f.amountCents)}`, selected: s.linkedRecurringFlowId === f.id ? 'selected' : undefined })),
            el('option', { value: 'custom', text: '自訂收入', selected: s.linkedRecurringFlowId === 'custom' ? 'selected' : undefined })
          ])
        ]),
        linkedFlow ? el('p', { class: 'linked-note', text: `已連動「${linkedFlow.name || recurringKinds[linkedFlow.kind]}」的月收入、工時、投保薪資與勞健保設定。` }) : el('div', { class: 'toolbar' }, [
          el('div', { class: 'field' }, [el('label', { text: '月總工資（稅前）' }), el('input', { type: 'number', value: Money.toYuan(s.grossMonthlySalaryCents), onchange: (ev) => { const v = Money.toCents(ev.target.value); if (!(v > 0)) return alert('月總工資必須大於 0'); s.grossMonthlySalaryCents = v; IO.markDirty(); renderWageReverse(); } })]),
          el('div', { class: 'field' }, [el('label', { text: '每月工作時數' }), el('input', { type: 'number', step: '0.5', value: s.monthlyWorkHours, onchange: (ev) => { const v = Number(ev.target.value); if (!(v > 0)) return alert('月工時必須大於 0'); s.monthlyWorkHours = v; IO.markDirty(); renderWageReverse(); } })]),
          el('label', {}, [el('input', { type: 'checkbox', checked: s.insuredSalaryFollowsGross ? 'checked' : undefined, onchange: (ev) => { s.insuredSalaryFollowsGross = ev.target.checked; IO.markDirty(); renderWageReverse(); } }), document.createTextNode(' 投保薪資同月總工資')]),
          !s.insuredSalaryFollowsGross ? el('div', { class: 'field' }, [el('label', { text: '投保薪資' }), el('input', { type: 'number', value: Money.toYuan(s.insuredSalaryCents), onchange: (ev) => { s.insuredSalaryCents = Money.toCents(ev.target.value); IO.markDirty(); renderWageReverse(); } })]) : null
        ]),
        el('div', { class: 'health-grid' }, [
          el('div', { class: 'summary-block' }, [el('h3', { text: '自動回算時薪' }), el('p', { class: 'mono big', text: Money.formatTWD(payroll.hourlyRateCents) })]),
          el('div', { class: 'summary-block' }, [el('h3', { text: '勞保自付' }), el('p', { class: 'mono big', text: Money.formatTWD(payroll.laborFee) })]),
          el('div', { class: 'summary-block' }, [el('h3', { text: '健保自付' }), el('p', { class: 'mono big', text: Money.formatTWD(payroll.healthFee) })]),
          el('div', { class: 'summary-block' }, [el('h3', { text: '估計實領' }), el('p', { class: 'mono big', text: Money.formatTWD(payroll.net) })])
        ]),
        el('p', { class: 'notice', text: '時薪＝月總工資÷月工時；勞健保依個人參數中的費率及投保薪資計算。' })
      ]),
      el('div', { class: 'toolbar' }, [
        el('div', { class: 'field' }, [
          el('label', { text: '目標金額' }),
          el('input', {
            type: 'number', class: 'mono', value: Money.toYuan(s.targetAmountCents),
            onchange: (ev) => { s.targetAmountCents = Money.toCents(ev.target.value); IO.markDirty(); renderWageReverse(); }
          })
        ]),
        el('div', { class: 'field' }, [
          el('label', { text: '幣別' }),
          el('select', {
            onchange: (ev) => { s.currency = ev.target.value; IO.markDirty(); renderWageReverse(); }
          }, ['TWD', 'EUR', 'JPY', 'USD'].map((c) => el('option', { value: c, text: c, selected: s.currency === c ? 'selected' : undefined })))
        ]),
        s.currency !== 'TWD' ? el('div', { class: 'field' }, [
          el('label', { text: '台幣匯率' }),
          el('input', {
            type: 'number', step: '0.0001', class: 'mono', value: s.rateToTWD,
            onchange: (ev) => { s.rateToTWD = Number(ev.target.value); IO.markDirty(); renderWageReverse(); }
          })
        ]) : null,
        el('div', { class: 'field' }, [
          el('label', { text: '時薪（由上方自動計算）' }),
          el('input', {
            type: 'number', class: 'mono', value: Money.toYuan(s.baseRateCentsPerHour), readonly: 'readonly'
          })
        ]),
        el('label', {}, [
          el('input', {
            type: 'checkbox', checked: s.applyInsurance ? 'checked' : undefined, disabled: linkedFlow ? 'disabled' : undefined,
            onchange: (ev) => { s.applyInsurance = ev.target.checked; IO.markDirty(); renderWageReverse(); }
          }),
          document.createTextNode(linkedFlow ? ' 沿用收入來源的勞健保設定' : ' 此收入扣除勞健保')
        ])
      ]),
      s.applyInsurance && !linkedFlow ? el('div', { class: 'field' }, [
        el('label', { text: '投保薪資（元）' }),
        el('input', {
          type: 'number', class: 'mono', value: Money.toYuan(s.insuredSalaryCents),
          onchange: (ev) => { s.insuredSalaryCents = Money.toCents(ev.target.value); IO.markDirty(); renderWageReverse(); }
        })
      ]) : empty(),
      el('div', { class: 'result-block' }, [
        el('p', {}, [document.createTextNode('換算成台幣目標：'), el('span', { class: 'mono', text: Money.formatTWD(result.targetTWD) })]),
        s.applyInsurance ? el('p', {}, [document.createTextNode('墊高勞健保後的實際目標：'), el('span', { class: 'mono', text: Money.formatTWD(result.effectiveTarget) })]) : null,
        el('p', {}, [document.createTextNode('週末班時數：'), el('span', { class: 'mono big', text: result.baseUnits.toLocaleString() + ' 小時' })])
      ]),
      el('div', { class: 'card' }, [
        el('h3', { text: '換算路徑（半日班）' }),
        el('table', {}, [el('tbody', {}, result.chain.map((step) => el('tr', {}, [
          el('td', { text: step.label }), el('td', { class: 'mono', text: step.rounded.toLocaleString() })
        ])))])
      ]),
      result.altChain ? el('div', { class: 'card' }, [
        el('h3', { text: '換算路徑（整日班）' }),
        el('table', {}, [el('tbody', {}, result.altChain.map((step) => el('tr', {}, [
          el('td', { text: step.label }), el('td', { class: 'mono', text: step.rounded.toLocaleString() })
        ])))])
      ]) : empty(),
      el('p', { class: 'notice', text: '精度規則：每一層用「上一步無條件進位後的整數」往下除，已用真實數字驗證過此規則。' })
    );
  };

  // ================= 匯入 / 匯出 =================
  const initIO = () => {
    $('#export-ledger').addEventListener('click', () => IO.exportJson(ledger, 'ledger'));
    $('#export-config').addEventListener('click', () => IO.exportJson(config, 'config'));
    $('#export-scenarios').addEventListener('click', () => IO.exportJson({ schemaVersion: 2, scenarios }, 'estimator_scenarios'));
    $('#export-wage').addEventListener('click', () => IO.exportJson(wageReverseScenario, 'wage_reverse_scenario'));
    $('#export-workspace').addEventListener('click', () => IO.exportJson({ schemaVersion: 1, savedAt: new Date().toISOString(), ...workspaceSnapshot() }, 'finance_tools_workspace'));
    $('#restore-workspace').addEventListener('click', async () => {
      try {
        const previous = await IO.loadPreviousWorkspace();
        if (!previous) { alert('目前尚無可回復的滾動版本'); return; }
        if (!confirm(`確定回復到 ${new Date(previous.savedAt).toLocaleString('zh-Hant-TW')} 的版本？`)) return;
        restoreWorkspace(previous); materializeDueRecurringEntries(); renderScenarioSelector(); renderAll(); renderLedgerForm(); IO.markDirty(); alert('已回復上一版本');
      } catch (err) { alert(`無法回復版本：${err.message}`); }
    });

    $('#import-file').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      try {
        const data = await IO.importJsonFile(file, { expectedSchemaVersion: 2 });
        if (data.config && data.ledger && data.scenarios) {
          if (!restoreWorkspace(data)) throw new Error('完整工作區格式不正確');
          materializeDueRecurringEntries(); renderScenarioSelector(); renderAll(); renderLedgerForm(); IO.markDirty(); alert('完整工作區已匯入並保存至瀏覽器本機資料');
        }
        else if (data.entries) {
          const checked = Validation.validateImported(data, 'ledger');
          if (!checked.valid) throw new Error('帳本驗證失敗：\n' + checked.errors.map(e => `${e.path} ${e.message}`).join('\n'));
          ledger = data; renderLedger(); IO.markDirty(); alert('帳本資料已匯入並保存至瀏覽器本機資料');
        }
        else if (data.scenarios) {
          const checked = Validation.validateScenarios(data);
          if (!checked.valid) throw new Error('情境驗證失敗：\n' + checked.errors.map(e => `${e.path} ${e.message}`).join('\n'));
          scenarios = data.scenarios; currentScenarioId = scenarios[0]?.scenarioId; renderScenarioSelector(); renderEstimator(); IO.markDirty(); alert('成本試算情境已匯入並保存至瀏覽器本機資料');
        }
        else if (data.conversionChain) {
          const checked = Validation.validateWage(data);
          if (!checked.valid) throw new Error('工時設定驗證失敗：\n' + checked.errors.map(e => `${e.path} ${e.message}`).join('\n'));
          wageReverseScenario = data; renderWageReverse(); IO.markDirty(); alert('工時反推設定已匯入並保存至瀏覽器本機資料');
        }
        else if (data.categories) {
          if (!data.quickPlan) data.quickPlan = structuredClone(DEFAULT_CONFIG.quickPlan);
          const checked = Validation.validateQuickPlan(data.quickPlan);
          if (!checked.valid) throw new Error('設定驗證失敗：\n' + checked.errors.map(e => e.message).join('\n'));
          if (!Array.isArray(data.recurringCashFlows)) data.recurringCashFlows = [];
          const recurringChecked = Validation.validateRecurringFlows(data.recurringCashFlows);
          if (!recurringChecked.valid) throw new Error('固定出入帳驗證失敗：\n' + recurringChecked.errors.map(e => `${e.path} ${e.message}`).join('\n'));
          config = data; materializeDueRecurringEntries(); renderHealth(); renderLedgerForm(); renderLedger(); renderPersonalSettings(); IO.markDirty(); alert('設定檔已匯入並保存至瀏覽器本機資料');
        }
        else { alert('無法辨識這份 JSON 的內容類型'); }
      } catch (err) {
        alert(err.message);
      }
      ev.target.value = '';
    });
  };

  const init = () => {
    IO.configurePersistence(workspaceSnapshot, updateStorageStatus);
    const saved = IO.loadWorkspace();
    if (saved) restoreWorkspace(saved);
    IO.initializeFileBinding().then(() => renderPersonalSettings());
    IO.requestPersistentStorage();
    initTabs();
    materializeDueRecurringEntries();
    renderHealth();
    renderLedgerForm();
    renderLedger();
    renderPersonalSettings();
    initEstimatorControls();
    renderEstimator();
    renderWageReverse();
    initIO();
  };

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
