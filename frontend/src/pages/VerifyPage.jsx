import { useEffect, useState } from "react";
import { isAddress } from "ethers";
import { useFlightProof } from "../context/FlightProofContext.jsx";
import { useFlights } from "../hooks/useFlights.js";
import { queryAll } from "../lib/events.js";
import { INELIGIBILITY, LICENCE_STATUS, VALIDATION_STATUS, hoursMinutes, shortAddress, utc } from "../lib/format.js";
import FlightTable from "../components/FlightTable.jsx";

const fromUrl = () => new URLSearchParams(window.location.search).get("pilot") ?? "";

/**
 * Public page: anyone (an airline, a foreign regulator, an insurer) can check a pilot
 * WITHOUT a wallet. Shows the effective licence status, verified hours, how each
 * authority's rules are met, and lets you check each flight's oracle evidence.
 * Shareable link: ?pilot=0x...
 */
export default function VerifyPage() {
  const { contracts, deployment, refreshKey } = useFlightProof();
  const [input, setInput] = useState(fromUrl());
  const [known, setKnown] = useState([]);
  const pilot = isAddress(input.trim()) ? input.trim() : null;
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const { flights } = useFlights({ student: pilot ?? "0x0000000000000000000000000000000000000001" });

  // Pilots this deployment knows about (for the dropdown).
  useEffect(() => {
    if (!contracts || !deployment) return;
    queryAll(contracts.registry, contracts.registry.filters.StudentRegistered(), deployment.startBlock ?? 0)
      .then((events) => setKnown(events.map((e) => ({ address: e.args.student, schoolId: Number(e.args.schoolId) }))))
      .catch(() => setKnown([]));
  }, [contracts, deployment, refreshKey]);

  // Keep the shareable link in the address bar.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (pilot) url.searchParams.set("pilot", pilot);
    else url.searchParams.delete("pilot");
    window.history.replaceState(null, "", url);
  }, [pilot]);

  useEffect(() => {
    if (!contracts || !pilot) {
      setReport(null);
      return;
    }
    let stopped = false;
    (async () => {
      const { authorities, registry, flightLog, licences } = contracts;
      const schoolId = Number(await registry.studentSchool(pilot));
      if (!schoolId) {
        if (!stopped) setReport({ registered: false });
        return;
      }
      const [home, totals, status, licence, count] = await Promise.all([
        registry.schoolAuthority(schoolId),
        flightLog.totalsOf(pilot),
        licences.licenceStatus(pilot),
        licences.getLicence(pilot),
        authorities.authorityCount(),
      ]);
      const list = await Promise.all(
        Array.from({ length: Number(count) }, async (_, i) => {
          const id = i + 1;
          const [[name], eligibility, validation] = await Promise.all([
            authorities.getAuthority(id),
            licences.eligibility(pilot, id),
            licences.validationStatus(pilot, id),
          ]);
          return { id, name, eligibility: Number(eligibility), validation: Number(validation) };
        }),
      );
      if (!stopped) {
        setReport({
          registered: true,
          schoolId,
          home: Number(home),
          totals,
          status: Number(status),
          issuedAt: Number(licence.issuedAt),
          authorities: list,
        });
        setError(null);
      }
    })().catch((err) => !stopped && setError(err.shortMessage || err.message));
    return () => {
      stopped = true;
    };
  }, [contracts, pilot, refreshKey]);

  const t = report?.totals;
  const verifiedPct = t && Number(t.total) ? Math.round((Number(t.verified) / Number(t.total)) * 100) : 0;

  return (
    <div className="grid">
      <section className="card wide">
        <h2>Verify a pilot</h2>
        <p className="muted small">No wallet needed. Everything below is read directly from the blockchain.</p>
        <div className="inline-form">
          <input placeholder="Pilot wallet address (0x…)" value={input} onChange={(e) => setInput(e.target.value)} />
          {known.length > 0 && (
            <select value="" onChange={(e) => setInput(e.target.value)}>
              <option value="">Known pilots…</option>
              {known.map((k) => (
                <option key={k.address} value={k.address}>
                  {shortAddress(k.address)} · school #{k.schoolId}
                </option>
              ))}
            </select>
          )}
        </div>
        {input && !pilot && <p className="error-text small">That is not a valid address.</p>}
        {error && <p className="error-text">{error}</p>}
        {report && !report.registered && <p className="error-text">This wallet is not a registered pilot.</p>}
      </section>

      {report?.registered && (
        <>
          <section className="card">
            <h2>Licence</h2>
            <div className={`licence-status ${report.status === 1 ? "ok-text" : report.status === 0 ? "muted" : "error-text"}`}>
              {LICENCE_STATUS[report.status]}
            </div>
            <ul className="stats">
              <li>
                <span>Issued by</span>
                <strong>{report.authorities.find((a) => a.id === report.home)?.name}</strong>
              </li>
              <li>
                <span>Issued on</span>
                <strong>{report.issuedAt ? utc(report.issuedAt).slice(0, 10) : "—"}</strong>
              </li>
              <li>
                <span>Training school</span>
                <strong>#{report.schoolId}</strong>
              </li>
            </ul>
          </section>

          <section className="card">
            <h2>Logged hours</h2>
            <ul className="stats">
              <li>
                <span>Total</span>
                <strong>{hoursMinutes(t.total)}</strong>
              </li>
              <li>
                <span>Dual / Solo</span>
                <strong>
                  {hoursMinutes(t.dual)} / {hoursMinutes(t.solo)}
                </strong>
              </li>
              <li>
                <span>Cross-country / Night</span>
                <strong>
                  {hoursMinutes(t.crossCountry)} / {hoursMinutes(t.night)}
                </strong>
              </li>
              <li>
                <span>Confirmed by ADS-B data</span>
                <strong className={verifiedPct >= 60 ? "ok-text" : ""}>
                  {verifiedPct}% ({hoursMinutes(t.verified)})
                </strong>
              </li>
            </ul>
          </section>

          <section className="card wide">
            <h2>Recognition by each authority</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Authority</th>
                    <th>Logbook vs its rules</th>
                    <th>Licence recognised?</th>
                  </tr>
                </thead>
                <tbody>
                  {report.authorities.map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td className={a.eligibility === 0 ? "ok-text" : ""}>
                        {a.eligibility === 0 ? "Meets the rules" : INELIGIBILITY[a.eligibility]}
                      </td>
                      <td>
                        {a.id === report.home ? `Issuing authority · ${LICENCE_STATUS[report.status]}` : VALIDATION_STATUS[a.validation]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card wide">
            <h2>Flights and oracle evidence</h2>
            <FlightTable flights={flights} evidenceCheck />
            <p className="small muted">
              "Check evidence" downloads the oracle's evidence file and recomputes its keccak256 hash. It must equal the hash
              stored on-chain, so nobody can quietly change the evidence after the fact.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
