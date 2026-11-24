import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="container section">
      <h1>Page not found</h1>
      <p className="lede">That page does not exist in this app. The tools are all on the home page.</p>
      <div className="toolbar">
        <Link className="btn" to="/">Back to all tools</Link>
      </div>
    </div>
  );
}
