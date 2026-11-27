import { useEffect, useState } from "react";
import { useFlightProof } from "../context/FlightProofContext.jsx";
import RoleBadges from "../components/RoleBadges.jsx";
import { hoursMinutes, utc } from "../lib/format.js";

/** Who am I, which authorities exist and with which rules, and is the system healthy. */
export default function Overview({ roles }) {
  const { contracts, deployment, account, mode, chain, refreshKey } = useFlightProof();
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

  const stats = [
    ["Flights logged", data?.flights],
    ["Aircraft", data?.aircraft],
    ["Flight schools", data?.schools],
    ["Authorities", data?.list.length],
  ];

  return (
    <div className="grid">
      <section className="hero">
        <div className="eyebrow">ADS-B verified · multi-authority · on-chain</div>
        <h1>Every flight hour, proven.</h1>
        <p>
          Students log flights, instructors co-sign them, and an oracle checks each one against real aircraft tracking
          data. Authorities issue licences only when the record holds up, and any country can verify it.
        </p>
        <div className="hero-stats">
          {stats.map(([label, value]) => (
            <div key={label}>
              <div className="num">{value ?? "—"}</div>
              <div className="label">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Your wallet</h2>
        {mode !== "wallet" || !account ? (
          <p className="muted">Connect MetaMask to see your roles. Each role gets its own page.</p>
        ) : (
          <>
            <p className="mono small muted">{account}</p>
            <RoleBadges roles={roles} />
          </>
        )}
      </section>

      <section className="card">
        <h2>System status</h2>
        {error && <p className="error-text">{error}</p>}
        <ul className="stats">
          <li>
            <span>Contracts</span>
            <strong className={data?.paused ? "error-text" : "ok-text"}>
              {data ? (data.paused ? "Paused" : "Running") : "—"}
            </strong>
          </li>
          <li>
            <span>Network</span>
            <strong>{deployment?.network ?? "—"}</strong>
          </li>
          <li>
            <span>Latest block</span>
            <strong>{chain.block ?? "—"}</strong>
          </li>
          <li>
            <span>Chain time</span>
            <strong>{utc(chain.time)}</strong>
          </li>
        </ul>
      </section>

      <section className="card wide">
        <h2>Aviation authorities and their licence rules</h2>
        {data && data.list.length === 0 && <p className="muted">No authorities yet. Run the seed script.</p>}
        {data && data.list.length > 0 && (
          <div className="table-wrap">
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
          </div>
        )}
      </section>

      {deployment && (
        <section className="card wide">
          <h2>Contracts</h2>
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
