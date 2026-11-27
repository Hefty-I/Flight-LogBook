import { useEffect, useState } from "react";
import { useFlightProof } from "../context/FlightProofContext.jsx";
import { FLAGS, hoursMinutes, shortAddress, utc } from "../lib/format.js";

const SIGN_WINDOW = 7 * 24 * 3600;

function timeLeft(seconds) {
  if (seconds <= 0) return "expired";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d ? `${d}d ${h}h left` : `${h}h left`;
}

/**
 * Flights waiting for this instructor's co-signature. Sign one, or tick several and sign
 * them in ONE transaction with signFlights() (a gas optimization from FlightLog).
 */
export default function SignQueue({ flights, disabled }) {
  const { runTx, chain } = useFlightProof();
  const [selected, setSelected] = useState(new Set());
  const now = chain.time ?? 0;
  const signable = flights.filter((f) => now <= f.departureTime + SIGN_WINDOW);

  // Forget selections for flights that are no longer waiting.
  useEffect(() => {
    setSelected((s) => new Set([...s].filter((id) => signable.some((f) => f.id === id))));
  }, [flights]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const signOne = (id) => runTx(`Sign flight #${id}`, (c) => c.flightLog.signFlight(id));
  const signBatch = () => {
    const ids = [...selected];
    const what = ids.length === 1 ? "1 flight" : `${ids.length} flights`;
    return runTx(`Sign ${what} (batch)`, (c) => c.flightLog.signFlights(ids));
  };

  if (!flights.length) return <p className="muted">No flights are waiting for your signature.</p>;

  return (
    <div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>#</th>
              <th>Student</th>
              <th>Departure (UTC)</th>
              <th>Aircraft</th>
              <th>Route</th>
              <th>Time</th>
              <th>Type</th>
              <th>Window</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {flights.map((f) => {
              const left = f.departureTime + SIGN_WINDOW - now;
              const open = left > 0;
              return (
                <tr key={f.id}>
                  <td>
                    <input
                      type="checkbox"
                      disabled={!open || disabled}
                      checked={selected.has(f.id)}
                      onChange={() => toggle(f.id)}
                      aria-label={`Select flight ${f.id}`}
                    />
                  </td>
                  <td>{f.id}</td>
                  <td className="mono" title={f.student}>
                    {shortAddress(f.student)}
                  </td>
                  <td>{utc(f.departureTime).replace(" UTC", "")}</td>
                  <td>{f.aircraft.registration}</td>
                  <td>
                    {f.from} → {f.to}
                  </td>
                  <td>{hoursMinutes(f.minutes)}</td>
                  <td>
                    {f.flags & FLAGS.SOLO ? "Solo" : "Dual"}
                    {f.flags & FLAGS.CROSS_COUNTRY ? " · XC" : ""}
                    {f.flags & FLAGS.NIGHT ? " · Night" : ""}
                  </td>
                  <td className={open ? "muted" : "error-text"}>{timeLeft(left)}</td>
                  <td className="row-actions">
                    <button className="btn small" disabled={!open || disabled} onClick={() => signOne(f.id)}>
                      Sign
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="queue-foot">
        <span className="small muted">
          Only sign flights you actually supervised. Your signature is permanent and checked against ADS-B data.
        </span>
        <button className="btn" disabled={disabled || selected.size === 0} onClick={signBatch}>
          Sign selected ({selected.size})
        </button>
      </div>
    </div>
  );
}
