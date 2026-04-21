/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Exclude Node.js-only modules from the browser bundle (needed by @xenova/transformers)
    config.resolve.alias = {
      ...config.resolve.alias,
      "sharp$": false,
      "onnxruntime-node$": false,
    };
    return config;
  },

  // COOP + COEP headers are required for SharedArrayBuffer, which is used by
  // onnxruntime-web (the Whisper WASM runtime) on every browser.
  // "credentialless" COEP is less strict than "require-corp" and works with
  // third-party CDN assets (Google Fonts, etc.) without extra opt-in headers.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy",  value: "same-origin"    },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
