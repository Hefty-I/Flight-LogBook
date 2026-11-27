import { useEffect, useState } from "react";
import { FlightProofProvider } from "./context/FlightProofContext.jsx";
import { useRoles } from "./hooks/useRoles.js";
import Header from "./components/Header.jsx";
import NetworkNotice from "./components/NetworkNotice.jsx";
import TxPanel from "./components/TxPanel.jsx";
import Overview from "./pages/Overview.jsx";
import StudentPage from "./pages/StudentPage.jsx";
import InstructorPage from "./pages/InstructorPage.jsx";
import SchoolPage from "./pages/SchoolPage.jsx";
import AuthorityPage from "./pages/AuthorityPage.jsx";
import VerifyPage from "./pages/VerifyPage.jsx";

/** Tabs appear only for roles the connected wallet actually holds (role-dependent UI). */
function tabsFor(roles) {
  const tabs = [{ id: "overview", label: "Overview" }];
  if (roles?.studentSchoolId) tabs.push({ id: "student", label: "My logbook" });
  if (roles?.instructor) tabs.push({ id: "instructor", label: "Sign flights" });
  if (roles?.schoolId) tabs.push({ id: "school", label: "My school" });
  if (roles?.authorityId) tabs.push({ id: "authority", label: "Authority" });
  tabs.push({ id: "verify", label: "Verify a pilot" });
  return tabs;
}

// A shared link like ?pilot=0x... opens the public verify page directly.
const initialTab = () => (new URLSearchParams(window.location.search).has("pilot") ? "verify" : "overview");

function Shell() {
  const roles = useRoles();
  const tabs = tabsFor(roles);
  const [tab, setTab] = useState(initialTab);

  // If the wallet changes and loses the role of the open tab, go back to the overview.
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab("overview");
  }, [tabs, tab]);

  return (
    <>
      <Header />
      <main className="container">
        <NetworkNotice />
        <nav className="tabs">
          {tabs.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>

        {tab === "overview" && <Overview roles={roles} />}
        {tab === "student" && <StudentPage roles={roles} />}
        {tab === "instructor" && <InstructorPage roles={roles} />}
        {tab === "school" && <SchoolPage roles={roles} />}
        {tab === "authority" && <AuthorityPage roles={roles} />}
        {tab === "verify" && <VerifyPage />}
      </main>
      <TxPanel />
    </>
  );
}

export default function App() {
  return (
    <FlightProofProvider>
      <Shell />
    </FlightProofProvider>
  );
}
