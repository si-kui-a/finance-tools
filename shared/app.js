// app.js — 主應用邏輯（Tab 切換 + 帳本 + 成本試算）

const App = (() => {
  let config = structuredClone(DEFAULT_CONFIG);
  let ledger = structuredClone(DEFAULT_LEDGER);
  let scenarios = structuredClone(DEFAULT_SCENARIOS);
  let wageReverseScenario = structuredClone(WAGE_REVERSE_SCENARIO);
  let currentScenarioId = scenarios[0].scenarioId;
  let compareMode = false;
  let entryIdSeq = 1;

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

  let lastRateByCurrency = {}; // session 記憶，不持久化

  // ================= 帳本 Tab =================
  const renderLedgerForm = () => {
    const wrap = $('#ledger-form');
    wrap.innerHTML = '';
    const typeSel = el('select', { id: 'f-type' }, [
      el('option', { value: 'expense', text: '支出' }),
      el('option', { value: 'income', text: '收入' }),
      el('option', { value: 'wishlist', text: '願望清單' })
    ]);
    const dateInput = el('input', { type: 'date', id: 'f-date', value: new Date().toISOString().slice(0, 10) });
    const catSel = el('select', { id: 'f-category' },
      config.categories.map((c) => el('option', { value: c, text: c })));
    const accSel = el('select', { id: 'f-account' },
      config.accounts.map((a) => el('option', { value: a, text: a })));
    const amountInput = el('input', { type: 'number', id: 'f-amount', step: '1', placeholder: '金額（原始幣別，支出可留正數，系統自動處理正負號）' });
    const currencySel = el('select', { id: 'f-currency' }, [
      el('option', { value: 'TWD', text: 'TWD 台幣' }),
      el('option', { value: 'EUR', text: 'EUR 歐元' }),
      el('option', { value: 'JPY', text: 'JPY 日圓' }),
      el('option', { value: 'USD', text: 'USD 美元' })
    ]);
    const rateInput = el('input', { type: 'number', id: 'f-rate', step: '0.0001', placeholder: '當下匯率（1 單位 = ? 台幣）' });
    const rateField = el('div', { class: 'field', id: 'f-rate-field' }, [el('label', { text: '匯率→台幣' }), rateInput]);
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

    typeSel.addEventListener('change', () => {
      const t = typeSel.value;
      catField.style.display = t === 'income' ? 'none' : '';
      accField.style.display = t === 'income' ? '' : 'none';
      $('#f-essential-field').style.display = t === 'expense' ? '' : 'none';
      $('#f-reimb-field').style.display = t === 'expense' ? '' : 'none';
      incomeSourceField.style.display = t === 'income' ? '' : 'none';
    });

    wrap.append(
      el('div', { class: 'field' }, [el('label', { text: '類型' }), typeSel]),
      el('div', { class: 'field' }, [el('label', { text: '日期' }), dateInput]),
      catField, accField,
      el('div', { class: 'field' }, [el('label', { text: '幣別' }), currencySel]),
      el('div', { class: 'field' }, [el('label', { text: '金額' }), amountInput]),
      rateField,
      incomeSourceField,
      el('div', { class: 'field', id: 'f-essential-field' }, [essentialChk]),
      el('div', { class: 'field', id: 'f-reimb-field' }, [reimbChk]),
      el('div', { class: 'field wide' }, [el('label', { text: '備註' }), noteInput]),
      addBtn
    );
    accField.style.display = 'none';
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
    const entry = {
      id: `e${String(entryIdSeq++).padStart(4, '0')}`,
      date: $('#f-date').value,
      type,
      category: type === 'income' ? null : $('#f-category').value,
      account: type === 'income' ? $('#f-account').value : null,
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
      const typeLabel = { expense: '支出', income: '收入', wishlist: '願望' }[e.type];
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
        el('td', { text: e.category || e.account || '—' }),
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

    // 換算成台幣後才能加總，避免不同幣別的原始金額直接相加（先前修正過的重點原則）
    const twd = (e) => { try { return Money.toTWDCents(e.amountCents, e.currency, e.rateToTWD); } catch (err) { return 0; } };

    const byCategory = Money.groupSum(ledger.entries, (e) => e.category, (e) => e.type === 'expense');
    const byAccount = Money.groupSum(ledger.entries, (e) => e.account, (e) => e.type === 'income');
    const byMonth = Money.groupSum(ledger.entries, (e) => e.date?.slice(0, 7), (e) => e.type !== 'wishlist');
    const nonEssential = ledger.entries.filter((e) => e.type === 'expense' && e.essential === false)
      .reduce((s, e) => s + twd(e), 0);
    const reimbursable = ledger.entries.filter((e) => e.type === 'expense' && e.reimbursable)
      .reduce((s, e) => s + twd(e), 0);
    const income = ledger.entries.filter((e) => e.type === 'income').reduce((s, e) => s + twd(e), 0);
    const expense = ledger.entries.filter((e) => e.type === 'expense').reduce((s, e) => s + twd(e), 0);
    const available = income + expense;

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
    const byMonthSalary = Money.groupSum(ledger.entries, (e) => e.date?.slice(0, 7), (e) => e.type === 'income' && e.incomeSource === '薪資');
    const trendSVG = Money.buildTrendChartSVG(byMonthExpense, byMonthSalary);

    const trendBlock = el('div', { class: 'summary-block' }, [
      el('h3', { text: '趨勢總覽（紅色長條＝月支出，綠線＝月薪資收入）' })
    ]);
    const trendChartHolder = el('div', {});
    trendChartHolder.innerHTML = trendSVG;
    trendBlock.appendChild(trendChartHolder);

    box.append(
      el('div', { class: 'summary-block highlight' }, [
        el('h3', { text: '總覽' }),
        el('p', {}, [document.createTextNode('可動用資金：'), el('span', { class: 'mono big', text: Money.formatTWD(available) })]),
        el('p', {}, [document.createTextNode('非必要支出總額：'), el('span', { class: 'mono', text: Money.formatTWD(nonEssential) })]),
        el('p', {}, [document.createTextNode('可報銷總額：'), el('span', { class: 'mono', text: Money.formatTWD(reimbursable) })])
      ]),
      table('分類支出小計（對照目標上限）', byCategory, config.budgetLimitsCents),
      table('帳戶收入小計', byAccount, null),
      table('月度彙總', byMonth, null),
      trendBlock
    );
  };

  const renderPersonalSettings = () => {
    const box = $('#personal-settings');
    if (!box) return;
    box.innerHTML = '';
    const numField = (label, value, onchange) => el('div', { class: 'field' }, [
      el('label', { text: label }),
      el('input', { type: 'number', class: 'mono', value, onchange: (ev) => onchange(Number(ev.target.value)) })
    ]);
    box.append(
      el('details', {}, [
        el('summary', { text: '⚙ 個人參數設定（勞健保費率／存款能力，會影響全站的自動提示與 FIRE/工時反推計算）' }),
        el('div', { class: 'toolbar' }, [
          numField('目前年齡', config.personalBaseline.currentAge, (v) => { config.personalBaseline.currentAge = v; IO.markDirty(); renderAll(); }),
          numField('每月可存（元）', Money.toYuan(config.personalBaseline.monthlySavingsCapacityCents), (v) => { config.personalBaseline.monthlySavingsCapacityCents = Money.toCents(v); IO.markDirty(); renderAll(); }),
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
    const hint = Money.calcAchievabilityHint(amountCents, currency, rateToTWD, WAGE_REVERSE_SCENARIO, config);
    const lines = [
      el('p', { class: 'notice' }, [
        document.createTextNode(`▸ 以工時反推引擎目前設定的時薪換算，約需工作 ${hint.hoursNeeded.toLocaleString()} 小時　`),
        el('button', {
          class: 'btn small', text: '→ 帶入工時反推頁面細看',
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
        ? el('p', { class: 'notice', text: `▸ 以每月可存 ${Money.formatTWD(config.personalBaseline.monthlySavingsCapacityCents)} 估算，約需 ${hint.monthsViaSaving} 個月，預計 ${hint.ageAtCompletion} 歲可達成` })
        : el('p', { class: 'notice', text: '▸ 尚未設定「每月可存金額」，無法估算存款版達成時間（見下方⚙個人參數設定）' })
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
        class: 'btn small', text: '+ 新增項目',
        onclick: () => { scenario.items.push({ label: '新項目', amountCents: 0 }); IO.markDirty(); renderEstimator(); }
      }),
      scenario.currentSavedCents !== undefined ? el('div', { class: 'field' }, [
        el('label', { text: '目前已存金額（元）' }),
        el('input', {
          type: 'number', value: Money.toYuan(scenario.currentSavedCents),
          onchange: (ev) => { scenario.currentSavedCents = Money.toCents(ev.target.value); IO.markDirty(); renderEstimator(); }
        })
      ]) : null,
      el('div', { class: 'result-block' }, [
        el('p', {}, [document.createTextNode('總額：'), el('span', { class: 'mono big', text: Money.formatTWD(result.total) })]),
        scenario.applyInflation ? el('p', {}, [document.createTextNode('通膨後總額：'), el('span', { class: 'mono big', text: Money.formatTWD(result.inflated) })]) : null,
        result.afterLoan !== null ? el('p', {}, [document.createTextNode('貸後金額：'), el('span', { class: 'mono', text: Money.formatTWD(result.afterLoan) })]) : null,
        result.inflatedAfterLoan !== null ? el('p', {}, [document.createTextNode('通膨後貸後金額：'), el('span', { class: 'mono', text: Money.formatTWD(result.inflatedAfterLoan) })]) : null,
        result.gap !== null ? el('p', {}, [document.createTextNode('與目前已存差額：'), el('span', { class: result.gap > 0 ? 'mono neg' : 'mono', text: Money.formatTWD(result.gap) })]) : null,
        el('details', {}, [
          el('summary', { text: '▸ 顯示算式' }),
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
      ...result.periods.map((p, idx) => el('div', { class: 'period-block' + (p.isLeaveOfAbsence ? ' leave' : '') }, [
        el('h4', {}, [
          document.createTextNode(p.label + ' '),
          el('label', { class: 'inline-check' }, [
            el('input', {
              type: 'checkbox', checked: p.isLeaveOfAbsence ? 'checked' : undefined,
              onchange: (ev) => { scenario.periods[idx].isLeaveOfAbsence = ev.target.checked; IO.markDirty(); renderEstimator(); }
            }),
            document.createTextNode(' 標記為休學')
          ])
        ]),
        p.isLeaveOfAbsence
          ? el('p', { class: 'notice', text: '休學期間，不計入學費' })
          : el('table', {}, [el('tbody', {}, p.items.map((i) => el('tr', {}, [
              el('td', { text: i.label }), el('td', { class: 'mono', text: Money.formatTWD(i.amountCents) })
            ])))]),
        el('p', {}, [document.createTextNode('本期小計：'), el('span', { class: 'mono', text: Money.formatTWD(p.total) })])
      ])),
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
      scenario.referenceNote ? el('p', { class: 'notice', text: scenario.referenceNote }) : null,
      el('div', { class: 'result-block' }, [
        el('p', {}, [document.createTextNode('退休後年數：'), el('span', { class: 'mono', text: result.retirementYears + ' 年' })]),
        el('p', {}, [document.createTextNode('養老所需總額：'), el('span', { class: 'mono big', text: Money.formatTWD(result.inflated) })]),
        el('p', {}, [document.createTextNode('與目前已存差額：'), el('span', { class: result.gap > 0 ? 'mono neg' : 'mono', text: Money.formatTWD(result.gap) })]),
        el('details', {}, [el('summary', { text: '▸ 顯示算式' }), el('pre', { class: 'formula', text: result.formulaText })])
      ]),
      renderAchievabilityBlock(result.gap)
    );
  };

  const renderFireScenario = (scenario) => {
    const root = $('#estimator-body');
    const result = Money.calcScenario(scenario, config);
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
        ]) : null,
        el('details', {}, [el('summary', { text: '▸ 顯示算式' }), el('pre', { class: 'formula', text: result.formulaText })])
      ]),
      el('div', { class: 'card' }, [
        el('h3', { text: '目前月薪分配建議（以稅後實拿淨薪為基準）' }),
        el('p', { class: 'notice', text: `分配基準（稅後淨薪）：${Money.formatTWD(result.allocationBaseNet)}　|　比例加總：${(result.allocationSumPct * 100).toFixed(1)}%${Math.abs(result.allocationSumPct - 1) > 0.001 ? '　⚠ 未達 100%，建議調整' : ' ✅'}` }),
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
    if (compareMode) { renderCompare(); return; }
    const scenario = currentScenario();
    if (!scenario) return;
    const type = scenario.calcType || (scenario.periods ? 'periods' : 'items');
    if (type === 'periods') return renderPeriodScenario(scenario);
    if (type === 'retirement_fund') return renderRetirementFundScenario(scenario);
    if (type === 'fire') return renderFireScenario(scenario);
    return renderOneTimeScenario(scenario);
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
    const result = Money.calcWageReverse(s, config);

    root.innerHTML = '';
    root.append(
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
          el('label', { text: '匯率→台幣' }),
          el('input', {
            type: 'number', step: '0.0001', class: 'mono', value: s.rateToTWD,
            onchange: (ev) => { s.rateToTWD = Number(ev.target.value); IO.markDirty(); renderWageReverse(); }
          })
        ]) : null,
        el('div', { class: 'field' }, [
          el('label', { text: '時薪（元/小時）' }),
          el('input', {
            type: 'number', class: 'mono', value: Money.toYuan(s.baseRateCentsPerHour),
            onchange: (ev) => { s.baseRateCentsPerHour = Money.toCents(ev.target.value); IO.markDirty(); renderWageReverse(); }
          })
        ]),
        el('label', {}, [
          el('input', {
            type: 'checkbox', checked: s.applyInsurance ? 'checked' : undefined,
            onchange: (ev) => { s.applyInsurance = ev.target.checked; IO.markDirty(); renderWageReverse(); }
          }),
          document.createTextNode(' 此收入比照一般受雇試算勞健保（接案/零工通常不勾）')
        ])
      ]),
      s.applyInsurance ? el('div', { class: 'field' }, [
        el('label', { text: '投保薪資（元）' }),
        el('input', {
          type: 'number', class: 'mono', value: Money.toYuan(s.insuredSalaryCents),
          onchange: (ev) => { s.insuredSalaryCents = Money.toCents(ev.target.value); IO.markDirty(); renderWageReverse(); }
        })
      ]) : null,
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
      ]) : null,
      el('p', { class: 'notice', text: '精度規則：每一層用「上一步無條件進位後的整數」往下除，已用真實數字驗證過此規則。' })
    );
  };

  // ================= 匯入 / 匯出 =================
  const initIO = () => {
    $('#export-ledger').addEventListener('click', () => IO.exportJson(ledger, 'ledger'));
    $('#export-config').addEventListener('click', () => IO.exportJson(config, 'config'));
    $('#export-scenarios').addEventListener('click', () => IO.exportJson({ schemaVersion: 2, scenarios }, 'estimator_scenarios'));
    $('#export-wage').addEventListener('click', () => IO.exportJson(wageReverseScenario, 'wage_reverse_scenario'));

    $('#import-file').addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      try {
        const data = await IO.importJsonFile(file, { expectedSchemaVersion: 2 });
        if (data.entries) { ledger = data; renderLedger(); alert('帳本資料已匯入'); }
        else if (data.scenarios) { scenarios = data.scenarios; currentScenarioId = scenarios[0]?.scenarioId; renderScenarioSelector(); renderEstimator(); alert('成本試算情境已匯入'); }
        else if (data.conversionChain) { wageReverseScenario = data; renderWageReverse(); alert('工時反推設定已匯入'); }
        else if (data.categories) { config = data; renderLedgerForm(); renderLedger(); renderPersonalSettings(); alert('設定檔已匯入'); }
        else { alert('無法辨識這份 JSON 的內容類型'); }
      } catch (err) {
        alert(err.message);
      }
      ev.target.value = '';
    });
  };

  const init = () => {
    initTabs();
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
