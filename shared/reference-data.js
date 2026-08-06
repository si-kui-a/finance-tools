// reference-data.js — 可離線使用的官方參考資料快照。
// 核心計算不依賴網路；更新失敗時仍使用此快照，並在畫面顯示資料日期。
const REFERENCE_DATA = {
  twInflation: {
    annualRate: 0.0191,
    label: '2026 年台灣 CPI 年增率預測',
    source: '中央銀行 2026-06-18 理監事聯席會議資料',
    sourceUrl: 'https://www.cbc.gov.tw/tw/cp-302-192416-38c80-1.html',
    observedThrough: '2026-06-18',
    retrievedAt: '2026-08-07',
    note: '規劃預設值，不是保證。使用者可在快速健檢中覆寫。'
  },
  twStudentLoan: {
    effectiveFrom: '2026-08-01', borrowerAnnualRate: 0.00775,
    standardGraceYears: 2, yearsPerBorrowedSemester: 1,
    extendedTermMultiplier: 1.5, lowIncomeTermMultiplier: 2,
    source: '教育部高級中等以上學校學生就學貸款辦法及臺灣銀行就學貸款公告',
    sourceUrl: 'https://edu.law.moe.gov.tw/LawContent.aspx?id=FL008414',
    bankUrl: 'https://sloan.bot.com.tw/customer/login/SLoanLogin.action',
    retrievedAt: '2026-08-07',
    note: '一般畢業情境估算；實際起算日、利率、展延、承貸銀行帳單及個人資格優先。'
  },
  twMortgage: {
    referenceAnnualRate: 0.0337, referenceTermYears: 30,
    source: '臺灣銀行消費者貸款適用利率一覽表及中央銀行不動產貸款規定',
    sourceUrl: 'https://www.bot.com.tw/Images/File/GetFileId/8ecae4b0-7567-4ebc-951b-ec8c77524c3c',
    regulationUrl: 'https://www.cbc.gov.tw/tw/lp-6299-1.html',
    retrievedAt: '2026-08-07',
    note: '3.37% 僅為一般房屋購置貸款公開參考下限，不代表個人核貸；實際利率、成數、年限與寬限期以銀行契約為準。'
  }
};
