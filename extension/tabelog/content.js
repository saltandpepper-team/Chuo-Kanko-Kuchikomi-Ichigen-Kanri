// 食べログ 口コミ返信アシスタント（店舗管理画面で動く部分）
// ・ログイン画面：設定済みならIDとパスワードを入力してログイン
// ・「口コミ返信」ページ：口コミを読み取り、未返信の口コミの返信欄にAIの返信文を入力する
//   ※送信（返信）ボタンは押さない。担当者が内容を確認して押す

(() => {
  const DATE = /'(\d{2})\/(\d{1,2})\/(\d{1,2})/;
  const send = msg => new Promise(res => { try { chrome.runtime.sendMessage(msg, r => res(r || {})); } catch (e) { res({}); } });

  // ---- ログイン画面 ----
  const pw = document.querySelector('input[type="password"]');
  if (pw) {
    // 同じタブで何度もログインを試さない（画像認証などで失敗した場合のループ防止）
    const last = +sessionStorage.getItem('tbAssistLoginAt') || 0;
    if (Date.now() - last < 120000) return;
    send({ type: 'loginPage' }).then(r => {
      if (r.action !== 'login') return;
      const form = pw.form || document;
      const inputs = [...form.querySelectorAll('input')].filter(i => /^(text|email|tel)$/i.test(i.type) && i.offsetParent !== null);
      const id = inputs.filter(i => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING).pop() || inputs[0];
      if (!id) return;
      setValue(id, r.id); setValue(pw, r.pw);
      sessionStorage.setItem('tbAssistLoginAt', String(Date.now()));
      const btn = form.querySelector('button[type="submit"], input[type="submit"], .c-btn--primary');
      if (btn) btn.click(); else if (pw.form) pw.form.requestSubmit ? pw.form.requestSubmit() : pw.form.submit();
    });
    return;
  }

  if (!/\/owner_rst\/reply/.test(location.pathname)) return;

  // ---- 「口コミ返信」ページ ----
  function setValue(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const storeName = () => (document.body.innerText.match(/ようこそ\s*(.+?)\s*さん/) || [])[1] || '';

  /** 日付（'26/07/26 など）の要素ごとに、他の口コミの日付を含まない最大の親要素＝口コミ1件の枠とみなす */
  function findCards() {
    const dateEls = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (!DATE.test(t.nodeValue)) continue;
      const el = t.parentElement;
      if (!el || el.closest('[data-tb-assist]')) continue;
      // 「訪問月」の記載が無い口コミ（投稿日＝訪問日のときなど）もあるため、ここでは絞り込まない
      // （本物の口コミかどうかは readCards() の parseTabelog（投稿者名の有無）で判定する）
      dateEls.push(el);
    }
    const uniq = dateEls.filter((el, i) => !dateEls.some((o, k) => k !== i && o !== el && el.contains(o)));
    return uniq.map(el => {
      let card = el;
      while (card.parentElement && card.parentElement !== document.body) {
        const p = card.parentElement;
        if (uniq.some(o => o !== el && p.contains(o))) break;
        card = p;
      }
      return card;
    });
  }
  /** カードの「この口コミに返信」リンクから review_id を取り出す（一覧の並び順に関係なく、
   * この口コミの入力ページへ直接移動できるようにするため。食べログは並び替え・表示件数の
   * URLパラメータに従わない場合があり、一覧の並び順を前提にした移動は当てにならないため） */
  function findReplyEntryId(card) {
    const a = [...card.querySelectorAll('a[href]')].find(a => /\/owner_rst\/reply_entry/.test(a.getAttribute('href') || ''));
    const m = a && (a.getAttribute('href') || '').match(/review_id=(\d+)/);
    return m ? m[1] : null;
  }
  function readCards() {
    return findCards().map(card => {
      const r = parseTabelog(card.innerText)[0];
      if (!r) return null;
      return { card, review: { key: r.extId, author: r.author, rating: r.rating, text: r.text, title: r.title, date: r.date, ts: r.ts, replied: !!r.reply, reply: r.reply || '', replyEntryId: findReplyEntryId(card) } };
    }).filter(Boolean);
  }
  function label(textarea, html) {
    let el = textarea.previousElementSibling;
    if (!el || !el.hasAttribute('data-tb-assist')) {
      el = document.createElement('div');
      el.setAttribute('data-tb-assist', '');
      el.style.cssText = 'margin:6px 0;padding:6px 10px;border-radius:6px;background:#F1ECE7;color:#372822;font-size:12px;line-height:1.6';
      textarea.parentElement.insertBefore(el, textarea);
    }
    el.innerHTML = html;
    return el;
  }
  function fill(card, key, reply) {
    const ta = card.querySelector('textarea');
    if (!ta || !reply) return false;
    if (ta.value.trim() && ta.dataset.tbAssistFilled !== '1') return false; // 担当者が入力済みなら上書きしない
    setValue(ta, reply);
    ta.dataset.tbAssistFilled = '1';
    ta.style.outline = '2px solid #372822';
    label(ta, '<b>AIが作成した返信文です。</b>内容を確認・修正して、返信ボタンを押してください（この拡張機能は送信しません）。（書き直すときはアプリの「指示を入れて書き直す」を使ってください）');
    return true;
  }

  let items = [], drafts = {};
  async function run() {
    items = readCards();
    const store = storeName();
    const totalMatch = document.body.innerText.match(/全\s*([\d,]+)\s*件/);
    const total = totalMatch ? +totalMatch[1].replace(/,/g, '') : items.length;
    const diag = { url: location.href, cards: items.length,
      samples: items.slice(0, 3).map(x => ({ text: x.card.innerText.slice(0, 700), textareas: x.card.querySelectorAll('textarea').length, replied: x.review.replied })) };
    // pageSize・total は、裏での定期確認が全ページを辿るための手がかり（背景スクリプト側でページ送りする）。
    // 返信済みの口コミも引き続きアプリに渡す（「返信済み」として検索・確認できるようにするため。
    // 「承認待ち」などの対応が必要な一覧には出さない判定は replied フラグを見てアプリ側で行う）
    const res = await send({ type: 'pageData', media: 'tabelog', store, pageUrl: location.href,
      reviews: items.map(x => x.review), pageSize: items.length, total, diag });
    if (res.mode !== 'assist') return; // 裏での定期確認のときは入力しない
    const pending = items.filter(x => !x.review.replied);
    if (!pending.length) return;
    pending.forEach(x => { const ta = x.card.querySelector('textarea'); if (ta && !ta.value.trim()) label(ta, '返信文を確認しています…'); });
    const r = await send({ type: 'getDrafts', media: 'tabelog', store, reviews: pending.map(x => x.review) });
    drafts = r.drafts || {};
    pending.forEach(x => {
      const ta = x.card.querySelector('textarea');
      if (!fill(x.card, x.review.key, drafts[x.review.key]) && ta && !drafts[x.review.key] && !ta.value.trim()) label(ta, (r.error || '返信文がまだありません').replace(/[<>&]/g, ''));
    });
    goToFocus();
  }
  /** アプリの「承認して自動入力」で選んだ口コミまで移動し、返信欄を開く（送信はしない） */
  async function goToFocus() {
    const f = await send({ type: 'takeFocus', keys: items.map(x => x.review.key) });
    if (!f.key) return;
    if (!f.here) { if (/^tabelog:/.test(f.key)) banner('アプリで選んだ口コミはこのページにありません。次のページ（「次の20件」など）を開いてください。'); return; }
    const x = items.find(i => i.review.key === f.key);
    if (!x) return;
    x.card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    x.card.style.outline = '3px solid #E8710A'; x.card.style.outlineOffset = '4px';
    const ta = x.card.querySelector('textarea');
    if (ta) { ta.focus({ preventScroll: true }); return; }
    // 返信欄が別の画面にある場合は「この口コミに返信」などを押して開く（移動のためのクリックだけ。送信はしない）
    const link = [...x.card.querySelectorAll('a,button,[role="button"]')].find(b => /この口コミに返信|返信する|返信を書く|口コミに返信/.test(b.innerText || ''));
    if (link) link.click();
  }
  function banner(text) {
    const el = document.createElement('div');
    el.setAttribute('data-tb-assist', '');
    el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 16px;border-radius:8px;background:#372822;color:#fff;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 10000);
  }
  // 「返信する」を押してから返信欄が出てくる画面にも対応
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (!(n instanceof HTMLElement)) continue;
      const tas = n.matches('textarea') ? [n] : [...n.querySelectorAll('textarea')];
      tas.forEach(ta => {
        const x = items.find(i => i.card.contains(ta)) || readCards().find(i => i.card.contains(ta));
        if (x && !x.review.replied && drafts[x.review.key]) fill(x.card, x.review.key, drafts[x.review.key]);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });

  // 「口コミ返信（入力画面）」：一覧の枠に返信欄が無く、1件だけの入力ページに移動した場合
  // （一覧ページに日付などの目印が無いため、findCards() では読み取れない。アプリで選んだ口コミの
  // 下書きを、ここに来たらそのまま入力する）
  if (/\/owner_rst\/reply_entry/.test(location.pathname)) {
    (async () => {
      const ta = document.querySelector('textarea');
      if (!ta || (ta.value.trim() && ta.dataset.tbAssistFilled !== '1')) return;
      const f = await send({ type: 'takeFocus' });
      if (!f.key) return;
      const r = await send({ type: 'getDrafts', media: 'tabelog', store: storeName(), reviews: [{ key: f.key, replied: false }] });
      const draft = r.drafts && r.drafts[f.key];
      if (!draft) return;
      setValue(ta, draft);
      ta.dataset.tbAssistFilled = '1';
      ta.style.outline = '2px solid #372822';
      label(ta, '<b>AIが作成した返信文です。</b>内容を確認・修正して、返信ボタンを押してください（この拡張機能は送信しません）。（書き直すときはアプリの「指示を入れて書き直す」を使ってください）');
    })();
    return;
  }

  run();
})();
