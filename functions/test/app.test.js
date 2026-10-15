// バックエンドの動作テスト（Google・Meta・Firestore はすべてモック）
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../app');

function setup() {
  const store = new Map();
  const calls = [];
  let t = 1_000_000;
  const routes = [];
  const on = (re, fn) => routes.push([re, fn]);
  const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fakeFetch = async (url, opt = {}) => {
    calls.push({ url: String(url), method: opt.method || 'GET', body: opt.body ? String(opt.body) : '' });
    for (const [re, fn] of routes) if (re.test(String(url))) return fn(String(url), opt);
    throw new Error('unexpected fetch ' + url);
  };
  const app = createApp({
    db: {
      get: async p => store.has(p) ? structuredClone(store.get(p)) : null,
      set: async (p, v) => { store.set(p, structuredClone(v)); },
      del: async p => { store.delete(p); },
      list: async p => [...store.entries()].filter(([k]) => k.startsWith(p + '/')).map(([k, v]) => ({ id: k.slice(p.length + 1), ...v }))
    },
    verifyIdToken: async tok => { if (tok === 'good') return { uid: 'u1', email: 'Kayanuma.H@kaneyamaen.co.jp' }; if (tok === 'other') return { uid: 'u2', email: 'x@example.com' }; throw new Error('bad'); },
    fetch: fakeFetch,
    randomId: () => 'state' + (++t),
    now: () => t,
    config: () => ({ googleClientId: 'gid', googleClientSecret: 'gsec', metaAppId: 'mid', metaAppSecret: 'msec', allowedEmails: 'kayanuma.h@kaneyamaen.co.jp', publicBaseUrl: 'https://app.example/', webhookVerifyToken: 'verify123' })
  });
  return { app, store, calls, on, reply, advance: ms => { t += ms; } };
}
async function serve(app) {
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const req = async (method, path, { token = 'good', body, headers = {}, raw } = {}) => {
    const sendBody = raw !== undefined ? raw : (body ? JSON.stringify(body) : undefined);
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...((body || raw !== undefined) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: sendBody });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: res.status, json, location: res.headers.get('location') };
  };
  return { req, close: () => srv.close() };
}

test('ログインしていない・許可されていないアカウントは拒否', async () => {
  const s = setup(); const h = await serve(s.app);
  assert.equal((await h.req('GET', '/api/status', { token: null })).status, 401);
  assert.equal((await h.req('GET', '/api/status', { token: 'bad' })).status, 401);
  assert.equal((await h.req('GET', '/api/status', { token: 'other' })).status, 403);
  assert.equal((await h.req('GET', '/api/status')).status, 200);
  h.close();
});

test('Google：連携→口コミ取得→返信', async () => {
  const s = setup(); const h = await serve(s.app);
  s.on(/oauth2\.googleapis\.com\/token/, (u, o) => s.reply(String(o.body).includes('authorization_code') ? { access_token: 'at1', refresh_token: 'rt1' } : { access_token: 'at2' }));
  s.on(/mybusinessaccountmanagement.*\/accounts$/, () => s.reply({ accounts: [{ name: 'accounts/111' }] }));
  s.on(/mybusinessbusinessinformation.*accounts\/111\/locations/, () => s.reply({ locations: [{ name: 'locations/222', title: '山麓園' }] }));
  s.on(/mybusiness\.googleapis\.com\/v4\/accounts\/111\/locations\/222\/reviews\?/, () => s.reply({ reviews: [{ name: 'accounts/111/locations/222/reviews/R1', reviewer: { displayName: '太郎' }, starRating: 'FOUR', comment: 'ほうとう最高', createTime: '2026-10-01T00:00:00Z' }] }));
  s.on(/\/reviews\/R1\/reply$/, () => s.reply({ comment: 'ok' }));

  const a = await h.req('GET', '/api/google/auth-url?store=' + encodeURIComponent('山麓園'));
  const url = new URL(a.json.url);
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example/api/google/callback');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  const state = url.searchParams.get('state');

  const cb = await h.req('GET', `/api/google/callback?state=${state}&code=C1`, { token: null });
  assert.equal(cb.status, 302);
  assert.match(cb.location, /^https:\/\/app\.example\/\?connected=google&store=/);
  assert.doesNotMatch(cb.location, /pick=/);
  // state は使い捨て
  const again = await h.req('GET', `/api/google/callback?state=${state}&code=C1`, { token: null });
  assert.match(again.location, /connectError=google/);

  const st = await h.req('GET', '/api/status');
  assert.deepEqual(st.json.stores['山麓園'].google.connected, true);
  assert.equal(st.json.stores['山麓園'].google.label, '山麓園');
  assert.equal(JSON.stringify(st.json).includes('rt1'), false, 'トークンはブラウザに返さない');
  assert.equal(st.json.stores['浅間茶屋'].google.connected, false);

  const rv = await h.req('GET', '/api/reviews?media=google&store=' + encodeURIComponent('山麓園'));
  assert.equal(rv.json.items.length, 1);
  assert.equal(rv.json.items[0].rating, 4);
  assert.equal(rv.json.items[0].extName, 'accounts/111/locations/222/reviews/R1');

  const bad = await h.req('POST', '/api/reply', { body: { store: '山麓園', media: 'google', extName: 'accounts/999/locations/1/reviews/X', comment: 'hi' } });
  assert.equal(bad.status, 400, '他の店舗の口コミには返信できない');
  const ok = await h.req('POST', '/api/reply', { body: { store: '山麓園', media: 'google', extName: 'accounts/111/locations/222/reviews/R1', comment: 'ありがとうございます' } });
  assert.equal(ok.status, 200);
  const put = s.calls.find(c => c.method === 'PUT');
  assert.equal(put.body, JSON.stringify({ comment: 'ありがとうございます' }));

  assert.equal((await h.req('GET', '/api/reviews?media=google&store=' + encodeURIComponent('浅間茶屋'))).status, 409);
  h.close();
});

test('Instagram：連携（複数アカウントから選択）→コメント取得→返信', async () => {
  const s = setup(); const h = await serve(s.app);
  s.on(/oauth\/access_token\?.*code=/, () => s.reply({ access_token: 'short' }));
  s.on(/oauth\/access_token\?.*fb_exchange_token/, () => s.reply({ access_token: 'long' }));
  s.on(/\/me\/accounts/, () => s.reply({ data: [
    { id: 'P1', name: '山麓園', access_token: 'PT1', instagram_business_account: { id: '901', username: 'sanrokuen_robata' } },
    { id: 'P2', name: '浅間茶屋', access_token: 'PT2', instagram_business_account: { id: '902', username: 'sengen' } },
    { id: 'P3', name: 'IGなし', access_token: 'PT3' }
  ] }));
  s.on(/\/901\/media/, () => s.reply({ data: [{ id: 'M1', permalink: 'https://instagram.com/p/x' }] }));
  s.on(/\/M1\/comments/, () => s.reply({ data: [
    { id: '55', text: '予約できますか？', username: 'guest', timestamp: '2026-10-02T00:00:00+0000' },
    { id: '56', text: 'お礼', username: 'sanrokuen_robata' },
    { id: '57', text: '美味しかった', username: 'guest2', replies: { data: [{ username: 'sanrokuen_robata', text: 'ありがとうございます' }] } }
  ] }));
  s.on(/\/55\/replies$/, () => s.reply({ id: 'r1' }));
  s.on(/\/P1\/subscribed_apps/, () => s.reply({ success: true }));

  const a = await h.req('GET', '/api/instagram/auth-url?store=' + encodeURIComponent('山麓園'));
  const url = new URL(a.json.url);
  assert.match(url.searchParams.get('scope'), /instagram_manage_comments/);
  const cb = await h.req('GET', `/api/instagram/callback?state=${url.searchParams.get('state')}&code=C2`, { token: null });
  assert.match(cb.location, /pick=1/);

  let st = (await h.req('GET', '/api/status')).json.stores['山麓園'].instagram;
  assert.equal(st.connected, false); assert.equal(st.needsPick, true); assert.equal(st.candidates.length, 2);
  assert.equal(JSON.stringify(st).includes('PT1'), false, 'トークンはブラウザに返さない');
  await h.req('POST', '/api/instagram/select', { body: { store: '山麓園', id: '901' } });
  st = (await h.req('GET', '/api/status')).json.stores['山麓園'].instagram;
  assert.equal(st.connected, true);

  const rv = (await h.req('GET', '/api/reviews?media=instagram&store=' + encodeURIComponent('山麓園'))).json.items;
  assert.deepEqual(rv.map(x => [x.extName, x.reply]), [['55', ''], ['57', 'ありがとうございます']]);
  assert.ok(s.calls.some(c => c.url.includes('access_token=PT1')));

  const r = await h.req('POST', '/api/reply', { body: { store: '山麓園', media: 'instagram', extName: '55', comment: 'お電話でどうぞ' } });
  assert.equal(r.status, 200);
  assert.match(s.calls.find(c => c.method === 'POST' && c.url.includes('/55/replies')).body, /message=/);
  h.close();
});

test('Instagram：投稿が複数ページにまたがっていても、全ページのコメントを集める', async () => {
  const s = setup(); const h = await serve(s.app);
  s.on(/oauth\/access_token\?.*code=/, () => s.reply({ access_token: 'short' }));
  s.on(/oauth\/access_token\?.*fb_exchange_token/, () => s.reply({ access_token: 'long' }));
  s.on(/\/me\/accounts/, () => s.reply({ data: [{ id: 'P1', name: '山麓園', access_token: 'PT1', instagram_business_account: { id: '901', username: 'sanrokuen_robata' } }] }));
  s.on(/\/P1\/subscribed_apps/, () => s.reply({ success: true }));
  s.on(/\/901\/media\?.*after=CUR1/, () => s.reply({ data: [{ id: 'M2', permalink: 'https://instagram.com/p/y' }] }));
  s.on(/\/901\/media/, () => s.reply({ data: [{ id: 'M1', permalink: 'https://instagram.com/p/x' }], paging: { next: 'https://graph.facebook.com/v23.0/901/media?after=CUR1&access_token=PT1' } }));
  s.on(/\/M1\/comments/, () => s.reply({ data: [{ id: '55', text: '1ページ目', username: 'guest' }] }));
  s.on(/\/M2\/comments/, () => s.reply({ data: [{ id: '56', text: '2ページ目', username: 'guest' }] }));

  const a = await h.req('GET', '/api/instagram/auth-url?store=' + encodeURIComponent('山麓園'));
  await h.req('GET', `/api/instagram/callback?state=${new URL(a.json.url).searchParams.get('state')}&code=C9`, { token: null });

  const rv = (await h.req('GET', '/api/reviews?media=instagram&store=' + encodeURIComponent('山麓園'))).json.items;
  assert.deepEqual(rv.map(x => x.extName).sort(), ['55', '56']);
  h.close();
});

test('Instagram：連携後にWebhook購読し、新着コメント・DMをその場で受け取る', async () => {
  const s = setup(); const h = await serve(s.app);
  s.on(/oauth\/access_token\?.*code=/, () => s.reply({ access_token: 'short' }));
  s.on(/oauth\/access_token\?.*fb_exchange_token/, () => s.reply({ access_token: 'long' }));
  s.on(/\/me\/accounts/, () => s.reply({ data: [{ id: 'P1', name: '山麓園', access_token: 'PT1', instagram_business_account: { id: '901', username: 'sanrokuen_robata' } }] }));
  s.on(/\/P1\/subscribed_apps/, () => s.reply({ success: true }));

  const a = await h.req('GET', '/api/instagram/auth-url?store=' + encodeURIComponent('山麓園'));
  await h.req('GET', `/api/instagram/callback?state=${new URL(a.json.url).searchParams.get('state')}&code=C3`, { token: null });
  // 1件しか候補がないので自動で連携完了し、同時にWebhook購読のリクエストが飛ぶ
  assert.ok(s.calls.some(c => c.url.includes('/P1/subscribed_apps') && c.url.includes('access_token=PT1')));

  const crypto = require('node:crypto');
  const payload = JSON.stringify({ object: 'instagram', entry: [
    { id: '901', changes: [{ field: 'comments', value: { id: 'C100', media: { id: 'M9' }, from: { username: 'guest' }, text: '美味しかったです' } }] },
    { id: '901', messaging: [{ sender: { id: '777' }, message: { mid: 'MID1', text: '予約できますか？' } }] }
  ] });
  const sig = 'sha256=' + crypto.createHmac('sha256', 'msec').update(payload).digest('hex');

  const bad = await h.req('POST', '/api/webhooks/instagram', { token: null, raw: payload, headers: { 'X-Hub-Signature-256': 'sha256=0000' } });
  assert.equal(bad.status, 401, '署名が違う通知は拒否する');

  const ok = await h.req('POST', '/api/webhooks/instagram', { token: null, raw: payload, headers: { 'X-Hub-Signature-256': sig } });
  assert.equal(ok.status, 200);

  const verify = await h.req('GET', `/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=verify123&hub.challenge=XYZ`, { token: null });
  assert.equal(verify.status, 200);

  const inbox = (await h.req('GET', '/api/inbox?store=' + encodeURIComponent('山麓園'))).json.items;
  assert.equal(inbox.length, 2);
  assert.ok(inbox.some(x => x.kind === 'comment' && x.text === '美味しかったです'));
  assert.ok(inbox.some(x => x.kind === 'dm' && x.text === '予約できますか？'));
  h.close();
});

test('Instagram：DMの一覧取得と返信', async () => {
  const s = setup(); const h = await serve(s.app);
  s.on(/oauth\/access_token\?.*code=/, () => s.reply({ access_token: 'short' }));
  s.on(/oauth\/access_token\?.*fb_exchange_token/, () => s.reply({ access_token: 'long' }));
  s.on(/\/me\/accounts/, () => s.reply({ data: [{ id: 'P1', name: '山麓園', access_token: 'PT1', instagram_business_account: { id: '901', username: 'sanrokuen_robata' } }] }));
  s.on(/\/P1\/subscribed_apps/, () => s.reply({ success: true }));
  s.on(/\/P1\/conversations/, () => s.reply({ data: [{ id: 'CV1', participants: { data: [{ id: '901' }, { id: '777', username: 'guest' }] } }] }));
  s.on(/\/CV1\?fields=messages/, () => s.reply({ messages: { data: [
    { id: 'm1', message: '予約できますか？', from: { id: '777' }, created_time: '2026-10-01T00:00:00+0000' }
  ] } }));
  s.on(/\/P1\/messages$/, () => s.reply({ success: true }));

  const a = await h.req('GET', '/api/instagram/auth-url?store=' + encodeURIComponent('山麓園'));
  await h.req('GET', `/api/instagram/callback?state=${new URL(a.json.url).searchParams.get('state')}&code=C4`, { token: null });

  const dms = (await h.req('GET', '/api/dms?store=' + encodeURIComponent('山麓園'))).json.items;
  assert.equal(dms.length, 1);
  assert.equal(dms[0].text, '予約できますか？');
  assert.equal(dms[0].extName, '777');

  const r = await h.req('POST', '/api/dm-reply', { body: { store: '山麓園', extName: '777', comment: 'お電話でどうぞ' } });
  assert.equal(r.status, 200);
  const post = s.calls.find(c => c.url.includes('/P1/messages') && c.method === 'POST');
  assert.match(post.body, /recipient/);
  h.close();
});

test('連携の有効期限切れ・キャンセルは画面に戻してエラー表示', async () => {
  const s = setup(); const h = await serve(s.app);
  const a = await h.req('GET', '/api/google/auth-url?store=' + encodeURIComponent('浅間茶屋'));
  const state = new URL(a.json.url).searchParams.get('state');
  s.advance(16 * 60 * 1000);
  assert.match((await h.req('GET', `/api/google/callback?state=${state}&code=C`, { token: null })).location, /connectError=google/);
  const b = await h.req('GET', '/api/google/auth-url?store=' + encodeURIComponent('浅間茶屋'));
  const st2 = new URL(b.json.url).searchParams.get('state');
  assert.match((await h.req('GET', `/api/google/callback?state=${st2}&error=access_denied`, { token: null })).location, /connectError=google/);
  assert.equal((await h.req('GET', '/api/google/auth-url?store=other')).status, 400);
  h.close();
});

