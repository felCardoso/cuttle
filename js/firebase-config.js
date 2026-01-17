import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  onValue,
  update,
  get,
  push,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCtz2gj5OVQVSyqUzAyIN-Gses1M0cbx24",
  authDomain: "cuttle-game.firebaseapp.com",
  databaseURL: "https://cuttle-game-default-rtdb.firebaseio.com",
  projectId: "cuttle-game",
  storageBucket: "cuttle-game.firebasestorage.app",
  messagingSenderId: "722273491866",
  appId: "1:722273491866:web:b87f771426a7f88bd1f823",
  measurementId: "G-3MHG2B0BL8",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, set, onValue, update, get, push, runTransaction };
