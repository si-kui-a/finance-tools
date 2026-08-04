// io.js — 匯入 / 匯出 / 驗證 / 資料遺失防呆
// 原則：全程只在瀏覽器本機記憶體運算，不對外送出任何資料。

const IO = (() => {
  let dirty = false;

  const markDirty = () => { dirty = true; };
  const clearDirty = () => { dirty = false; };

  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  const exportJson = (dataObject, baseName) => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const filename = `${baseName}_${stamp}.json`;
    const blob = new Blob([JSON.stringify(dataObject, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    clearDirty();
    return filename;
  };

  // 讀取使用者選取的檔案，回傳 Promise<object>；格式錯誤或版本不符會丟出可讀訊息，不覆蓋現有資料
  const importJsonFile = (file, { expectedSchemaVersion } = {}) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        let parsed;
        try {
          parsed = JSON.parse(reader.result);
        } catch (err) {
          reject(new Error('檔案不是有效的 JSON 格式，未覆蓋現有資料。請確認檔案內容完整。'));
          return;
        }
        if (expectedSchemaVersion !== undefined && parsed.schemaVersion !== undefined
            && parsed.schemaVersion > expectedSchemaVersion) {
          reject(new Error(
            `此資料檔案版本（v${parsed.schemaVersion}）比目前工具支援的版本（v${expectedSchemaVersion}）新，` +
            `請更新工具後再匯入，避免欄位判讀錯誤。`
          ));
          return;
        }
        resolve(parsed);
      };
      reader.onerror = () => reject(new Error('讀取檔案時發生錯誤，請重試。'));
      reader.readAsText(file);
    });

  return { markDirty, clearDirty, exportJson, importJsonFile };
})();
