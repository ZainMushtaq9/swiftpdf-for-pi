import Header from "../components/Header.jsx";
import Footer from "../components/Footer.jsx";
import Router from "./router.jsx";

export default function App() {
  return (
    <div>
      <a className="skip-link" href="#main">Skip to content</a>
      <Header />
      <main id="main">
        <Router />
      </main>
      <Footer />
    </div>
  );
}
