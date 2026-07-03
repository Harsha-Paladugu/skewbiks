/* Skewbiks.com — shared site config.
   This single block is loaded by every page so login + per-user data work
   site-wide. Leave firebase:null to run in demo mode (data stays in this
   browser). The apiKey here is a public client identifier, not a secret —
   access is controlled by the Firestore security rules. */
window.OO_CONFIG = {
  firebase: null,   // demo mode until the Skewbiks Firebase project exists (see SETUP.md)

  adminEmails: ["harsha.paladugu2@gmail.com"],   // your Google account email

  // Public Google Form where visitors can apply to become a moderator. Paste
  // the form's share URL here; the OO page links it wherever it invites people
  // to request access. Leave "" to show a "not open yet" note instead of a link.
  moderatorFormUrl: ""
};
