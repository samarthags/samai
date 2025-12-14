// lib/firebaseClient.js
import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyBb3x_zD9JaFwL9PhmngCNZlS2fOh6MBa4",
    authDomain: "newai-52371.firebaseapp.com",
    projectId: "newai-52371",
    storageBucket: "newai-52371.appspot.com",
    messagingSenderId: "480586908639",
    appId: "1:480586908639:web:f4645a852c4df724c6fa6a"
};

let app;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

const db = getFirestore(app);
export { db };