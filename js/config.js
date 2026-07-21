/* Skewbiks.com — shared site config.
   This single block is loaded by every page so login + per-user data work
   site-wide. Leave firebase:null to run in demo mode (data stays in this
   browser). The apiKey here is a public client identifier, not a secret —
   access is controlled by the Firestore security rules. */
window.OO_CONFIG = {
  firebase: {
    apiKey: "AIzaSyBmOQGH9toKetXn4qmy1Gtire52mhOPmh8",
    authDomain: "skewbiks.firebaseapp.com",
    projectId: "skewbiks",
    storageBucket: "skewbiks.firebasestorage.app",
    messagingSenderId: "276959790417",
    appId: "1:276959790417:web:c902eb3b39c60d81a4bf70"
  },

  // UI gating ONLY (shows the admin/moderation tabs). Actual write access is
  // enforced by the Firestore rules, which trust solely the admins/{uid}
  // collection — an email here with no admins doc gets "Missing or
  // insufficient permissions" on every admin query. See SETUP.md.
  adminEmails: ["harsha.paladugu2@gmail.com"],   // your Google account email

  // Public Google Form where visitors can apply to become a moderator. Paste
  // the form's share URL here; the OO page links it wherever it invites people
  // to request access. Leave "" to show a "not open yet" note instead of a link.
  moderatorFormUrl: ""
};
