import { useFlightProof } from "../../context/FlightProofContext.jsx";
import { INELIGIBILITY, VALIDATION_STATUS, shortAddress } from "../../lib/format.js";

/**
 * Foreign pilots asking THIS authority to recognise their licence. The contract only lets
 * you approve if their on-chain logbook meets YOUR rules, and an approval automatically
 * shows "Home licence inactive" if their own country later suspends them (lazy status).
 */
export default function ValidationsPanel({ authorityId, validations }) {
  const { runTx } = useFlightProof();
  if (!validations.length) return <p className="muted">No foreign pilots have asked for validation.</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Pilot</th>
            <th>Licensed by</th>
            <th>Against your rules</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {validations.map((v) => {
            const decide = (approve) => () =>
              runTx(`${approve ? "Approve" : "Reject"} validation for ${shortAddress(v.pilot)}`, (c) =>
                c.licences.decideValidation(v.pilot, authorityId, approve),
              );
            return (
              <tr key={v.pilot}>
                <td className="mono" title={v.pilot}>
                  {shortAddress(v.pilot)}
                </td>
                <td>{v.homeName ?? `#${v.home}`}</td>
                <td className={v.eligibility === 0 ? "ok-text" : "wrap"}>
                  {v.eligibility === 0 ? "Meets your rules" : INELIGIBILITY[v.eligibility]}
                </td>
                <td className={v.status === 2 ? "ok-text" : v.status === 4 || v.status === 3 ? "error-text" : ""}>
                  {VALIDATION_STATUS[v.status]}
                </td>
                <td className="row-actions">
                  {v.status === 1 && (
                    <>
                      <button className="btn small" onClick={decide(true)}>
                        Approve
                      </button>
                      <button className="btn small danger" onClick={decide(false)}>
                        Reject
                      </button>
                    </>
                  )}
                  {(v.status === 2 || v.status === 4) && (
                    <button
                      className="btn small danger"
                      onClick={() =>
                        runTx(`Withdraw validation for ${shortAddress(v.pilot)}`, (c) =>
                          c.licences.withdrawValidation(v.pilot, authorityId),
                        )
                      }
                    >
                      Withdraw
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
