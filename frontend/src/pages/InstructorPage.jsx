import { useFlightProof } from "../context/FlightProofContext.jsx";
import { useFlights } from "../hooks/useFlights.js";
import { useSchoolStudents } from "../hooks/useSchoolStudents.js";
import { hoursMinutes, shortAddress } from "../lib/format.js";
import SignQueue from "../components/SignQueue.jsx";
import FlightTable from "../components/FlightTable.jsx";

/** "Sign flights": the instructor's queue, what they signed, and their students' progress. */
export default function InstructorPage({ roles }) {
  const { account } = useFlightProof();
  const schoolId = roles.instructor.schoolId;
  const active = roles.instructor.active;
  const { students, error: studentsError } = useSchoolStudents(schoolId);
  const { flights, loading, error } = useFlights();

  const myStudents = new Set(students.map((s) => s.address.toLowerCase()));
  const waiting = flights.filter((f) => f.status === 1 && myStudents.has(f.student.toLowerCase()));
  const signedByMe = flights.filter((f) => f.instructor.toLowerCase() === account.toLowerCase());

  return (
    <div className="grid">
      {!active && (
        <div className="notice bad wide-notice">
          <strong>Your instructor rating has been revoked.</strong> You can no longer sign flights, and the hours you
          signed are under review by the authority.
        </div>
      )}

      <section className="card wide">
        <h2>Waiting for your signature</h2>
        {error && <p className="error-text">{error}</p>}
        {loading ? <p className="muted">Loading flights…</p> : <SignQueue flights={waiting} disabled={!active} />}
      </section>

      <section className="card wide">
        <h2>Signed by you</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <FlightTable flights={signedByMe} showStudent />
        )}
        <p className="small muted">
          After you sign, the oracle compares each flight with real ADS-B tracking data. A mismatch is not counted. If you
          are revoked later, every pilot you signed for goes under review.
        </p>
      </section>

      <section className="card wide">
        <h2>Students at school #{schoolId}</h2>
        {studentsError && <p className="error-text">{studentsError}</p>}
        {students.length === 0 ? (
          <p className="muted">No students registered yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Total hours</th>
                  <th>Solo</th>
                  <th>ADS-B verified</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.address}>
                    <td className="mono" title={s.address}>
                      {shortAddress(s.address)}
                    </td>
                    <td>{hoursMinutes(s.total)}</td>
                    <td>{hoursMinutes(s.solo)}</td>
                    <td>{s.total ? `${Math.round((s.verified / s.total) * 100)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
