import http from 'node:http';
import crypto from 'node:crypto';

const port = Number(process.env.MONEYPATH_INVOICE_PORT || 8787);
const appID = process.env.MOF_EINVOICE_APP_ID || '';
const apiKey = process.env.MOF_EINVOICE_API_KEY || '';
const baseUrl = process.env.MOF_EINVOICE_ENV === 'production'
  ? 'https://api.einvoice.nat.gov.tw'
  : 'https://wwwtest-api.einvoice.nat.gov.tw';
const uuid = process.env.MONEYPATH_DEVICE_UUID || crypto.randomUUID();
let serial = 0;

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': 'null', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'content-type' });
  res.end(JSON.stringify(body));
};
const bodyOf = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.reduce((n, chunk) => n + chunk.length, 0) > 65536) throw new Error('請求內容過大');
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
};
const postMof = async (path, params, { sign = false } = {}) => {
  if (!appID) throw new Error('尚未設定 MOF_EINVOICE_APP_ID');
  const now = Math.floor(Date.now() / 1000);
  const values = { ...params, appID, uuid, timeStamp: String(now) };
  if (sign) {
    if (!apiKey) throw new Error('此操作需要 MOF_EINVOICE_API_KEY');
    const signingText = Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&');
    values.signature = crypto.createHmac('sha256', apiKey).update(signingText, 'utf8').digest('base64');
  }
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
  const result = await response.json();
  if (!['200', '996'].includes(String(result.code))) throw new Error(`財政部 API ${result.code || response.status}：${result.msg || '查詢失敗'}`);
  return result;
};
const syncInvoices = async ({ cardNo, cardEncrypt, startDate, endDate }) => {
  if (!/^\/.{7}$/.test(cardNo || '')) throw new Error('手機條碼格式不正確');
  if (!cardEncrypt) throw new Error('請輸入手機條碼驗證碼');
  const headers = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await postMof('/PB2CAPIVAN/invServ/InvServ', { version: '0.6', action: 'carrierInvChk', cardType: '3J0002', cardNo, cardEncrypt, startDate, endDate, onlyWinningInv: 'N', page: String(page), isBuyerType: 'N', expTimeStamp: String(Math.floor(Date.now() / 1000) + 180) });
    headers.push(...(result.details || []));
    if (String(result.code) !== '996') break;
  }
  const invoices = [];
  for (const header of headers.filter(item => String(item.donateMark) !== '1')) {
    const date = header.invDate && typeof header.invDate === 'object' ? `${Number(header.invDate.year) + 1911}/${String(header.invDate.month).padStart(2, '0')}/${String(header.invDate.date).padStart(2, '0')}` : header.invDate;
    const detail = await postMof('/PB2CAPIVAN/invServ/InvServ', { version: '0.5', action: 'carrierInvDetail', cardType: header.cardType || '3J0002', cardNo: header.cardNo || cardNo, cardEncrypt, invNum: header.invNum, invDate: date, sellerName: header.sellerName || '', amount: header.amount || '', isBuyerType: 'N', expTimeStamp: String(Math.floor(Date.now() / 1000) + 180) });
    invoices.push({ ...header, ...detail, invDate: detail.invDate || header.invDate });
  }
  return invoices;
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ready: !!appID, environment: baseUrl.includes('wwwtest') ? 'test' : 'production' });
  try {
    if (req.method === 'POST' && req.url === '/sync') {
      const body = await bodyOf(req);
      if (body.consent !== true) throw new Error('必須先同意本次查詢與記帳用途');
      return json(res, 200, { invoices: await syncInvoices(body) });
    }
    if (req.method === 'POST' && req.url === '/donate') {
      const body = await bodyOf(req);
      if (body.confirm !== true) throw new Error('捐贈發票前必須再次確認');
      const now = Math.floor(Date.now() / 1000);
      const result = await postMof('/PB2CAPIVAN/CarInv/Donate', { version: '0.1', action: 'carrierInvDnt', serial: String(++serial).padStart(10, '0'), cardType: '3J0002', cardNo: body.cardNo, cardEncrypt: body.cardEncrypt, invNum: body.invNum, invDate: body.invDate, npoBan: body.npoBan, expTimeStamp: String(now + 180) }, { sign: true });
      return json(res, 200, result);
    }
    return json(res, 404, { error: '找不到此功能' });
  } catch (error) { return json(res, 400, { error: error.message }); }
});
server.listen(port, '127.0.0.1', () => console.log(`MoneyPath invoice companion: http://127.0.0.1:${port} (${baseUrl.includes('wwwtest') ? 'test' : 'production'})`));
