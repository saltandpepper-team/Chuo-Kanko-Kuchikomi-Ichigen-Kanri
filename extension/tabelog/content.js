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
      const near = (el.parentElement?.innerText || el.innerText || '');
      if (/訪問/.test(near)) dateEls.push(el);
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
  function readCards() {
    return findCards().map(card => {
      const r = parseTabelog(card.innerText)[0];
      if (!r) return null;
      return { card, review: { key: r.extId, author: r.author, rating: r.rating, text: r.text, title: r.title, date: r.date, replied: !!r.reply, reply: r.reply || '' } };
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
    const el = label(ta, '<b>AIが作成した返信文です。</b>内容を確認・修正して、返信ボタンを押してください（この拡張機能は送信しません）。 <button type="button" data-tb-redo style="margin-left:6px;font-size:12px">AIで作り直す</button>');
    el.querySelector('[data-tb-redo]').onclick = async e => {
      e.preventDefault();
      e.target.disabled = true; e.target.textContent = '作成中…';
      const item = items.find(x => x.review.key === key);
      const r = await send({ type: 'getDrafts', media: 'tabelog', store: storeName(), reviews: [item.review], force: true });
      if (r.drafts?.[key]) { ta.dataset.tbAssistFilled = '1'; fill(card, key, r.drafts[key]); }
      else label(ta, `AIで作成できませんでした：${(r.error || '').replace(/[<>&]/g, '')}`);
    };
    return true;
  }

  let items = [], drafts = {};
  async function run() {
    items = readCards();
    const store = storeName();
    const res = await send({ type: 'pageData', media: 'tabelog', store, pageUrl: location.href, reviews: items.map(x => x.review) });
    if (res.mode !== 'assist') return; // 裏での定期確認のときは入力しない
    const pending = items.filter(x => !x.review.replied);
    if (!pending.length) return;
    pending.forEach(x => { const ta = x.card.querySelector('textarea'); if (ta && !ta.value.trim()) label(ta, 'AIが返信文を作成しています…'); });
    const r = await send({ type: 'getDrafts', media: 'tabelog', store, reviews: pending.map(x => x.review) });
    drafts = r.drafts || {};
    pending.forEach(x => {
      const ta = x.card.querySelector('textarea');
      if (!fill(x.card, x.review.key, drafts[x.review.key]) && ta && !drafts[x.review.key] && !ta.value.trim()) label(ta, `AIで作成できませんでした：${(r.error || '不明なエラー').replace(/[<>&]/g, '')}`);
    });
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

  run();
})();
