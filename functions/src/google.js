const SCOPES = "https://www.googleapis.com/auth/business.manage";
const MYBUSINESS = "https://mybusiness.googleapis.com/v4";

async function json(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* 本文なし */
  }
  if (!res.ok || body?.error) {
    const msg = body?.error?.message || body?.error_description || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body || {};
}

function buildAuthUrl({ clientId, redirectUri, state }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCode({ clientId, clientSecret, redirectUri, code }) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code",
    }),
  });
  return json(res);
}

async function refreshAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  return json(res);
}

async function listAccounts(accessToken) {
  const res = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await json(res);
  return body.accounts || [];
}

async function listLocations(accessToken, accountName) {
  const res = await fetch(
    `${MYBUSINESS}/${accountName}/locations?pageSize=100&read_mask=name,locationName`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const body = await json(res);
  return body.locations || [];
}

async function fetchReviews(accessToken, locationName) {
  const res = await fetch(
    `${MYBUSINESS}/${locationName}/reviews?pageSize=50&orderBy=${encodeURIComponent("updateTime desc")}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const body = await json(res);
  return body.reviews || [];
}

async function postReply(accessToken, reviewName, comment) {
  const res = await fetch(`${MYBUSINESS}/${reviewName}/reply`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ comment }),
  });
  return json(res);
}

module.exports = {
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  listAccounts,
  listLocations,
  fetchReviews,
  postReply,
};
