import { id as keccakText } from "ethers";
import { useFlightProof } from "../context/FlightProofContext.jsx";
import { FLAGS, hoursMinutes, shortAddress, utc } from "../lib/format.js";
import StatusBadge from "./StatusBadge.jsx";
import EvidenceLink from "./EvidenceLink.jsx";
import EvidenceCheck from "./EvidenceCheck.jsx";

const DAY = 24 * 3600;

function flightType(flags) {
  const parts = [];
  parts.push(flags & FLAGS.SOLO ? "Solo" : "Dual");
  if (flags & FLAGS.CROSS_COUNTRY) parts.push("XC");
  if (flags & FLAGS.NIGHT) parts.push("Night");
  return parts.join(" · ");
}

/**
 * Flights with the actions the contract allows right now, using the same time windows
 * as FlightLog (sign 7 days, oracle timeout 14 days, dispute 30 days).
 * `actions`: "student" shows dispute / timeout / close buttons.
 * `showStudent`: adds a student column (instructor and authority views).
 * `evidenceCheck`: shows a "Check evidence" button instead of a plain link (verify page).
 */
export default function FlightTable({ flights, actions, showStudent = false, evidenceCheck = false }) {
  const { runTx, chain } = useFlightProof();
  const now = chain.time ?? 0;

  function buttonsFor(f) {
    const dep = f.departureTime;
    const out = [];
    if (actions === "student") {
      if (f.status === 2 && now > dep + 14 * DAY) {
        out.push(["Oracle timeout", () => runTx(`Fall back to attested #${f.id}`, (c) => c.flightLog.claimOracleTimeout(f.id))]);
      }
      if (f.status === 5 && now <= dep + 30 * DAY) {
        out.push([
          "Dispute",
          () => {
            const reason = window.prompt("Why is the oracle wrong? (e.g. 'flew in an area without ADS-B receivers')");
            if (!reason) return;
            // The reason itself goes into the event log; its hash is the on-chain fingerprint.
            return runTx(`Dispute flight #${f.id}`, (c) =>
              c.flightLog.openDispute(f.id, keccakText(reason), `data:text/plain,${encodeURIComponent(reason)}`),
            );
          },
        ]);
      }
    }
    const closable =
      f.status === 7 || (f.status === 5 && now > dep + 30 * DAY) || (f.status === 1 && now > dep + 7 * DAY);
    if (closable) out.push(["Close", () => runTx(`Close flight #${f.id}`, (c) => c.flightLog.closeFlight(f.id))]);
    return out;
  }

  if (!flights.length) return <p className="muted">No flights yet.</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            {showStudent && <th>Student</th>}
            <th>Departure (UTC)</th>
            <th>Aircraft</th>
            <th>Route</th>
            <th>Time</th>
            <th>Type</th>
            <th>Status</th>
            <th>Evidence</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {flights.map((f) => (
            <tr key={f.id}>
              <td>{f.id}</td>
              {showStudent && (
                <td className="mono" title={f.student}>
                  {shortAddress(f.student)}
                </td>
              )}
              <td>{utc(f.departureTime).replace(" UTC", "")}</td>
              <td title={`ICAO24 ${f.aircraft.icao24}${f.aircraft.adsb ? " · ADS-B" : " · no ADS-B"}`}>
                {f.aircraft.registration}
              </td>
              <td>
                {f.from} → {f.to}
              </td>
              <td>{hoursMinutes(f.minutes)}</td>
              <td>{flightType(f.flags)}</td>
              <td>
                <StatusBadge status={f.status} />
              </td>
              <td className={evidenceCheck ? "wrap" : ""}>
                {evidenceCheck ? <EvidenceCheck evidence={f.evidence} /> : <EvidenceLink evidence={f.evidence} />}
              </td>
              <td className="row-actions">
                {buttonsFor(f).map(([label, onClick]) => (
                  <button key={label} className="btn small" onClick={onClick}>
                    {label}
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
