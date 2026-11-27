import { useFlightProof } from "../../context/FlightProofContext.jsx";
import { hoursMinutes, shortAddress, utc } from "../../lib/format.js";

/**
 * Students dispute a MISMATCH (e.g. they flew where no ADS-B receiver could hear them).
 * Accept = the flight counts as instructor-attested. Reject = it never counts.
 */
export default function DisputesPanel({ disputes }) {
  const { runTx } = useFlightProof();
  if (!disputes.length) return <p className="muted">No open disputes.</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Flight</th>
            <th>Student</th>
            <th>Departure (UTC)</th>
            <th>Route</th>
            <th>Time</th>
            <th>Student's reason</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {disputes.map((d) => (
            <tr key={d.id}>
              <td>#{d.id}</td>
              <td className="mono" title={d.student}>
                {shortAddress(d.student)}
              </td>
              <td>{utc(d.departureTime).replace(" UTC", "")}</td>
              <td>{d.route}</td>
              <td>{hoursMinutes(d.minutes)}</td>
              <td className="wrap">{d.reason || <span className="muted">—</span>}</td>
              <td className="row-actions">
                <button className="btn small" onClick={() => runTx(`Accept dispute #${d.id}`, (c) => c.flightLog.resolveDispute(d.id, true))}>
                  Accept
                </button>
                <button
                  className="btn small danger"
                  onClick={() => runTx(`Reject dispute #${d.id}`, (c) => c.flightLog.resolveDispute(d.id, false))}
                >
                  Reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
