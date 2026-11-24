# Privacy Policy — SwiftPDF for Pi

Last updated: 24 November 2026.

## The short version

Your files never leave your device. Every PDF tool in this app runs entirely in your browser — merging, splitting, compressing, rotating, watermarking, numbering, signing and converting all happen locally with open-source libraries (pdf-lib, PDF.js, Tesseract). We do not upload, store, see or share your documents.

## What we collect

- **Guests (no sign-in):** nothing. We collect no personal data from guests at all. Your tool settings (such as the theme) are stored only in your own browser.
- **Signed-in users (Sign in with Pi):** your Pi username and your Pi user ID, and — only if you buy Pro — your Pro payment record (the Pi payment ID and transaction ID). We store these so your Pro unlock follows you to any device where you sign in with Pi.
- **We never collect:** your email address, phone number, files, file names, file contents, or your Pi wallet passphrase. Pi Network never shares your passphrase with us, and we will never ask for it.

## How your files are handled

All processing is client-side: your PDF or image is read into your browser's memory, processed there, and the result is downloaded straight back to your device. Nothing is sent to our server. The one exception is the OCR engine: on first use, the Tesseract OCR code and English language data (about 10 MB) download from a public content delivery network (CDN) to your browser. That download is code, not your file — your document still never leaves your device.

**Future server-side features:** this version of the app has none. If a future feature ever needs a file to be processed on our server (for example server-side OCR), that feature will process the file in memory and delete it immediately afterwards — no file will be stored, logged or kept — and this policy will be updated before the feature ships.

## Payments

Pro is a one-time payment in Pi, made through Pi Wallet and recorded on the Pi blockchain. We receive the payment ID and transaction ID from Pi so we can confirm the payment and unlock Pro. We never see or handle your wallet passphrase, and we never charge you without your approval in Pi Wallet. Pi subscriptions are not used by this app.

## Sign-in

Sign-in uses Pi Authentication only — there is no email or password login, and no third-party login. When you sign in, Pi gives our server a short-lived access token; the server checks it directly with Pi and then issues its own session token, stored in your browser. Signing out deletes the session.

## Data we store, and for how long

- Pi username and user ID: kept while your account exists, so Pro can be restored.
- Pro payment records: kept so your unlock can be re-verified against the Pi blockchain at any time.
- Session tokens: expire automatically after 30 days; signing out deletes them immediately.
- Your saved signature (Pro): stored only in your own browser's local storage, never on our server.

## Your choices

You can use every free tool without signing in. You can sign out at any time. You can ask us to delete your stored Pi username, user ID and payment records by contacting us through the Pi app listing — note that deleting the payment record also removes the Pro unlock, since the unlock is proven by that record. Deleting the app's data in your browser removes your saved signature and theme.

## Children

This app is not directed at children under 18. Pi Network accounts require users to be 18 or older.

## Changes

If this policy changes, the new version will be posted on this page with a new "last updated" date before the change takes effect.
