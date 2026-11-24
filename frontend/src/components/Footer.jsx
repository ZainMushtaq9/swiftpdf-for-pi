import { Link } from "react-router-dom";
import { APP_NAME } from "../config/site.js";

// No external links anywhere in the app: the Mainnet Listing
// Requirements discourage redirecting users to outside sites.
export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <h3>{APP_NAME}</h3>
            <p>Free PDF tools that run entirely in your browser. Your files never leave your device.</p>
          </div>
          <div>
            <h3>Tools</h3>
            <p>
              <Link to="/tools/merge-pdf">Merge PDF</Link><br />
              <Link to="/tools/split-pdf">Split PDF</Link><br />
              <Link to="/tools/compress-pdf">Compress PDF</Link><br />
              <Link to="/tools/ocr-pdf">OCR PDF &amp; Images</Link><br />
              <Link to="/">All 13 tools</Link>
            </p>
          </div>
          <div>
            <h3>About</h3>
            <p>
              <Link to="/pro">Pro — unlock with Pi</Link><br />
              <Link to="/privacy">Privacy policy</Link>
            </p>
            <p style={{ fontSize: ".88rem", opacity: 0.85 }}>
              Built for the Pi Next hackathon. Sign-in and payments use your Pi account — no email or password needed.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
