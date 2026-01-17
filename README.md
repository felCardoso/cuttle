# 🦑 Cuttle Web - Multiplayer Card Game

![Project Status](https://img.shields.io/badge/Status-In_Development-yellow) ![Tech Stack](https://img.shields.io/badge/Tech-JavaScript_%7C_Firebase-orange)

A real-time web implementation of **Cuttle**, the oldest un-patented deck-building card game. This project allows two players to battle online using a standard 52-card deck, featuring strategic mechanics like point-building, attacking (scuttling), and special card effects.

## 📸 Screenshots

## 🎮 Features

- **Real-Time Multiplayer:** Instant synchronization between players using Firebase Realtime Database.
- **Lobby System:** Create private rooms or join existing ones by name.
- **Reactive UI:** Automatic updates for hand management, deck count, discard pile, and turn status.

### ⚔️ Game Mechanics Implemented

The game faithfully recreates the core rules of Cuttle:

- **Points:** Play number cards (A-10) to build your score (Goal: 21+).
- **Scuttling:** Attack opponent's point cards with higher value cards to destroy them.
- **Royals:**
  - **Kings:** Reduce the winning goal (e.g., 1 King means you only need 14 points).
  - **Queens:** Protect your other cards from being targeted.
  - **Jacks:** Steal an opponent's point card.
- **Glasses (8):** The Eight plays as a permanent that reveals the opponent's hand.

#### ⚡ One-Off Effects (Trash Capabilities)

In Cuttle, number cards (A-7 and 9) can be discarded to trigger powerful immediate effects instead of being played for points:

- **Ace:** **Wipe the Board.** Scraps all Point cards on the table.
- **2:** **Counter.** Halts a One-Off effect. Can be played out of turn.
- **3:** **Rummage.** Search the discard pile (scrap) for a specific card and add it to your hand.
- **4:** **Force Discard.** Forces the opponent to discard 2 cards of their choice from their hand.
- **5:** **Draw.** Draws 2 cards from the deck.
- **6:** **Wipe Royals.** Scraps all Royal and Permanent cards (Kings, Queens, Jacks, Glasses) on the table.
- **7:** **Extra Turn.** Draw one card and immediately play one card.
- **9:** **Bounce.** Returns a permanent card on the table to its owner's hand.

## 📜 Rules

New to Cuttle? It plays like a combat version of "Magic: The Gathering" but played with a standard poker deck.

👉 **[Click here to read the full Rules of Cuttle](https://github.com/shmup/card-game-rules/blob/master/cuttle.md)**

## 🛠️ Tech Stack

- **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6 Modules).
- **Backend/Database:** Firebase Realtime Database.
- **Environment:** Requires a local server (e.g., Live Server) to handle ES6 module imports.

## 🚀 How to Run Locally

Follow these steps to clone and run the game on your machine:

### 1. Clone the repository

```bash
git clone [https://github.com/YOUR-USERNAME/cuttle-web.git](https://github.com/YOUR-USERNAME/cuttle-web.git)
cd cuttle-web
```

### 2. Configure Firebase

Since this project relies on Firebase, you need to provide your own credentials.

1. Create a project at the Firebase Console.

2. Set up a Realtime Database (Start in Test Mode for development).

3. Create a file named firebase-config.js in the root folder.

4. Paste your configuration (from Firebase Project Settings):

```js
// firebase-config.js
import { initializeApp } from "[https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js](https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js)";
import {
  getDatabase,
  ref,
  set,
  onValue,
  update,
  get,
  push,
  runTransaction,
} from "[https://www.gstatic.com/firebasejs/12.7.0/firebase-database.js](https://www.gstatic.com/firebasejs/12.7.0/firebase-database.js)";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, set, onValue, update, get, push, runTransaction };
```

### 3. Run a Local Server

Because the project uses JavaScript Modules (import/export), you cannot simply open index.html in the browser. You must serve it.

- **VS Code:** Install the **Live Server** extension and click "Go Live".

- **Python:** Run `python -m http.server 5500` in the terminal.

### 4. Play

Open your browser at `http://127.0.0.1:5500`.
_Open a second tab (or incognito window) to simulate the second player._

## 🤝 Contributing

Contributions are welcome! Feel free to open issues for bugs or submit Pull Requests for new features.

## 📝 License

This project is licensed under the MIT License.
