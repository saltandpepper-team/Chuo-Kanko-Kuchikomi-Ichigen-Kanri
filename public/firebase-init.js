// Firebase SDK initialization — Analytics / Authentication。
// このアプリのデータ（口コミ・連携情報）はすべてCloud Functions（/api/*）経由でやり取りするため、
// クライアント側ではFirestoreには直接アクセスしない。
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-analytics.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD_MPoBkHVdPDD2jz67iK-BGGsY93g4YuI",
  authDomain: "chuo-kanko.firebaseapp.com",
  projectId: "chuo-kanko",
  storageBucket: "chuo-kanko.firebasestorage.app",
  messagingSenderId: "5788029924",
  appId: "1:5788029924:web:3d79dc0e9428203e9fedf1",
};

const app = initializeApp(firebaseConfig);

isSupported()
  .then((supported) => {
    if (supported) getAnalytics(app);
  })
  .catch(() => {});

const auth = getAuth(app);

// public/index.html はこの window.appBackend を通じてログイン状態とAPI呼び出し用トークンを得る。
window.appBackend = {
  token: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
  signIn: (id, password) => signInWithEmailAndPassword(auth, id, password),
  signOut: () => signOut(auth),
  onUser: (callback) => onAuthStateChanged(auth, callback),
};
window.dispatchEvent(new Event("app-backend-ready"));
