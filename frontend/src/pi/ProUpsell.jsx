import { Link } from "react-router-dom";

// Inline upsell shown when a free-tier limit is hit. Honest copy: what
// is blocked, what Pro unlocks, and that it is one Pi payment, once.
export default function ProUpsell({ reason }) {
  return (
    <div className="notice" role="status" style={{ marginTop: 12 }}>
      <strong>Pro feature.</strong> {reason}{" "}
      <Link to="/pro">Unlock Pro with Pi</Link> — a one-time payment, yours for good.
    </div>
  );
}
