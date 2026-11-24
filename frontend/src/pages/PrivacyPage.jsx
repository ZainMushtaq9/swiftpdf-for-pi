import { useEffect } from "react";
import { APP_NAME } from "../config/site.js";

// Privacy policy (in-app copy). The submission artifact is the same
// text in assets/PRIVACY_POLICY.md — keep the two in sync.
export default function PrivacyPage() {
  useEffect(() => {
    document.title = `Privacy Policy — ${APP_NAME}`;
  }, []);

  return (
    <div className="container section">
      <p className="kicker">Privacy policy</p>
      <h1>Privacy Policy</h1>
      <p className="lede">Last updated: 24 November 2026. This policy covers the {APP_NAME} app.</p>

      <h2>The short version</h2>
      <p>
        Your files never leave your device. Every PDF tool in this app runs entirely in your browser — merging,
        splitting, compressing, rotating, watermarking, numbering, signing and converting all happen locally with
        open-source libraries (pdf-lib, PDF.js, Tesseract). We do not upload, store, see or share your documents.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Guests (no sign-in):</strong> nothing. We collect no personal data from guests at all. Your
          tool settings (such as the theme) are stored only in your own browser.
        </li>
        <li>
          <strong>Signed-in users (Sign in with Pi):</strong> your Pi username and your Pi user ID, and — only
          if you buy Pro — your Pro payment record (the Pi payment ID and transaction ID). We store these so
          your Pro unlock follows you to any device where you sign in with Pi.
        </li>
        <li>
          <strong>We never collect:</strong> your email address, phone number, files, file names, file contents,
          or your Pi wallet passphrase. Pi Network never shares your passphrase with us, and we will never ask
          for it.
        </li>
      </ul>

      <h2>How your files are handled</h2>
      <p>
        All processing is client-side: your PDF or image is read into your browser&apos;s memory, processed there,
        and the result is downloaded straight back to your device. Nothing is sent to our server. The one
        exception is the OCR engine: on first use, the Tesseract OCR code and English language data (about 10 MB)
        download from a public content delivery network (CDN) to your browser. That download is code, not your
        file — your document still never leaves your device.
      </p>
      <p>
        <strong>Future server-side features:</strong> this version of the app has none. If a future feature ever
        needs a file to be processed on our server (for example server-side OCR), that feature will process the
        file in memory and delete it immediately afterwards — no file will be stored, logged or kept — and this
        policy will be updated before the feature ships.
      </p>

      <h2>Payments</h2>
      <p>
        Pro is a one-time payment in Pi, made through Pi Wallet and recorded on the Pi blockchain. We receive
        the payment ID and transaction ID from Pi so we can confirm the payment and unlock Pro. We never see or
        handle your wallet passphrase, and we never charge you without your approval in Pi Wallet. Pi
        subscriptions are not used by this app.
      </p>

      <h2>Sign-in</h2>
      <p>
        Sign-in uses Pi Authentication only — there is no email or password login, and no third-party login. When
        you sign in, Pi gives our server a short-lived access token; the server checks it directly with Pi and
        then issues its own session token, stored in your browser. Signing out deletes the session.
      </p>

      <h2>Data we store, and for how long</h2>
      <ul>
        <li>Pi username and user ID: kept while your account exists, so Pro can be restored.</li>
        <li>Pro payment records: kept so your unlock can be re-verified against the Pi blockchain at any time.</li>
        <li>Session tokens: expire automatically after 30 days; signing out deletes them immediately.</li>
        <li>Your saved signature (Pro): stored only in your own browser&apos;s local storage, never on our server.</li>
      </ul>

      <h2>Your choices</h2>
      <p>
        You can use every free tool without signing in. You can sign out at any time. You can ask us to delete
        your stored Pi username, user ID and payment records by contacting us through the Pi app listing — note
        that deleting the payment record also removes the Pro unlock, since the unlock is proven by that record.
        Deleting the app&apos;s data in your browser removes your saved signature and theme.
      </p>

      <h2>Children</h2>
      <p>This app is not directed at children under 18. Pi Network accounts require users to be 18 or older.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes, the new version will be posted on this page with a new &quot;last updated&quot;
        date before the change takes effect.
      </p>
    </div>
  );
}
