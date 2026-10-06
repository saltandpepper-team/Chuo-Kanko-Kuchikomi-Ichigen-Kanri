// 口コミ一元管理アプリのバックエンド（Firebase Cloud Functions 上の Express アプリ）
// ・ログイン確認：Firebase Authentication のIDトークン＋許可したメールアドレスのみ
// ・Google Business Profile / Instagram（Facebookログイン）とOAuthで連携し、トークンはFirestoreにだけ保存
//   （パスワードは扱わない。ブラウザにトークンを渡さない）
// ・口コミ・コメントの取得、返信の投稿（AIの返信文はアプリ内の Firebase AI Logic で作成）
const express = require('express');

const STORES = ['山麓園', '浅間茶屋'];
const GRAPH = 'https://graph.facebook.com/v23.0';
const STAR = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const PROVIDERS = ['google', 'instagram'];

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

/**
 * @param {object} d 依存（テストで差し替えるため注入）
 * @param {{get:(p:string)=>Promise<object|null>, set:(p:string,v:object)=>Promise<void>, del:(p:string)=>Promise<void>}} d.db
 * @param {(token:string)=>Promise<{email?:string,uid:string}>} d.verifyIdToken
 * @param {typeof fetch} d.fetch
 * @param {()=>object} d.config 実行時に読む設定（シークレット等）
 * @param {()=>string} d.randomId
 * @param {()=>number} [d.now]
 */
function createApp(d) {
  const now = d.now || (() => Date.now());
  const app = express();
  app.use(express.json({ limit: '200kb' }));
  const cfg = () => d.config();
  const wrap = fn => (req, res) => fn(req, res).catch(e => {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    res.status(status).json({ error: e.message || 'サーバーエラー' });
  });
  const storeOf = v => { if (!STORES.includes(v)) throw new HttpError(400, '店舗の指定が正しくありません'); return v; };
  const providerOf = v => { if (!PROVIDERS.includes(v)) throw new HttpError(404, '未対応の媒体です'); return v; };

  async function json(res) {
    let body = null; try { body = await res.json(); } catch (e) {}
    if (!res.ok || body?.error) {
      const msg = body?.error?.message || body?.error_description || (typeof body?.error === 'string' ? body.error : '') || `HTTP ${res.status}`;
      throw new HttpError(502, msg);
    }
    return body || {};
  }

  // ---- ログイン確認 ----
  async function auth(req, res, next) {
    try {
      const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
      if (!m) throw new HttpError(401, 'ログインしてください');
      let user;
      try { user = await d.verifyIdToken(m[1]); } catch (e) { throw new HttpError(401, 'ログインの有効期限が切れました。もう一度ログインしてください'); }
      const allowed = String(cfg().allowedEmails || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (!user.email || !allowed.includes(user.email.toLowerCase())) throw new HttpError(403, 'このアカウントには利用権限がありません');
      req.user = user;
      next();
    } catch (e) { res.status(e.status || 401).json({ error: e.message }); }
  }

  // ---- 連携状態 ----
  const connPath = (store, provider) => `connections/${store}/providers/${provider}`;
  async function getConn(store, provider) { return (await d.db.get(connPath(store, provider))) || null; }
  function publicConn(c) {
    if (!c) return { connected: false };
    return {
      connected: !!c.selected, needsPick: !c.selected && !!(c.candidates || []).length,
      label: c.selected?.label || '', candidates: !c.selected ? (c.candidates || []).map(x => ({ id: x.id, label: x.label })) : undefined,
      connectedAt: c.connectedAt || null
    };
  }

  // ---- Google ----
  const G_SCOPE = 'https://www.googleapis.com/auth/business.manage';
  function redirectUri(provider) { return `${String(cfg().publicBaseUrl).replace(/\/+$/, '')}/api/${provider}/callback`; }
  async function googleAccessToken(refreshToken) {
    const c = cfg();
    const j = await json(await d.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.googleClientId, client_secret: c.googleClientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString()
    }));
    return j.access_token;
  }
  async function googleCandidates(token) {
    const H = { headers: { Authorization: `Bearer ${token}` } };
    const acc = await json(await d.fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', H));
    const out = [];
    for (const a of acc.accounts || []) {
      const l = await json(await d.fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title&pageSize=100`, H));
      for (const loc of l.locations || []) out.push({ id: `${a.name}/${loc.name}`, label: loc.title || loc.name });
    }
    return out;
  }

  // ---- Instagram（Facebookログイン） ----
  const IG_SCOPE = 'instagram_basic,instagram_manage_comments,pages_show_list,pages_read_engagement,business_management';
  async function igCandidates(userToken) {
    const j = await json(await d.fetch(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&access_token=${encodeURIComponent(userToken)}`));
    return (j.data || []).filter(p => p.instagram_business_account).map(p => ({
      id: p.instagram_business_account.id, label: `@${p.instagram_business_account.username || ''}（${p.name}）`,
      pageId: p.id, pageToken: p.access_token, username: p.instagram_business_account.username || ''
    }));
  }

  // OAuth開始：連携ページのURLを返す
  app.get('/api/:provider/auth-url', auth, wrap(async (req, res) => {
    const provider = providerOf(req.params.provider), store = storeOf(req.query.store), c = cfg();
    const state = d.randomId();
    await d.db.set(`oauthStates/${state}`, { provider, store, uid: req.user.uid, createdAt: now() });
    let url;
    if (provider === 'google') {
      url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: c.googleClientId, redirect_uri: redirectUri('google'), response_type: 'code', scope: G_SCOPE,
        access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state
      });
    } else {
      url = 'https://www.facebook.com/v23.0/dialog/oauth?' + new URLSearchParams({
        client_id: c.metaAppId, redirect_uri: redirectUri('instagram'), response_type: 'code', scope: IG_SCOPE, state
      });
    }
    res.json({ url });
  }));

  // OAuthの戻り先（ブラウザのリダイレクトで呼ばれるため、IDトークンの代わりに state で確認）
  app.get('/api/:provider/callback', async (req, res) => {
    const back = (q) => res.redirect(302, `${String(cfg().publicBaseUrl).replace(/\/+$/, '')}/?${new URLSearchParams(q)}`);
    let provider = req.params.provider, store = '';
    try {
      providerOf(provider);
      const state = String(req.query.state || '');
      const st = state && await d.db.get(`oauthStates/${state}`);
      if (state) await d.db.del(`oauthStates/${state}`);
      if (!st || st.provider !== provider || now() - st.createdAt > 15 * 60 * 1000) throw new HttpError(400, '連携の有効期限が切れました。もう一度お試しください');
      store = st.store;
      if (req.query.error) throw new HttpError(400, '連携がキャンセルされました');
      const code = String(req.query.code || '');
      if (!code) throw new HttpError(400, '認可コードがありません');
      const c = cfg();
      let saved;
      if (provider === 'google') {
        const tok = await json(await d.fetch('https://oauth2.googleapis.com/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ code, client_id: c.googleClientId, client_secret: c.googleClientSecret, redirect_uri: redirectUri('google'), grant_type: 'authorization_code' }).toString()
        }));
        if (!tok.refresh_token) throw new HttpError(400, 'Googleから更新用トークンを受け取れませんでした。もう一度連携してください');
        const candidates = await googleCandidates(tok.access_token);
        saved = { refreshToken: tok.refresh_token, candidates, selected: candidates.length === 1 ? candidates[0] : null, connectedAt: now(), by: st.uid };
      } else {
        const short = await json(await d.fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({ client_id: c.metaAppId, client_secret: c.metaAppSecret, redirect_uri: redirectUri('instagram'), code })));
        const long = await json(await d.fetch(`${GRAPH}/oauth/access_token?` + new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: c.metaAppId, client_secret: c.metaAppSecret, fb_exchange_token: short.access_token })));
        const candidates = await igCandidates(long.access_token);
        saved = { candidates, selected: candidates.length === 1 ? candidates[0] : null, connectedAt: now(), by: st.uid };
      }
      await d.db.set(connPath(store, provider), saved);
      back({ connected: provider, store, ...(saved.selected ? {} : { pick: '1' }) });
    } catch (e) {
      console.error(e);
      back({ connectError: provider, store, message: e.message || '連携に失敗しました' });
    }
  });

  // 連携状態の一覧
  app.get('/api/status', auth, wrap(async (req, res) => {
    const out = {};
    for (const s of STORES) { out[s] = {}; for (const p of PROVIDERS) out[s][p] = publicConn(await getConn(s, p)); }
    res.json({ stores: out });
  }));
  // 複数の店舗（ロケーション／アカウント）がある場合に選ぶ
  app.post('/api/:provider/select', auth, wrap(async (req, res) => {
    const provider = providerOf(req.params.provider), store = storeOf(req.body.store);
    const c = await getConn(store, provider);
    const pick = (c?.candidates || []).find(x => x.id === req.body.id);
    if (!pick) throw new HttpError(400, '選択肢が見つかりません');
    await d.db.set(connPath(store, provider), { ...c, selected: pick });
    res.json({ ok: true, status: publicConn({ ...c, selected: pick }) });
  }));
  app.post('/api/:provider/disconnect', auth, wrap(async (req, res) => {
    const provider = providerOf(req.params.provider), store = storeOf(req.body.store);
    await d.db.del(connPath(store, provider));
    res.json({ ok: true });
  }));

  // ---- 口コミ・コメントの取得 ----
  async function requireConn(store, provider) {
    const c = await getConn(store, provider);
    if (!c?.selected) throw new HttpError(409, `${provider === 'google' ? 'Google' : 'Instagram'}が未連携です。API接続設定から連携してください`);
    return c;
  }
  app.get('/api/reviews', auth, wrap(async (req, res) => {
    const store = storeOf(req.query.store), media = providerOf(req.query.media);
    const c = await requireConn(store, media);
    if (media === 'google') {
      const token = await googleAccessToken(c.refreshToken);
      const j = await json(await d.fetch(`https://mybusiness.googleapis.com/v4/${c.selected.id}/reviews?pageSize=50&orderBy=${encodeURIComponent('updateTime desc')}`, { headers: { Authorization: `Bearer ${token}` } }));
      return res.json({ items: (j.reviews || []).map(v => ({
        media: 'google', extId: 'google:' + v.name, extName: v.name,
        author: v.reviewer?.displayName || 'Googleユーザー', rating: STAR[v.starRating] ?? null,
        createTime: v.createTime, text: v.comment || '', reply: v.reviewReply?.comment || ''
      })) });
    }
    const tk = encodeURIComponent(c.selected.pageToken), uid = encodeURIComponent(c.selected.id);
    const media2 = await json(await d.fetch(`${GRAPH}/${uid}/media?fields=id,caption,permalink,timestamp&limit=10&access_token=${tk}`));
    const items = [];
    for (const p of media2.data || []) {
      const cm = await json(await d.fetch(`${GRAPH}/${p.id}/comments?fields=id,text,username,timestamp,replies{username,text}&limit=50&access_token=${tk}`));
      for (const k of cm.data || []) {
        if (k.username === c.selected.username) continue;
        const mine = (k.replies?.data || []).find(x => x.username === c.selected.username);
        items.push({ media: 'instagram', extId: 'instagram:' + k.id, extName: k.id, permalink: p.permalink,
          author: '@' + (k.username || 'instagram'), rating: null, createTime: k.timestamp, text: k.text || '', reply: mine?.text || '' });
      }
    }
    res.json({ items });
  }));

  // ---- 返信の投稿 ----
  app.post('/api/reply', auth, wrap(async (req, res) => {
    const store = storeOf(req.body.store), media = providerOf(req.body.media);
    const comment = String(req.body.comment || '').trim(), name = String(req.body.extName || '');
    if (!comment) throw new HttpError(400, '返信文が空です');
    if (comment.length > 4000) throw new HttpError(400, '返信文が長すぎます');
    const c = await requireConn(store, media);
    if (media === 'google') {
      // 連携している店舗（ロケーション）の口コミ以外には返信させない
      if (!name.startsWith(c.selected.id + '/reviews/')) throw new HttpError(400, 'この店舗の口コミではありません');
      const token = await googleAccessToken(c.refreshToken);
      await json(await d.fetch(`https://mybusiness.googleapis.com/v4/${name}/reply`, {
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ comment })
      }));
    } else {
      if (!/^\d+$/.test(name)) throw new HttpError(400, 'コメントIDが正しくありません');
      await json(await d.fetch(`${GRAPH}/${name}/replies`, { method: 'POST', body: new URLSearchParams({ message: comment, access_token: c.selected.pageToken }) }));
    }
    res.json({ ok: true });
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: '見つかりません' }));
  return app;
}

module.exports = { createApp, STORES };
