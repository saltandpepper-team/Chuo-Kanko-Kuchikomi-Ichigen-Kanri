// Firebase SDK initialization (Analytics only — this app stores no data in Firebase).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-analytics.js";

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
