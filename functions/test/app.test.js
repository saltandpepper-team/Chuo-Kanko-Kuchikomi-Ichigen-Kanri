// バックエンドの動作テスト（Google・Meta・OpenAI・Firestore はすべてモック）
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
    db: { get: async p => store.has(p) ? structuredClone(store.get(p)) : null, set: async (p, v) => { store.set(p, structuredClone(v)); }, del: async p => { store.delete(p); } },
    verifyIdToken: async tok => { if (tok === 'good') return { uid: 'u1', email: 'Kayanuma.H@kaneyamaen.co.jp' }; if (tok === 'other') return { uid: 'u2', email: 'x@example.com' }; throw new Error('bad'); },
    fetch: fakeFetch,
    randomId: () => 'state' + (++t),
    now: () => t,
    config: () => ({ googleClientId: 'gid', googleClientSecret: 'gsec', metaAppId: 'mid', metaAppSecret: 'msec', openaiApiKey: 'sk', openaiModel: 'mini', openaiModelHigh: 'big', allowedEmails: 'kayanuma.h@kaneyamaen.co.jp', publicBaseUrl: 'https://app.example/' })
  });
  return { app, store, calls, on, reply, advance: ms => { t += ms; } };
}
async function serve(app) {
  const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const req = async (method, path, { token = 'good', body } = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
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
  assert.match(s.calls.find(c => c.method === 'POST').body, /message=/);
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

test('AI：プロンプトを受け取り返信文を返す（指示ありは上位モデル）', async () => {
  const s = setup(); const h = await serve(s.app);
  s.on(/api\.openai\.com/, (u, o) => s.reply({ choices: [{ message: { content: ' 返信文です ' } }], model: JSON.parse(o.body).model }));
  const r = await h.req('POST', '/api/ai/generate', { body: { prompt: '口コミ…', tier: 'default' } });
  assert.equal(r.json.text, '返信文です');
  assert.equal(JSON.parse(s.calls.at(-1).body).model, 'big');
  await h.req('POST', '/api/ai/generate', { body: { prompt: '口コミ…', tier: 'quick' } });
  assert.equal(JSON.parse(s.calls.at(-1).body).model, 'mini');
  assert.equal((await h.req('POST', '/api/ai/generate', { body: { prompt: '' } })).status, 400);
  assert.equal((await h.req('POST', '/api/ai/generate', { token: null, body: { prompt: 'x' } })).status, 401);
  h.close();
});
