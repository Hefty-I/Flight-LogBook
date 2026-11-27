import { useEffect, useState } from "react";
import { FlightProofProvider } from "./context/FlightProofContext.jsx";
import { useRoles } from "./hooks/useRoles.js";
import Header from "./components/Header.jsx";
import NetworkNotice from "./components/NetworkNotice.jsx";
import TxPanel from "./components/TxPanel.jsx";
import Overview from "./pages/Overview.jsx";
import ComingSoon from "./pages/ComingSoon.jsx";

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

function Shell() {
  const roles = useRoles();
  const tabs = tabsFor(roles);
  const [tab, setTab] = useState("overview");

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
        {tab === "student" && (
          <ComingSoon title="My logbook" description="Log flights, see their verification status, and track your hours." />
        )}
        {tab === "instructor" && (
          <ComingSoon title="Sign flights" description="Co-sign your students' flights, one by one or in a batch." />
        )}
        {tab === "school" && (
          <ComingSoon title="My school" description="Register students and aircraft." />
        )}
        {tab === "authority" && (
          <ComingSoon
            title="Authority"
            description="Register schools and instructors, resolve disputes, issue licences and decide validations."
          />
        )}
        {tab === "verify" && (
          <ComingSoon title="Verify a pilot" description="Anyone can check a pilot's licence and verified hours." />
        )}
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
