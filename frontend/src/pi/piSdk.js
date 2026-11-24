// Pi SDK loader — lazy, so the landing page never touches Pi until the
// user chooses to sign in or upgrade. NEVER call Pi.authenticate on
// first load: PiNet requires a guest flow (visitors without a Pi account
// must be able to browse), and the Mainnet Listing Requirements forbid
// a hard auth wall on load.
//
// Sandbox vs Mainnet: VITE_PI_SANDBOX (default true) selects Testnet.
// The same code points at either network; the choice lives in the env
// and in the app registration (Staging vs Production), which cannot be
// changed later — so local testing always uses the sandbox.
//
// VITE_PI_MOCK=true installs a fake window.Pi (dev only) so the full
// sign-in -> payment -> entitlement loop can be exercised locally
// against the backend's mock mode, with no Pi account and no real Pi.
const SDK_URL = "https://sdk.minepi.com/pi-sdk.js";

export function isMockMode() {
  return import.meta.env.VITE_PI_MOCK === "true";
}

export function isSandbox() {
  // Default true: local dev and Testnet. Set VITE_PI_SANDBOX=false only
  // for the Production (Mainnet) build, with a Production app registered.
  return import.meta.env.VITE_PI_SANDBOX !== "false";
}

function createMockPi() {
  // Dev-only stub. Mirrors the real SDK surface the app uses.
  return {
    _version: "2.0-mock",
    init() {},
    authenticate() {
      return Promise.resolve({
        accessToken: "mock-access-token",
        user: { uid: "mock-user-uid", username: "mockpioneer" },
      });
    },
    createPayment({ amount, memo, metadata }, callbacks) {
      const paymentId = `mock-payment-${Date.now()}`;
      // Simulate the real handshake timing: approval first, then the
      // user "signs", then completion. The app's callbacks call the
      // backend (mock mode) in between, exactly like the real flow.
      setTimeout(() => callbacks.onReadyForServerApproval?.(paymentId), 300);
      setTimeout(
        () => callbacks.onReadyForServerCompletion?.(paymentId, `mock-txid-${Date.now()}`),
        900,
      );
      return { identifier: paymentId, amount, memo, metadata };
    },
    getPiHostAppInfo() {
      return { version: "mock", platform: "mock" };
    },
  };
}

let loadPromise = null;

export async function loadPiSdk() {
  if (typeof window === "undefined") throw new Error("Pi SDK needs a browser.");
  if (window.Pi) return window.Pi;
  if (isMockMode()) {
    window.Pi = createMockPi();
    return window.Pi;
  }
  if (!loadPromise) {
    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => {
        try {
          if (!window.Pi) throw new Error("Pi SDK script loaded but window.Pi is missing.");
          window.Pi.init({ version: "2.0", sandbox: isSandbox() });
          resolve(window.Pi);
        } catch (err) {
          loadPromise = null;
          reject(err);
        }
      };
      script.onerror = () => {
        loadPromise = null;
        reject(new Error("Could not load the Pi SDK. Check your connection and try again."));
      };
      document.head.appendChild(script);
    });
  }
  return loadPromise;
}

// True when the app runs inside Pi Browser (where real Pi sign-in and
// payments work). Outside Pi Browser, sign-in shows guidance instead
// of failing silently.
export function inPiBrowser() {
  if (isMockMode()) return true;
  if (typeof window === "undefined") return false;
  try {
    return typeof window.Pi !== "undefined" || /PiBrowser/i.test(navigator.userAgent || "");
  } catch {
    return false;
  }
}
