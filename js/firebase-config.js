import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

export const firebaseConfig = {
    apiKey: "AIzaSyCj3XrBxi1c3RokMzCIhEB3hjJB-BPuO9Y",
    databaseURL: "https://homebasedb-default-rtdb.asia-southeast1.firebasedatabase.app",
    authDomain: "homebasedb.firebaseapp.com",
    projectId: "homebasedb",
    storageBucket: "homebasedb.firebasestorage.app",
    messagingSenderId: "476832900272",
    appId: "1:476832900272:web:443bacb7cbc3113e9f8775"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// 私有模式在任何 Firestore 查詢前恢復預設 App 的身分；舊模式不額外載入 Auth SDK。
const { PRIVATE_IDENTITY_ENABLED } = await import('./identity-config.js');
if (PRIVATE_IDENTITY_ENABLED) {
    const {getAuth}=await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js');
    await getAuth(app).authStateReady();
}
