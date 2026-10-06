// 口コミ返信アシスタント（食べログ・トリップアドバイザー）バックグラウンド
// ・一定間隔で各媒体の口コミページを裏で開いて新着を確認（食べログはログインが切れていれば自動ログイン）
// ・未返信の新着があれば通知する（返信文はアプリ「口コミ一元管理」の中でAIが作成し、この拡張機能に渡される。OpenAIは使わない）
// ・送信ボタンは押さない（返信欄への入力は担当者の画面で content.js / ta-content.js が行う）

const TB_REPLY_URL = 'https://owner.tabelog.com/owner_rst/reply_top';
const TA_URL = id => `https://www.tripadvisor.jp/reviews?locationId=${encodeURIComponent(id)}&screen=allreviews`;
const MEDIA_LABEL = { tabelog: '食べログ', tripadvisor: 'トリップアドバイザー' };
const APP_URL = 'https://chuo-kanko-kuchikomi-ichigen-kanri.firebaseapp.com/';
const NO_DRAFT = '返信文がまだありません。アプリ（口コミ一元管理）を開くと、AIが返信文を作成します';
const DEFAULTS = {
  tbId: '', tbPw: '', interval: 30,
  taLocations: { '山麓園': '1703726', '浅間茶屋': '' }
};

async function getSettings() {
  const s = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...s,
    taLocations: { ...DEFAULTS.taLocations, ...(s.taLocations || {}) } };
}
async function getState() {
  const s = await chrome.storage.local.get(['drafts', 'notified', 'status']);
  return { drafts: s.drafts || {}, notified: s.notified || {}, status: s.status || {} };
}
async function setStatus(patch) {
  const { status } = await getState();
  await chrome.storage.local.set({ status: { ...status, ...patch } });
}
/** トリップアドバイザーの場所ID → 店舗名 */
async function storeOfLocation(id) {
  const { taLocations } = await getSettings();
  return Object.keys(taLocations).find(k => String(taLocations[k]).trim() && String(taLocations[k]).trim() === String(id)) || '';
}

// ---- 定期確認のスケジュール ----
async function schedule() {
  const { interval } = await getSettings();
  await chrome.alarms.clear('check');
  chrome.alarms.create('check', { periodInMinutes: Math.max(10, Number(interval) || 30), delayInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.interval) schedule(); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'check') runCheck(); });

// ---- 返信文（アプリで作成されたもの） ----
/** 保存済みの返信文を返す（作成はアプリが行い、appSetDraft で届く） */
async function ensureDrafts(reviews) {
  const { drafts } = await getState();
  const missing = reviews.filter(r => !r.replied && !drafts[r.key]).length;
  return { drafts, made: [], error: missing ? NO_DRAFT : '' };
}
async function updateBadge() {
  const { drafts } = await getState();
  const { reviews = {} } = await chrome.storage.local.get('reviews');
  const n = Object.values(reviews).filter(r => !r.replied && drafts[r.key]).length;
  chrome.action.setBadgeText({ text: n ? String(n) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#C5221F' });
}
const notifyUrls = {};
function notify(id, title, message, url) {
  if (url) notifyUrls[id] = url;
  chrome.notifications.create(id, { type: 'basic', iconUrl: 'icon.png', title, message, priority: 2 });
}
chrome.notifications.onClicked.addListener(id => { chrome.tabs.create({ url: notifyUrls[id] || APP_URL }); chrome.notifications.clear(id); });

// ---- 裏で各媒体の口コミページを開いて確認 ----
let check = null;   // 確認中の1ページ { tabId, kind, store, url, loginTried, done, timer }
let running = false;
/** 前回の確認で閉じ損ねたタブ（拡張機能の再起動などで残ったもの）を閉じる */
async function closeLeftoverTabs() {
  const { checkTabs = [] } = await chrome.storage.local.get('checkTabs');
  for (const id of checkTabs) { try { await chrome.tabs.remove(id); } catch (e) {} }
  await chrome.storage.local.set({ checkTabs: [] });
}
chrome.runtime.onStartup.addListener(closeLeftoverTabs);
function checkTarget(t) {
  return new Promise(async resolve => {
    const tab = await chrome.tabs.create({ url: t.url, active: false });
    const { checkTabs = [] } = await chrome.storage.local.get('checkTabs');
    await chrome.storage.local.set({ checkTabs: [...checkTabs, tab.id] });
    const done = async result => {
      if (!check || check.tabId !== tab.id) return;
      clearTimeout(check.timer);
      check = null;
      try { await chrome.tabs.remove(tab.id); } catch (e) {}
      const { checkTabs = [] } = await chrome.storage.local.get('checkTabs');
      await chrome.storage.local.set({ checkTabs: checkTabs.filter(x => x !== tab.id) });
      resolve(result);
    };
    check = { tabId: tab.id, ...t, loginTried: false, done,
      timer: setTimeout(() => done({ ok: false, error: `${MEDIA_LABEL[t.kind]}の画面が時間内に読み込めませんでした` }), 90000) };
  });
}
async function runCheck() {
  if (running) return { ok: false, error: '確認中です' };
  running = true;
  try {
    await closeLeftoverTabs();
    const s = await getSettings();
    const targets = [{ kind: 'tabelog', url: TB_REPLY_URL, label: '食べログ' }];
    for (const [store, id] of Object.entries(s.taLocations)) {
      if (String(id || '').trim()) targets.push({ kind: 'tripadvisor', store, url: TA_URL(String(id).trim()), label: `トリップアドバイザー（${store}）` });
    }
    await setStatus({ lastCheckStartedAt: Date.now() });
    const lines = [], errors = [];
    for (const t of targets) {
      const r = await checkTarget(t);
      if (r.ok) lines.push(`${t.label}：口コミ ${r.total}件を確認（未返信 ${r.unreplied}件）${r.note ? `　※${r.note}` : ''}`);
      else lines.push(`${t.label}：${r.error}`);
      const err = r.ok ? '' : r.error;
      if (err && !errors.includes(err)) errors.push(err);
    }
    await setStatus({ lastCheckAt: Date.now(), lastResult: lines.join('\n'), lastError: errors.join(' ／ '), ...(errors.length ? { lastErrorAt: Date.now() } : {}) });
    await updateBadge();
    return { ok: true, lines };
  } finally { running = false; }
}
// 食べログでログイン後にトップ等へ移動した場合は「口コミ返信」ページへ戻す
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!check || check.kind !== 'tabelog' || tabId !== check.tabId || info.status !== 'complete' || !tab.url) return;
  if (tab.url.startsWith('https://owner.tabelog.com/') && !/\/owner_account\/login/.test(tab.url) && !/\/owner_rst\/reply/.test(tab.url)) {
    chrome.tabs.update(tabId, { url: TB_REPLY_URL });
  }
});

// ---- アプリ（口コミ一元管理）に渡すため、読み取った口コミを保存 ----
async function rememberReviews(list, store, media, pageUrl) {
  const { reviews = {} } = await chrome.storage.local.get('reviews');
  const t = Date.now();
  list.forEach(r => { const prev = reviews[r.key]; reviews[r.key] = { key: r.key, media, store, author: r.author, rating: r.rating, text: prev && (prev.text || '').length > (r.text || '').length ? prev.text : r.text, title: r.title || '', date: r.date || '', replied: !!r.replied, reply: r.reply || '', pageUrl: pageUrl || '', seenAt: t, firstSeenAt: reviews[r.key]?.firstSeenAt || t }; });
  // 古いものから削除して最大400件に保つ
  const keys = Object.keys(reviews).sort((a, b) => reviews[b].seenAt - reviews[a].seenAt);
  keys.slice(400).forEach(k => delete reviews[k]);
  await chrome.storage.local.set({ reviews });
}

// ---- 各ページからのメッセージ ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab?.id;
    const isCheck = !!check && tabId === check.tabId;
    if (msg.type === 'loginPage') { // 食べログのログイン画面
      const s = await getSettings();
      if (!s.tbId || !s.tbPw) {
        if (isCheck) check.done({ ok: false, error: 'ログインが必要です（拡張機能の設定画面で食べログのIDとパスワードを入力してください）' });
        return sendResponse({ action: 'none' });
      }
      if (isCheck) {
        if (check.loginTried) { notify('login-failed', '食べログに自動ログインできませんでした', '画像認証などで止まった可能性があります。食べログに手動でログインしてください。', TB_REPLY_URL); check.done({ ok: false, error: '自動ログインに失敗しました（手動でログインしてください）' }); return sendResponse({ action: 'none' }); }
        check.loginTried = true;
      }
      return sendResponse({ action: 'login', id: s.tbId, pw: s.tbPw });
    }
    if (msg.type === 'needLogin') { // トリップアドバイザーのログイン切れ
      if (isCheck) {
        notify('ta-login', 'トリップアドバイザーにログインしてください', 'ログインが切れているため口コミを確認できませんでした。Chromeでトリップアドバイザーにログインしてください（「ログイン状態を保持」がおすすめです）。', check.url);
        check.done({ ok: false, error: 'ログインが必要です（Chromeでトリップアドバイザーにログインしてください）' });
      }
      return sendResponse({});
    }
    if (msg.type === 'pageData') {
      const media = msg.media || 'tabelog';
      const store = media === 'tripadvisor' ? (isCheck && check.store) || await storeOfLocation(msg.locationId) : (msg.store || '');
      if (media === 'tripadvisor' && !store) { // 設定にない場所IDのページ
        if (isCheck) check.done({ ok: false, error: '場所IDが設定と一致しません' });
        return sendResponse({ mode: 'none' });
      }
      await rememberReviews(msg.reviews, store, media, msg.pageUrl);
      if (msg.diag) { const { status } = await getState(); await setStatus({ diag: { ...(status.diag || {}), [media]: { ...msg.diag, at: Date.now(), unreplied: msg.reviews.filter(r => !r.replied).length } } }); }
      if (isCheck) {
        const { notified } = await getState();
        const fresh = msg.reviews.filter(r => !r.replied && !notified[r.key]);
        if (fresh.length) {
          fresh.forEach(r => { notified[r.key] = Date.now(); });
          await chrome.storage.local.set({ notified });
          notify('new-' + Date.now(), `${MEDIA_LABEL[media]}（${store}）に新しい口コミが${fresh.length}件あります`,
            'クリックするとアプリ（口コミ一元管理）が開き、AIが返信文を作成します。内容を確認して承認してください。', APP_URL);
        }
        sendResponse({ mode: 'check' });
        check.done({ ok: true, total: msg.reviews.length, unreplied: msg.reviews.filter(r => !r.replied).length, note: msg.note || '' });
        await updateBadge();
        return;
      }
      await updateBadge();
      return sendResponse({ mode: 'assist', store });
    }
    if (msg.type === 'getDrafts') {
      const media = msg.media || 'tabelog';
      const store = msg.store || (media === 'tripadvisor' ? await storeOfLocation(msg.locationId) : '');
      const { drafts, error } = await ensureDrafts(msg.reviews);
      const out = {};
      msg.reviews.forEach(r => { if (drafts[r.key]) out[r.key] = drafts[r.key].reply; });
      return sendResponse({ drafts: out, error });
    }
    if (msg.type === 'pageMode') return sendResponse({ mode: isCheck ? 'check' : 'assist' });
    if (msg.type === 'checkNow') return sendResponse(await runCheck());
    if (msg.type === 'appPage') {
      if (msg.frames) await setStatus({ claudeFrames: { at: Date.now(), url: String(msg.url || '').slice(0, 200), frames: msg.frames.slice(0, 20) } });
      if (msg.isApp || /kuchikomi|%E5%8F%A3%E3%82%B3%E3%83%9F|口コミ/i.test(msg.url || '')) await setStatus({ appSeenAt: Date.now(), appUrl: String(msg.url || ''), appOk: !!msg.isApp });
      return sendResponse({ ok: true });
    }
    if (msg.type === 'appSetDraft') {
      // アプリで承認（編集）した返信文を、各媒体の返信欄に入れる文として保存
      const { drafts = {} } = await chrome.storage.local.get('drafts');
      const reply = String(msg.reply || '').slice(0, 4000);
      if (msg.key && reply) { drafts[msg.key] = { ...(drafts[msg.key] || {}), reply, fromApp: true, updatedAt: Date.now() }; await chrome.storage.local.set({ drafts }); }
      return sendResponse({ ok: true });
    }
    sendResponse({});
  })();
  return true;
});
