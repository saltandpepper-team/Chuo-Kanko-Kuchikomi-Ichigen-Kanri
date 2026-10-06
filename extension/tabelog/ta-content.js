// トリップアドバイザー（Tripadvisor for Business）の口コミページで動く部分
// ・口コミを読み取り、未返信の口コミは開いて全文と返信欄を出し、AIの返信文を返信欄に入れる
//   ※送信ボタンは押さない。担当者が内容を確認して押す
(() => {
  const DATE = /(\d{4})年(\d{1,2})月(\d{1,2})日/;
  const UI = /^(AIが作成した返信文です|返信文を確認しています|返信文がまだありません|書き直すときは|AIが返信文を作成しています|AIで作成できませんでした|AIで作り直す|公開された返信|口コミを翻訳|原文を表示|翻訳を表示|お気に入りとして設定|お気に入りから削除|口コミを報告する|口コミへの返信方法|返信を削除する|返信を編集|表示される名前|送信|返信する|もっと見る|続きを読む|一部を表示|Your response|訪問日|旅行のタイプ|Date of visit)/;
  const META = /(投稿\d[\d,]*件|役に立った|^[•・]$|^[●○◐◑◒◓◯⬤\s]+$)/;
  const send = msg => new Promise(res => { try { chrome.runtime.sendMessage(msg, r => res(r || {})); } catch (e) { res({}); } });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const locationId = new URLSearchParams(location.search).get('locationId') || '';

  function setValue(el, v) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** 投稿日（2025年8月14日）ごとに、他の口コミの投稿日を含まない最大の親要素＝口コミ1件の枠とみなす */
  function findCards() {
    const els = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const el = w.currentNode.parentElement;
      if (!el || el.closest('[data-ta-assist]') || el.closest('textarea')) continue;
      // 返信の日付（「〜に返信」など）や、画面に表示されていない日付は口コミの区切りに使わない
      if (DATE.test(w.currentNode.nodeValue) && !/返信|回答|respon/i.test(el.textContent) && el.getClientRects().length && DATE.test(el.innerText || '')) els.push(el);
    }
    // 同じ口コミの中に投稿日が2回出る（閉じた表示と開いた表示）場合に備え、同じ日付・同じ投稿者の枠をまとめる
    const anchors = els.filter((el, i) => !els.some((o, k) => k !== i && o !== el && el.contains(o)));
    const cards = anchors.map(el => {
      let card = el;
      while (card.parentElement && card.parentElement !== document.body) {
        const p = card.parentElement;
        if (anchors.some(o => o !== el && p.contains(o) && !card.contains(o))) break;
        card = p;
      }
      return card;
    });
    return [...new Set(cards)];
  }
  function ratingOf(card) {
    const texts = [];
    card.querySelectorAll('[aria-label],[title]').forEach(el => texts.push(el.getAttribute('aria-label') || el.getAttribute('title') || ''));
    card.querySelectorAll('svg title, title').forEach(el => texts.push(el.textContent || '')); // SVGの中の<title>（例：5段階中5.0）
    for (const t of texts) {
      const m = t.match(/5\s*段階中\s*(\d(?:\.\d)?)/) || t.match(/(\d(?:\.\d)?)\s*(?:\/\s*5|of\s*5|段階中)/i) || t.match(/バブル評価\s*(\d(?:\.\d)?)/);
      if (m) return +m[1];
    }
    // 旧形式：class="ui_bubble_rating bubble_45"
    const b = card.querySelector('[class*="bubble_"]');
    const m = b && String(b.className).match(/bubble_(\d)(\d)/);
    if (m) return +(m[1] + '.' + m[2]);
    return null;
  }
  function parseCard(card) {
    const lines = card.innerText.split('\n').map(s => s.trim()).filter(Boolean);
    const di = lines.findIndex(l => DATE.test(l));
    if (di < 0) return null;
    const [, y, m, d] = lines[di].match(DATE);
    const author = (di > 0 ? lines[0] : '').replace(/\s+/g, '');
    const rest = lines.slice(di + 1).filter(l => !UI.test(l) && !META.test(l) && !DATE.test(l) && !/スタッフ、その他$/.test(l));
    const title = rest[0] || '';
    const body = rest.slice(1).join('\n');
    const ta = card.querySelector('textarea');
    const replied = /公開された返信|返信を削除する/.test(card.innerText) || !!(ta && ta.value.trim() && ta.dataset.taAssistFilled !== '1');
    return {
      key: `tripadvisor:${author}|${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`,
      author: author || 'トリップアドバイザーのユーザー', rating: ratingOf(card), date: `${+m}/${+d}`, title,
      text: [title ? `【${title}】` : '', body].filter(Boolean).join('\n'),
      replied, reply: replied && ta ? ta.value.trim() : '', truncated: /…$/.test(body) || !ta
    };
  }
  function read() {
    const seen = new Map();
    for (const card of findCards()) {
      const r = parseCard(card);
      if (!r) continue;
      const prev = seen.get(r.key);
      // 同じ口コミが2つの枠に分かれた場合は、返信欄がある方・本文が長い方を使う
      if (!prev || (!prev.card.querySelector('textarea') && card.querySelector('textarea')) || r.text.length > prev.review.text.length) seen.set(r.key, { card, review: r });
    }
    return [...seen.values()];
  }
  /** 閉じている口コミを開く（全文と返信欄を表示するため。送信はしない） */
  function expand(card) {
    if (card.querySelector('textarea')) return false;
    // 口コミの枠そのものがボタンになっている画面（閉じた状態の口コミ）
    if (card.matches('button,[role="button"]')) { card.click(); return true; }
    const wrapBtn = [...card.querySelectorAll('button,[role="button"]')].find(b => DATE.test(b.innerText || ''));
    if (wrapBtn) { wrapBtn.click(); return true; }
    let btn = card.querySelector('[aria-expanded="false"]');
    // 右上の ∨ （文字のないアイコンだけのボタン）
    if (!btn) btn = [...card.querySelectorAll('button,[role="button"]')].reverse().find(b => !b.innerText.trim() && b.querySelector('svg,img,i,span'));
    if (btn) { btn.click(); return true; }
    return false;
  }
  function label(ta, html) {
    let el = ta.previousElementSibling;
    if (!el || !el.hasAttribute('data-ta-assist')) {
      el = document.createElement('div');
      el.setAttribute('data-ta-assist', '');
      el.style.cssText = 'margin:6px 0;padding:6px 10px;border-radius:6px;background:#F1ECE7;color:#372822;font-size:12px;line-height:1.6';
      ta.parentElement.insertBefore(el, ta);
    }
    el.innerHTML = html;
    return el;
  }
  let items = [], drafts = {}, store = '', mode = null;
  function fill(card, key, reply) {
    const ta = card.querySelector('textarea');
    if (!ta || !reply) return false;
    if (ta.value.trim() && ta.dataset.taAssistFilled !== '1') return false; // 担当者が入力済み・返信済みなら上書きしない
    setValue(ta, reply);
    ta.dataset.taAssistFilled = '1';
    ta.style.outline = '2px solid #372822';
    label(ta, '<b>AIが作成した返信文です。</b>内容を確認・修正して、送信ボタンを押してください（この拡張機能は送信しません）。（書き直すときはアプリの「指示を入れて書き直す」を使ってください）');
    return true;
  }
  /** 診断情報（設定画面の「診断情報をコピー」用）：画面の作りが想定と違うときの調査に使う */
  function diag() {
    const body = document.body.innerText;
    return {
      url: location.href, cards: findCards().length,
      pageReplyLabels: (body.match(/公開された返信/g) || []).length,
      pageTextareas: document.querySelectorAll('textarea').length,
      pageToggles: document.querySelectorAll('[aria-expanded]').length,
      samples: findCards().slice(0, 3).map(c => ({
        text: c.innerText.slice(0, 700), toggles: c.querySelectorAll('[aria-expanded]').length,
        textareas: [...c.querySelectorAll('textarea')].map(t => t.value.slice(0, 40)),
        tag: c.tagName + (c.className && typeof c.className === 'string' ? '.' + c.className.split(/\s+/).slice(0, 3).join('.') : ''),
        rating: ratingOf(c),
        ratingHint: (c.querySelector('svg') ? c.querySelector('svg').outerHTML : '').replace(/<path[^>]*>/g, '<path/>').slice(0, 400)
      }))
    };
  }
  const isLoginPage = () => !!document.querySelector('input[type="password"]') || /RegistrationController|\/login/i.test(location.pathname);

  async function run() {
    // 口コミが表示されるまで待つ（画面はあとから読み込まれる）
    let t = 0;
    while (t < 25000 && !read().length) { if (isLoginPage()) break; await sleep(500); t += 500; }
    if (!read().length) {
      if (isLoginPage() || /ログイン|サインイン|Sign in/i.test(document.body.innerText.slice(0, 3000))) { send({ type: 'needLogin' }); return; }
      send({ type: 'pageData', media: 'tripadvisor', locationId, pageUrl: location.href, reviews: [], note: '口コミが見つかりませんでした' });
      return;
    }
    mode = (await send({ type: 'pageMode' })).mode;
    if (mode === 'check') {
      // 裏での定期確認：未返信の口コミを1件ずつ開いて全文を読む（トリップアドバイザーは1件開くと他が閉じるため）
      const full = {};
      const keys = read().filter(x => !x.review.replied).map(x => x.review.key).slice(0, 40);
      for (const key of keys) {
        const x = read().find(i => i.review.key === key);
        if (!x || x.card.querySelector('textarea')) { if (x) full[key] = x.review.text; continue; }
        if (!expand(x.card)) continue;
        for (let k = 0; k < 10; k++) { await sleep(300); const y = read().find(i => i.review.key === key); if (y && y.card.querySelector('textarea')) { full[key] = y.review.text; break; } }
      }
      items = read().map(x => ({ ...x, review: { ...x.review, text: full[x.review.key] || x.review.text } }));
      await send({ type: 'pageData', media: 'tripadvisor', locationId, pageUrl: location.href, reviews: items.map(x => x.review), diag: diag() });
      return;
    }
    // 担当者が見ているとき：勝手に開閉せず、口コミを開いて返信欄が出たときに入力する
    items = read();
    const res = await send({ type: 'pageData', media: 'tripadvisor', locationId, pageUrl: location.href, reviews: items.map(x => x.review), diag: diag() });
    store = res.store || '';
    document.querySelectorAll('textarea').forEach(onTextarea);
  }
  /** 返信欄が現れたら、その口コミのAI返信文を入れる（なければその場で作成） */
  const busy = new Set();
  async function onTextarea(ta) {
    if (mode !== 'assist') return; // 裏での定期確認のときは入力しない
    const x = read().find(i => i.card.contains(ta));
    if (!x || x.review.replied || busy.has(x.review.key)) return;
    if (ta.value.trim() && ta.dataset.taAssistFilled !== '1') return;
    if (!items.some(i => i.review.key === x.review.key)) items.push(x); else items = items.map(i => i.review.key === x.review.key ? x : i);
    if (drafts[x.review.key]) { fill(x.card, x.review.key, drafts[x.review.key]); return; }
    busy.add(x.review.key);
    label(ta, '返信文を確認しています…');
    const r = await send({ type: 'getDrafts', media: 'tripadvisor', locationId, store, reviews: [x.review] });
    busy.delete(x.review.key);
    const y = read().find(i => i.review.key === x.review.key) || x;
    if (r.drafts?.[x.review.key]) { drafts[x.review.key] = r.drafts[x.review.key]; fill(y.card, x.review.key, drafts[x.review.key]); }
    else { const t2 = y.card.querySelector('textarea'); if (t2) label(t2, (r.error || '返信文がまだありません').replace(/[<>&]/g, '')); }
  }
  // 担当者が口コミを開いて返信欄が出てきたときに入力する
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (!(n instanceof HTMLElement)) continue;
      (n.matches('textarea') ? [n] : [...n.querySelectorAll('textarea')]).forEach(onTextarea);
    }
  }).observe(document.body, { childList: true, subtree: true });

  run();
})();
