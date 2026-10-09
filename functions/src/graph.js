const { GRAPH_API_VERSION } = require("./config");

/**
 * Facebook Graph APIを叩く小さなヘルパー。
 * Node 20のグローバルfetchを使用（追加の依存関係なし）。
 */
async function graphRequest(path, params = {}, { method = "GET" } = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${path}`);
  const init = { method };
  if (method === "GET") {
    Object.entries(params).forEach(([k, v]) => {
      if (v != null) url.searchParams.set(k, v);
    });
  } else {
    const body = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v != null) body.set(k, v);
    });
    init.body = body;
  }
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const message = json.error?.message || `Graph API error (HTTP ${res.status})`;
    const err = new Error(message);
    err.graphError = json.error;
    err.status = res.status;
    throw err;
  }
  return json;
}

module.exports = { graphRequest };
