// アプリ（口コミ一元管理_返信文自動生成）のページで動く部分
// ・拡張機能が読み取った食べログの口コミとAIの返信文を、アプリに渡す
// ・アプリで承認した返信文を受け取り、食べログの返信欄に入れる文として保存する
(() => {
  const isApp = () => !!document.querySelector('[data-kuchikomi-app]');
  let started = false;
  async function push() {
    let data;
    try { data = await chrome.storage.local.get(['reviews', 'drafts']); } catch (e) { return; }
    const drafts = data.drafts || {};
    const reviews = Object.values(data.reviews || {}).map(r => ({ ...r, draft: drafts[r.key]?.reply || '' }));
    window.postMessage({ source: 'tabelog-assistant', type: 'reviews', reviews }, '*');
  }
  function start() {
    if (started || !isApp()) return;
    started = true;
    window.addEventListener('message', e => {
      if (e.source !== window || e.data?.source !== 'kuchikomi-app') return;
      if (e.data.type === 'hello') push();
      if (e.data.type === 'setDraft' && e.data.key) {
        try { chrome.runtime.sendMessage({ type: 'appSetDraft', key: String(e.data.key), reply: String(e.data.reply || '') }); } catch (err) {}
      }
    });
    chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && (c.reviews || c.drafts)) push(); });
    window.postMessage({ source: 'tabelog-assistant', type: 'ready' }, '*');
    push();
  }
  // 拡張機能の設定画面に「アプリの画面とつながったか」を表示するための報告
  const report = () => {
    // claude.ai の画面では、アプリが入っている枠（iframe）の住所を調べて報告する（拡張機能の対象に加えるため）
    const frames = window === window.top && /claude\.ai$/.test(location.hostname)
      ? [...document.querySelectorAll('iframe')].map(f => (f.getAttribute('src') || '(srcなし)').slice(0, 200)) : undefined;
    try { chrome.runtime.sendMessage({ type: 'appPage', url: location.href.slice(0, 300), isApp: isApp(), frames }); } catch (e) {}
  };
  start();
  setTimeout(report, 3000);
  if (!started) {
    const mo = new MutationObserver(() => { start(); if (started) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    setTimeout(() => mo.disconnect(), 30000);
  }
})();
