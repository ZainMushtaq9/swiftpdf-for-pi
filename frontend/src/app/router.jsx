import { Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import Home from "../pages/Home.jsx";

const ToolPage = lazy(() => import("../pages/ToolPage.jsx"));
const ProPage = lazy(() => import("../pages/ProPage.jsx"));
const PrivacyPage = lazy(() => import("../pages/PrivacyPage.jsx"));
const NotFound = lazy(() => import("../pages/NotFound.jsx"));

export default function Router() {
  return (
    <Suspense fallback={<div className="container section"><p>Loading…</p></div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tools/:slug" element={<ToolPage />} />
        <Route path="/pro" element={<ProPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
