# Croatia Amazing Race — Family Comp Site

A private, team-based “Amazing Race” site for your family trip: rotating challenges, photo uploads, quizzes, comments, live scoreboard, and a downloadable scrapbook when the race ends.

**Live on GitHub Pages** — static HTML/CSS/JS with optional **Firebase** so every phone stays in sync (required for Croatia).

## Quick start (try it now)

1. Open `index.html` in a browser (or serve locally: `python3 -m http.server 8080`).
2. Copy `js/config.example.js` → `js/config.js` and set `adminPassword`.
3. Log in as **Admin** → add teams → share each **team code** privately.
4. **Start race** → first team in the list creates the first challenge on their phone.

> **Demo mode** (no Firebase): data lives in one browser only. Fine for testing UI; **set up Firebase before the trip** so all devices share photos and scores.

## Privacy on a public repo

The GitHub repo can stay public; the site is “private” by design:

| Layer | How |
|--------|-----|
| **Team codes** | 6-character codes — only people you text can log in |
| **Admin password** | In `js/config.js` (gitignored — never commit) |
| **No search** | `noindex` meta tag |
| **Firebase** | Optional rules + Auth later; photos in your Firebase project, not in git |

This is not bank-grade security — it stops casual visitors. For stricter access, enable Firebase Auth in a later iteration.

## Firebase setup (before Croatia)

1. Create a project at [Firebase Console](https://console.firebase.google.com).
2. Enable **Firestore** and **Storage**.
3. Register a **Web app** and copy config into `js/config.js`:

```js
window.RACE_CONFIG = {
  adminPassword: "your-secret",
  firebase: {
    apiKey: "...",
    authDomain: "...",
    projectId: "...",
    storageBucket: "...",
    messagingSenderId: "...",
    appId: "...",
  },
  raceName: "Croatia Amazing Race 2026",
};
```

4. Deploy rules (install [Firebase CLI](https://firebase.google.com/docs/cli)):

```bash
firebase init  # select Firestore + Storage, use existing project
firebase deploy --only firestore:rules,storage
```

5. Push to GitHub — Pages will serve `index.html` at your site URL.

## How the race works

1. **Admin** sets schedule (start/end), creates teams (2–4 members each).
2. **Start race** — teams rotate who designs the next challenge.
3. **Designer** publishes a task: photo challenge, quiz (A–D), text, or combo; duration **1d / 1w / 1month**.
4. Task **auto-ends** when the timer hits zero → **scoring** phase.
5. Admin **auto-scores** (quiz = correct letter, photo = full points) or enters scores manually.
6. **Next round** — next team designs a task.
7. **End race** → winner banner + **download scrapbook** (HTML slideshow of all photos).

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell |
| `css/styles.css` | Croatia-themed UI |
| `js/config.example.js` | Default config template |
| `js/config.js` | Your secrets (gitignored) |
| `js/store.js` | Data + Firebase/localStorage |
| `js/app.js` | UI and game logic |
| `js/scrapbook.js` | Downloadable memory book |
| `firestore.rules` / `storage.rules` | Firebase security starters |

## Backup

Admin → **Setup** → **Export JSON**. Import on another device or after a reset.

## Roadmap (fine-tune together)

- Real AI scoring via API
- Firebase Auth per team
- Push notifications when a task goes live
- PDF scrapbook export

Have an amazing race in Croatia! 🇭🇷
