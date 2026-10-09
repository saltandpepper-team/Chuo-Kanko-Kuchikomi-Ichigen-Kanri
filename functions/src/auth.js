const { auth, db } = require("./admin");

/**
 * Expressミドルウェア：Firebase AuthのIDトークンを検証し、
 * staffコレクションに登録済みのアカウントだけを通す。
 */
async function requireAuth(req, res, next) {
  const header = req.get("Authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return res.status(401).json({ error: "ログインが必要です" });
  try {
    const decoded = await auth.verifyIdToken(match[1]);
    const staffSnap = await db.collection("staff").doc(decoded.uid).get();
    if (!staffSnap.exists) {
      return res.status(403).json({ error: "このアカウントには権限がありません" });
    }
    req.uid = decoded.uid;
    next();
  } catch (e) {
    res.status(401).json({ error: "ログインの有効期限が切れました。もう一度ログインしてください" });
  }
}

module.exports = { requireAuth };
