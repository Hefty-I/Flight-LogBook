import { useEffect, useState } from "react";
import { useFlightProof } from "../context/FlightProofContext.jsx";
import RoleBadges from "../components/RoleBadges.jsx";
import { hoursMinutes } from "../lib/format.js";

/** Who am I, which authorities exist and with which rules, and is the system healthy. */
export default function Overview({ roles }) {
  const { contracts, deployment, account, mode, refreshKey } = useFlightProof();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!contracts) return;
    let stopped = false;
    (async () => {
      const { authorities, registry, flightLog } = contracts;
      const [count, paused, schools, aircraft, flights] = await Promise.all([
        authorities.authorityCount(),
        authorities.paused(),
        registry.schoolCount(),
        registry.aircraftCount(),
        flightLog.flightCount(),
      ]);
      const list = await Promise.all(
        Array.from({ length: Number(count) }, (_, i) =>
          authorities.getAuthority(i + 1).then(([name, admin, active, rules]) => ({ id: i + 1, name, admin, active, rules })),
        ),
      );
      if (!stopped) {
        setData({ paused, schools: Number(schools), aircraft: Number(aircraft), flights: Number(flights), list });
        setError(null);
      }
    })().catch((err) => !stopped && setError(err.shortMessage || err.message));
    return () => {
      stopped = true;
    };
  }, [contracts, refreshKey]);

  return (
    <div className="grid">
      <section className="card">
        <h2>Your wallet</h2>
        {mode !== "wallet" || !account ? (
          <p className="muted">Connect MetaMask to see your roles. Each role gets its own page.</p>
        ) : (
          <>
            <p className="mono small">{account}</p>
            <RoleBadges roles={roles} />
          </>
        )}
      </section>

      <section className="card">
        <h2>System</h2>
        {error && <p className="error-text">{error}</p>}
        {data && (
          <ul className="stats">
            <li>
              <span>Status</span>
              <strong className={data.paused ? "error-text" : "ok-text"}>{data.paused ? "PAUSED" : "Running"}</strong>
            </li>
            <li>
              <span>Authorities</span>
              <strong>{data.list.length}</strong>
            </li>
            <li>
              <span>Flight schools</span>
              <strong>{data.schools}</strong>
            </li>
            <li>
              <span>Aircraft</span>
              <strong>{data.aircraft}</strong>
            </li>
            <li>
              <span>Flights logged</span>
              <strong>{data.flights}</strong>
            </li>
          </ul>
        )}
      </section>

      <section className="card wide">
        <h2>Aviation authorities and their licence rules</h2>
        {data && data.list.length === 0 && <p className="muted">No authorities yet. Run the seed script.</p>}
        {data && data.list.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Authority</th>
                <th>Total</th>
                <th>Dual</th>
                <th>Solo</th>
                <th>Cross-country</th>
                <th>ADS-B verified</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.list.map((a) => (
                <tr key={a.id}>
                  <td>{a.id}</td>
                  <td>{a.name}</td>
                  <td>{hoursMinutes(a.rules.minTotalMinutes)}</td>
                  <td>{hoursMinutes(a.rules.minDualMinutes)}</td>
                  <td>{hoursMinutes(a.rules.minSoloMinutes)}</td>
                  <td>{hoursMinutes(a.rules.minCrossCountryMinutes)}</td>
                  <td>≥ {Number(a.rules.minVerifiedBps) / 100}%</td>
                  <td className={a.active ? "ok-text" : "error-text"}>{a.active ? "Active" : "Suspended"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {deployment && (
        <section className="card wide">
          <h2>Contracts ({deployment.network})</h2>
          <ul className="addresses">
            {Object.entries(deployment.contracts).map(([name, address]) => (
              <li key={name}>
                <span>{name}</span>
                <code>{address}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
