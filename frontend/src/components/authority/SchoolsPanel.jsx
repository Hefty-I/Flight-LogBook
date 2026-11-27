import { useState } from "react";
import { isAddress } from "ethers";
import { useFlightProof } from "../../context/FlightProofContext.jsx";
import { shortAddress } from "../../lib/format.js";

/**
 * Separation of duties: the AUTHORITY registers schools and instructors (instructors hold an
 * authority-issued rating); schools only register their own students and aircraft.
 * Revoking an instructor puts every pilot they signed for under review.
 */
export default function SchoolsPanel({ authorityId, schools, instructors }) {
  const { runTx } = useFlightProof();
  const [schoolAdmin, setSchoolAdmin] = useState("");
  const [insSchool, setInsSchool] = useState("");
  const [insAddress, setInsAddress] = useState("");

  const registerSchool = (e) => {
    e.preventDefault();
    runTx("Register a flight school", (c) => c.registry.registerSchool(authorityId, schoolAdmin.trim()));
  };
  const registerInstructor = (e) => {
    e.preventDefault();
    const schoolId = Number(insSchool || schools[0]?.id);
    runTx(`Register instructor at school #${schoolId}`, (c) => c.registry.registerInstructor(schoolId, insAddress.trim()));
  };
  const revoke = (address) => {
    const ok = window.confirm(
      `Revoke instructor ${address}?\n\nThey can no longer sign, and every pilot they signed for goes UNDER REVIEW until you re-check them. This cannot be undone.`,
    );
    if (ok) runTx(`Revoke instructor ${shortAddress(address)}`, (c) => c.registry.revokeInstructor(address));
  };

  return (
    <div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>School</th>
              <th>Admin wallet</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {schools.map((s) => (
              <tr key={s.id}>
                <td>#{s.id}</td>
                <td className="mono" title={s.admin}>
                  {shortAddress(s.admin)}
                </td>
                <td className={s.active ? "ok-text" : "error-text"}>{s.active ? "Active" : "Deactivated"}</td>
                <td className="row-actions">
                  <button
                    className={`btn small ${s.active ? "danger" : ""}`}
                    onClick={() =>
                      runTx(`${s.active ? "Deactivate" : "Activate"} school #${s.id}`, (c) =>
                        c.registry.setSchoolActive(s.id, !s.active),
                      )
                    }
                  >
                    {s.active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="inline-form" onSubmit={registerSchool}>
        <input placeholder="New school's admin wallet (0x…)" value={schoolAdmin} onChange={(e) => setSchoolAdmin(e.target.value)} />
        <button className="btn" disabled={!isAddress(schoolAdmin.trim())}>
          Register school
        </button>
      </form>

      <h2 className="sub">Instructors</h2>
      {instructors.length === 0 ? (
        <p className="muted">No instructors yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Instructor</th>
                <th>School</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {instructors.map((i) => (
                <tr key={i.address}>
                  <td className="mono" title={i.address}>
                    {shortAddress(i.address)}
                  </td>
                  <td>#{i.schoolId}</td>
                  <td className={i.active ? "ok-text" : "error-text"}>{i.active ? "Active" : "Revoked"}</td>
                  <td className="row-actions">
                    {i.active && (
                      <button className="btn small danger" onClick={() => revoke(i.address)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {schools.length > 0 && (
        <form className="inline-form" onSubmit={registerInstructor}>
          <select value={insSchool || schools[0].id} onChange={(e) => setInsSchool(e.target.value)}>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                School #{s.id}
              </option>
            ))}
          </select>
          <input placeholder="Instructor wallet (0x…)" value={insAddress} onChange={(e) => setInsAddress(e.target.value)} />
          <button className="btn" disabled={!isAddress(insAddress.trim())}>
            Register instructor
          </button>
        </form>
      )}
    </div>
  );
}
