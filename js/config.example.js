/**
 * Copy this file to config.js (gitignored) and fill in your values.
 * Never commit config.js — it holds your admin password and optional Firebase keys.
 */
window.RACE_CONFIG = {
  /** Site-wide admin password (you only) */
  adminPassword: "change-me-before-croatia",

  /**
   * Optional: Firebase for real multi-phone sync + photo storage.
   * Create a project at https://console.firebase.google.com
   * Enable Firestore + Storage, paste web app config below.
   * Deploy firestore.rules and storage.rules from repo root.
   */
  firebase: null,
  // firebase: {
  //   apiKey: "...",
  //   authDomain: "...",
  //   projectId: "...",
  //   storageBucket: "...",
  //   messagingSenderId: "...",
  //   appId: "...",
  // },

  /** Race display name */
  raceName: "Croatia Amazing Race 2026",

  /** Max photo size before compression (bytes) */
  maxPhotoBytes: 800000,
};
