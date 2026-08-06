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
  }
};
