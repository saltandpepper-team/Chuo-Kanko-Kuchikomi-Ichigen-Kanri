const STORES = ['山麓園', '浅間茶屋'];
const DEFAULT_TA = { '山麓園': '1703726', '浅間茶屋': '' };
const $ = id => document.getElementById(id);
const fmt = t => t ? new Date(t).toLocaleString('ja-JP') : '—';

async function load() {
  const s = await chrome.storage.local.get(['tbId', 'tbPw', 'interval', 'taLocations']);
  $('tbId').value = s.tbId || '';
  $('tbPw').value = s.tbPw || '';
  $('interval').value = s.interval || 30;
  STORES.forEach(st => { $('ta-' + st).value = (s.taLocations || {})[st] ?? DEFAULT_TA[st]; });
  renderStatus();
}
async function renderStatus() {
  const { status = {}, drafts = {} } = await chrome.storage.local.get(['status', 'drafts']);
  const lines = [
    `最終確認：${fmt(status.lastCheckAt)}`,
    status.lastResult ? `結果：${status.lastResult}` : '',
    `アプリから届いた返信文：${Object.keys(drafts).length}件`,
    status.appSeenAt ? `アプリとの接続：${fmt(status.appSeenAt)}（${status.appOk ? 'つながりました' : 'アプリの画面として認識できませんでした。最新のアプリのファイルか確認してください'}）\n　${decodeURI(status.appUrl || '')}` : 'アプリとの接続：まだありません（アプリをこのChromeで開くと表示されます）'
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
async function save() {
  const taLocations = {};
  STORES.forEach(st => { taLocations[st] = $('ta-' + st).value.replace(/\D/g, ''); });
  await chrome.storage.local.set({
    tbId: $('tbId').value.trim(), tbPw: $('tbPw').value,
    interval: Math.max(10, +$('interval').value || 30), taLocations
  });
  await chrome.storage.local.remove(['openaiKey', 'model', 'storeInfo', 'style']); // 以前のAI設定（OpenAI）は使わないので消す
}
$('form').addEventListener('submit', async e => {
  e.preventDefault();
  await save();
  $('saved').textContent = '保存しました';
  setTimeout(() => { $('saved').textContent = ''; }, 2500);
});
$('checkNow').addEventListener('click', async () => {
  const b = $('checkNow'); b.disabled = true; b.textContent = '確認中…';
  await save(); // 入力した内容を保存してから確認する
  await chrome.runtime.sendMessage({ type: 'checkNow' });
  b.disabled = false; b.textContent = '今すぐ確認する';
  renderStatus();
});
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && (c.status || c.drafts)) renderStatus(); });
$('copyDiag').addEventListener('click', async () => {
  const { status = {} } = await chrome.storage.local.get('status');
  const text = '【口コミ返信アシスタント 診断情報】\n' + JSON.stringify({ version: chrome.runtime.getManifest().version, lastResult: status.lastResult, appSeenAt: status.appSeenAt, appUrl: status.appUrl, claudeFrames: status.claudeFrames || null, diag: status.diag || null }, null, 1);
  try { await navigator.clipboard.writeText(text); $('diagMsg').textContent = 'コピーしました。チャットに貼り付けてください'; }
  catch (e) { $('diagMsg').textContent = 'コピーできませんでした'; }
});
load();
