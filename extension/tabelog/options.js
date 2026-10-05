const STORES = ['山麓園', '浅間茶屋'];
const DEFAULT_INFO = { '山麓園': '囲炉裏で楽しむろばた焼き、甲州の郷土料理（ほうとう等）と風情ある空間', '浅間茶屋': '' };
const $ = id => document.getElementById(id);
const fmt = t => t ? new Date(t).toLocaleString('ja-JP') : '—';

async function load() {
  const s = await chrome.storage.local.get(['tbId', 'tbPw', 'openaiKey', 'model', 'interval', 'storeInfo', 'style']);
  $('tbId').value = s.tbId || '';
  $('tbPw').value = s.tbPw || '';
  $('openaiKey').value = s.openaiKey || '';
  $('model').value = s.model || 'gpt-4o-mini';
  $('interval').value = s.interval || 30;
  $('style').value = s.style || '';
  STORES.forEach(st => { $('info-' + st).value = (s.storeInfo || {})[st] ?? DEFAULT_INFO[st]; });
  renderStatus();
}
async function renderStatus() {
  const { status = {}, drafts = {} } = await chrome.storage.local.get(['status', 'drafts']);
  const lines = [
    `最終確認：${fmt(status.lastCheckAt)}`,
    status.lastResult ? `結果：${status.lastResult}` : '',
    `作成済みの返信文：${Object.keys(drafts).length}件`
  ].filter(Boolean);
  $('status').innerHTML = '';
  $('status').append(lines.join('\n'));
  if (status.lastError) {
    const e = document.createElement('div');
    e.className = 'err'; e.style.marginTop = '8px';
    e.textContent = `エラー（${fmt(status.lastErrorAt)}）：${status.lastError}`;
    $('status').append(e);
  }
}
$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const storeInfo = {};
  STORES.forEach(st => { storeInfo[st] = $('info-' + st).value.trim(); });
  await chrome.storage.local.set({
    tbId: $('tbId').value.trim(), tbPw: $('tbPw').value,
    openaiKey: $('openaiKey').value.trim(), model: $('model').value.trim() || 'gpt-4o-mini',
    interval: Math.max(10, +$('interval').value || 30), storeInfo, style: $('style').value
  });
  $('saved').textContent = '保存しました';
  setTimeout(() => { $('saved').textContent = ''; }, 2500);
});
$('checkNow').addEventListener('click', async () => {
  const b = $('checkNow'); b.disabled = true; b.textContent = '確認中…';
  await chrome.runtime.sendMessage({ type: 'checkNow' });
  b.disabled = false; b.textContent = '今すぐ確認する';
  renderStatus();
});
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && (c.status || c.drafts)) renderStatus(); });
load();
