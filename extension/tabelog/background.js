// 口コミ返信アシスタント（食べログ・トリップアドバイザー）バックグラウンド
// ・一定間隔で各媒体の口コミページを裏で開いて新着を確認（食べログはログインが切れていれば自動ログイン）
// ・未返信の新着があれば通知する（返信文はアプリ「口コミ一元管理」の中でAIが作成し、この拡張機能に渡される。OpenAIは使わない）
// ・送信ボタンは押さない（返信欄への入力は担当者の画面で content.js / ta-content.js が行う）

const TB_REPLY_URL = 'https://owner.tabelog.com/owner_rst/reply_top';
/** 食べログ「口コミ返信」ページのN件目以降（lc=2＝表示件数100件、更新日の新しい順） */
const tbUrl = page => `${TB_REPLY_URL}/?srt=update&sby=desc&PG=${page}&smp=&lc=2`;
/** 食べログはこれより前の口コミをアプリ内に不要とのことなので、保存済みの分も含めて消す（parser.js の TB_CUTOFF と合わせる） */
const TB_CUTOFF_TS = new Date(2026, 9, 1).getTime();
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
chrome.notifications.onClicked.addListener(id => { chrome.tabs.create({ url: notifyUrls[id] || APP_URL }).catch(() => {}); chrome.notifications.clear(id); });

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
  // ※ new Promise の中で async 関数をそのまま実行すると、途中で例外が起きても
  // このPromiseはreject/resolveされず「Uncaught (in promise)」として握りつぶされ、
  // 確認処理がそのまま止まってしまう（「今すぐ確認する」が効かなくなる不具合の原因）。
  // そのため必ず try/catch で受け止めて resolve する。
  return new Promise(resolve => {
    (async () => {
      try {
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
        // トリップアドバイザーはページ送りしながら読み込むため、他媒体より長めに待つ
        const timeoutMs = t.kind === 'tripadvisor' ? 240000 : 90000;
        check = { tabId: tab.id, ...t, loginTried: false, done,
          timer: setTimeout(() => done({ ok: false, error: `${MEDIA_LABEL[t.kind]}の画面が時間内に読み込めませんでした` }), timeoutMs) };
      } catch (e) {
        resolve({ ok: false, error: `${MEDIA_LABEL[t.kind]}の画面を開けませんでした（${e && e.message ? e.message : 'タブの操作に失敗しました'}。少し時間をおいて再度お試しください）` });
      }
    })();
  });
}
/** 食べログ：「口コミ返信」の全ページを順に開いて口コミを集め、まとめて1回だけ保存・新着判定する
 * （更新日の新しい順に並ぶため、古い口コミへの返信で順番が入れ替わっても、全ページ見れば未返信を取りこぼさない） */
async function checkTabelogAllPages() {
  const label = '食べログ';
  const first = await checkTarget({ kind: 'tabelog', url: tbUrl(1), label });
  if (!first.ok) return first;
  const { store, pageUrl, total, pageSize } = first;
  const all = [...first.reviews];
  const seen = new Set(all.map(r => r.key));
  const totalPages = Math.min(20, Math.max(1, Math.ceil((total || all.length) / (pageSize || all.length || 1))));
  let note = '';
  for (let page = 2; page <= totalPages; page++) {
    const r = await checkTarget({ kind: 'tabelog', url: tbUrl(page), label });
    if (!r.ok) { note = `${page}ページ目以降を確認できませんでした（${r.error}）`; break; }
    for (const rv of r.reviews) { if (!seen.has(rv.key)) { seen.add(rv.key); all.push(rv); } }
  }
  await rememberReviews(all, store, 'tabelog', pageUrl);
  const { notified } = await getState();
  const fresh = all.filter(r => !r.replied && !notified[r.key]);
  if (fresh.length) {
    fresh.forEach(r => { notified[r.key] = Date.now(); });
    await chrome.storage.local.set({ notified });
    notify('new-' + Date.now(), `${MEDIA_LABEL.tabelog}（${store}）に新しい口コミが${fresh.length}件あります`,
      'クリックするとアプリ（口コミ一元管理）が開き、AIが返信文を作成します。内容を確認して承認してください。', APP_URL);
  }
  await updateBadge();
  return { ok: true, total: total || all.length, unreplied: all.filter(r => !r.replied).length, note };
}
async function runCheck() {
  if (running) return { ok: false, error: '確認中です' };
  running = true;
  try {
    await closeLeftoverTabs();
    const s = await getSettings();
    const targets = [{ kind: 'tabelog', label: '食べログ', run: checkTabelogAllPages }];
    for (const [store, id] of Object.entries(s.taLocations)) {
      if (String(id || '').trim()) targets.push({ kind: 'tripadvisor', store, url: TA_URL(String(id).trim()), label: `トリップアドバイザー（${store}）` });
    }
    await setStatus({ lastCheckStartedAt: Date.now() });
    const lines = [], errors = [];
    for (const t of targets) {
      const r = await (t.run ? t.run() : checkTarget(t));
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
    chrome.tabs.update(tabId, { url: TB_REPLY_URL }).catch(() => {});
  }
});

/** 「M/D」形式の口コミ日付を、だいたいの時刻に変換する（並び替え・比較用。未来すぎる場合は去年の日付とみなす） */
function roughDateTs(dateStr, now) {
  const m = String(dateStr || '').match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const mo = +m[1] - 1, da = +m[2];
  let d = new Date(now.getFullYear(), mo, da);
  if (d.getTime() - now.getTime() > 60 * 24 * 3600 * 1000) d = new Date(now.getFullYear() - 1, mo, da);
  return d.getTime();
}
// ---- アプリ（口コミ一元管理）に渡すため、読み取った口コミを保存 ----
async function rememberReviews(list, store, media, pageUrl) {
  const { reviews = {} } = await chrome.storage.local.get('reviews');
  const t = Date.now();
  list.forEach(r => { const prev = reviews[r.key]; reviews[r.key] = { key: r.key, media, store, author: r.author, rating: r.rating, text: prev && (prev.text || '').length > (r.text || '').length ? prev.text : r.text, title: r.title || '', date: r.date || '', ts: r.ts || prev?.ts || null, replied: !!r.replied, reply: r.reply || '', replyEntryId: r.replyEntryId || prev?.replyEntryId || null, pageUrl: pageUrl || '', seenAt: t, firstSeenAt: reviews[r.key]?.firstSeenAt || t }; });
  // この媒体・店舗の今回の一覧にない口コミのうち、一覧の中で一番古い口コミより新しいもの（＝本来なら表示されているはず）は、
  // 食べログ・トリップアドバイザー側で削除されたとみなしてアプリ側からも消す（ページをまたいで見えないだけの古い口コミは残す）
  if (list.length) {
    const tsList = list.map(r => roughDateTs(r.date, new Date())).filter(x => x !== null);
    if (tsList.length) {
      const oldestTs = Math.min(...tsList);
      const presentKeys = new Set(list.map(r => r.key));
      Object.keys(reviews).forEach(k => {
        const rv = reviews[k];
        if (rv.media !== media || rv.store !== store || presentKeys.has(k)) return;
        const ts = roughDateTs(rv.date, new Date());
        if (ts !== null && ts >= oldestTs) delete reviews[k];
      });
    }
  }
  // 食べログ：足切り日より前の口コミは（足切り導入前に保存済みの分も含めて）アプリ内に表示しない
  // ※古いデータには ts が無いものもあるため、無ければ date（M/D）から大まかな日付を計算する
  if (media === 'tabelog') {
    Object.keys(reviews).forEach(k => {
      const rv = reviews[k];
      if (rv.media !== 'tabelog') return;
      const ts = rv.ts || roughDateTs(rv.date, new Date());
      if (ts !== null && ts < TB_CUTOFF_TS) delete reviews[k];
    });
  }
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
      if (msg.diag) { const { status } = await getState(); await setStatus({ diag: { ...(status.diag || {}), [media]: { ...msg.diag, at: Date.now(), unreplied: msg.reviews.filter(r => !r.replied).length } } }); }
      if (isCheck && media === 'tabelog') {
        // 食べログの裏確認は複数ページにまたがるため、保存・通知は checkTabelogAllPages でまとめて1回だけ行う
        sendResponse({ mode: 'check' });
        check.done({ ok: true, store, pageUrl: msg.pageUrl, total: msg.total, pageSize: msg.pageSize, reviews: msg.reviews });
        return;
      }
      await rememberReviews(msg.reviews, store, media, msg.pageUrl);
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
    if (msg.type === 'pageMode') {
      if (isCheck && check.kind === 'tripadvisor') {
        // 裏での定期確認：保存済み（＝もう知っている）口コミのキーを渡し、
        // ページ送りの打ち切り判定に使う（collectAllPages 参照）
        const { reviews = {} } = await chrome.storage.local.get('reviews');
        const knownKeys = Object.keys(reviews).filter(k => reviews[k].media === 'tripadvisor' && reviews[k].store === check.store);
        return sendResponse({ mode: 'check', knownKeys });
      }
      return sendResponse({ mode: isCheck ? 'check' : 'assist' });
    }
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
      // アプリの「承認して自動入力」から開いた管理画面で、この口コミの場所まで移動する
      if (msg.key && msg.focus) await chrome.storage.local.set({ focus: { key: msg.key, at: Date.now() } });
      return sendResponse({ ok: true });
    }
    if (msg.type === 'takeFocus') {
      // 10分以内にアプリから指定された口コミ（1回だけ使う）
      const { focus } = await chrome.storage.local.get('focus');
      if (!focus || Date.now() - focus.at > 10 * 60 * 1000) return sendResponse({ key: '' });
      if (msg.keys && !msg.keys.includes(focus.key)) return sendResponse({ key: focus.key, here: false });
      await chrome.storage.local.remove('focus');
      return sendResponse({ key: focus.key, here: true });
    }
    sendResponse({});
  })();
  return true;
});
