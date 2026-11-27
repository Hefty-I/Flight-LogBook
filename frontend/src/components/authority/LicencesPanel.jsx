import { useFlightProof } from "../../context/FlightProofContext.jsx";
import { INELIGIBILITY, LICENCE_STATUS, hoursMinutes, shortAddress } from "../../lib/format.js";

/**
 * Pilots trained at this authority's schools.
 * "Issue" stays clickable even when the logbook is short: the CONTRACT refuses it,
 * which demonstrates that not even the regulator can skip the rules.
 */
export default function LicencesPanel({ pilots }) {
  const { runTx } = useFlightProof();
  if (!pilots.length) return <p className="muted">No students registered at your schools yet.</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Pilot</th>
            <th>School</th>
            <th>Hours</th>
            <th>ADS-B</th>
            <th>Rules check</th>
            <th>Licence</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pilots.map((p) => {
            const tx = (label, fn) => () => runTx(`${label} ${shortAddress(p.address)}`, fn);
            return (
              <tr key={p.address}>
                <td className="mono" title={p.address}>
                  {shortAddress(p.address)}
                </td>
                <td>#{p.schoolId}</td>
                <td>{hoursMinutes(p.total)}</td>
                <td>{p.total ? `${Math.round((p.verified / p.total) * 100)}%` : "—"}</td>
                <td className={p.eligibility === 0 ? "ok-text" : "wrap"}>
                  {p.eligibility === 0 ? "Meets the rules" : INELIGIBILITY[p.eligibility]}
                </td>
                <td className={p.licence === 1 ? "ok-text" : p.licence === 0 ? "muted" : "error-text"}>
                  {LICENCE_STATUS[p.licence]}
                </td>
                <td className="row-actions">
                  {p.storedStatus === 0 && (
                    <button className="btn small" onClick={tx("Issue licence to", (c) => c.licences.issueLicence(p.address))}>
                      Issue licence
                    </button>
                  )}
                  {p.storedStatus === 1 && (
                    <button className="btn small" onClick={tx("Suspend licence of", (c) => c.licences.suspendLicence(p.address))}>
                      Suspend
                    </button>
                  )}
                  {p.storedStatus === 2 && (
                    <button className="btn small" onClick={tx("Reinstate licence of", (c) => c.licences.reinstateLicence(p.address))}>
                      Reinstate
                    </button>
                  )}
                  {(p.storedStatus === 1 || p.storedStatus === 2) && (
                    <button className="btn small danger" onClick={tx("Revoke licence of", (c) => c.licences.revokeLicence(p.address))}>
                      Revoke
                    </button>
                  )}
                  {p.toClear.map((r) => (
                    <button
                      key={r.instructor}
                      className="btn small"
                      title={`Hours signed by revoked instructor ${r.instructor}`}
                      onClick={tx(`Clear review (${hoursMinutes(r.minutes)}) for`, (c) =>
                        c.licences.clearReview(p.address, r.instructor),
                      )}
                    >
                      Clear review ({hoursMinutes(r.minutes)})
                    </button>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
