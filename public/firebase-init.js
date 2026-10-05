// Firebase SDK initialization (Analytics + Authentication for the production backend).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-analytics.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

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

// 本番のログイン（Firebase Authentication）。index.html から window.appBackend 経由で使う
const auth = getAuth(app);
window.appBackend = {
  signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
  signOut: () => signOut(auth),
  token: () => (auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null)),
  onUser: (cb) => onAuthStateChanged(auth, cb),
};
window.dispatchEvent(new Event("app-backend-ready"));
