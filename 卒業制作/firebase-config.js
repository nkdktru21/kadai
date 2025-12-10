// Firebase SDKを読み込み
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

// あなたのFirebase設定情報（この部分は自分の値のままでOK）
export const firebaseConfig = {
  apiKey: "AIzaSyAFdXe0tBoKtJ49YM9A6XZpVL2S7OopAMo",
  authDomain: "kadai-app-6e194.firebaseapp.com",
  projectId: "kadai-app-6e194",
  storageBucket: "kadai-app-6e194.firebasestorage.app",
  messagingSenderId: "100723347441",
  appId: "1:100723347441:web:4a4511355c57e37189fe50",
  measurementId: "G-W326YXP1ZS"
};

// Firebaseを初期化
const app = initializeApp(firebaseConfig);

// 各機能を取得
const auth = getAuth(app);
const db = getFirestore(app);

// ここで “export” する！← これが大事！
export { app, auth, db };
