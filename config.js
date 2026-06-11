// BirdRoute deployment config.
//
// Common setups:
// 1. Same-origin deployment:
//    apiBase: ""
//
// 2. Frontend and backend deployed separately:
//    apiBase: "https://api.example.com"
//
// 3. Local development:
//    Keep apiBase empty. BirdRoute auto-detects file:// or localhost frontend
//    and connects to localApiBase.
window.BIRDROUTE_CONFIG = {
  apiBase: "https://43.157.57.204.sslip.io",
  localApiBase: "http://127.0.0.1:5001",
  xhsHelperBase: "http://127.0.0.1:5127"
};
