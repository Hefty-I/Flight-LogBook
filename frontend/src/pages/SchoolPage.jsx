import { useEffect, useState } from "react";
import { isAddress } from "ethers";
import { useFlightProof } from "../context/FlightProofContext.jsx";
import { useSchoolStudents } from "../hooks/useSchoolStudents.js";
import { bytesToText, hoursMinutes, icao24ToBytes3, registrationToBytes8, shortAddress } from "../lib/format.js";

/**
 * "My school": the school admin registers its own students and aircraft.
 * (Instructors are registered by the authority, not the school: separation of duties.)
 */
export default function SchoolPage({ roles }) {
  const { contracts, runTx, refreshKey } = useFlightProof();
  const schoolId = roles.schoolId;
  const { students } = useSchoolStudents(schoolId);
  const [info, setInfo] = useState(null);
  const [student, setStudent] = useState("");
  const [ac, setAc] = useState({ icao24: "", registration: "", adsb: true });

  useEffect(() => {
    if (!contracts) return;
    let stopped = false;
    (async () => {
      const { registry, authorities } = contracts;
      const [school, count] = await Promise.all([registry.getSchool(schoolId), registry.aircraftCount()]);
      const [authorityName] = await authorities.getAuthority(school.authorityId);
      const all = await Promise.all(
        Array.from({ length: Number(count) }, async (_, i) => ({ id: i + 1, ...(await registry.aircraftInfo(i + 1)).toObject() })),
      );
      const aircraft = all
        .filter((a) => Number(a.schoolId) === schoolId)
        .map((a) => ({
          id: a.id,
          icao24: a.icao24.slice(2),
          registration: bytesToText(a.registration),
          adsb: a.adsbEquipped,
          active: a.active,
        }));
      if (!stopped) setInfo({ active: school.active, authorityName, aircraft });
    })();
    return () => {
      stopped = true;
    };
  }, [contracts, schoolId, refreshKey]);

  let aircraftError = null;
  try {
    if (ac.icao24 || ac.registration) {
      icao24ToBytes3(ac.icao24);
      registrationToBytes8(ac.registration);
    }
  } catch (err) {
    aircraftError = err.message;
  }

  const addStudent = (e) => {
    e.preventDefault();
    runTx("Register a student", (c) => c.registry.registerStudent(student.trim()));
  };
  const addAircraft = (e) => {
    e.preventDefault();
    runTx(`Register aircraft ${ac.registration.toUpperCase()}`, (c) =>
      c.registry.registerAircraft(icao24ToBytes3(ac.icao24), registrationToBytes8(ac.registration), ac.adsb),
    );
  };

  if (!info) return <p className="muted">Loading your school…</p>;

  return (
    <div className="grid">
      <section className="card wide">
        <div className="eyebrow">School #{schoolId}</div>
        <h2 className="title">Flight school under {info.authorityName}</h2>
        {!info.active && <p className="error-text">This school has been deactivated by its authority.</p>}
      </section>

      <section className="card">
        <h2>Students</h2>
        {students.length === 0 ? (
          <p className="muted">No students yet.</p>
        ) : (
          <ul className="stats">
            {students.map((s) => (
              <li key={s.address}>
                <span className="mono" title={s.address}>
                  {shortAddress(s.address)}
                </span>
                <strong>{hoursMinutes(s.total)}</strong>
              </li>
            ))}
          </ul>
        )}
        <form className="inline-form" onSubmit={addStudent}>
          <input placeholder="Student wallet (0x…)" value={student} onChange={(e) => setStudent(e.target.value)} />
          <button className="btn" disabled={!isAddress(student.trim())}>
            Register student
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Aircraft</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reg.</th>
                <th>ICAO24</th>
                <th>ADS-B</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {info.aircraft.map((a) => (
                <tr key={a.id}>
                  <td>{a.registration}</td>
                  <td className="mono">{a.icao24}</td>
                  <td>{a.adsb ? "Yes" : "No"}</td>
                  <td className="row-actions">
                    <button
                      className={`btn small ${a.active ? "danger" : ""}`}
                      onClick={() =>
                        runTx(`${a.active ? "Ground" : "Reactivate"} ${a.registration}`, (c) =>
                          c.registry.setAircraftActive(a.id, !a.active),
                        )
                      }
                    >
                      {a.active ? "Ground" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="form" onSubmit={addAircraft} style={{ marginTop: "1rem" }}>
          <label>
            ICAO24 (6 hex)
            <input value={ac.icao24} maxLength={6} placeholder="3c6444" onChange={(e) => setAc({ ...ac, icao24: e.target.value })} />
          </label>
          <label>
            Registration
            <input
              value={ac.registration}
              maxLength={8}
              placeholder="D-EABC"
              onChange={(e) => setAc({ ...ac, registration: e.target.value })}
            />
          </label>
          <div className="checks full">
            <label>
              <input type="checkbox" checked={ac.adsb} onChange={(e) => setAc({ ...ac, adsb: e.target.checked })} /> Broadcasts
              ADS-B
            </label>
          </div>
          <div className="full form-foot">
            <span className={aircraftError ? "error-text small" : "muted small"}>
              {aircraftError ?? "Each aircraft can only be registered once, worldwide."}
            </span>
            <button className="btn" disabled={!!aircraftError || !ac.icao24 || !ac.registration}>
              Register aircraft
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
