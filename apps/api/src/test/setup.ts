// Runs before each test file (see vitest.config.ts `setupFiles`).
// `src/config/constants.ts` and `src/utils/pixel-jwt.ts` read these at
// import/call time, so they must exist before any app module loads.
process.env.PIXEL_SIGNING_SECRET ||= "test-pixel-secret";
process.env.PROTOCOL ||= "https";
process.env.DOMAIN ||= "sendlit.test";
process.env.EMAIL_FROM ||= "platform@sendlit.test";
