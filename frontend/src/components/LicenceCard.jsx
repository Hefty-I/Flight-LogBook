import { INELIGIBILITY, LICENCE_STATUS, VALIDATION_STATUS, utc } from "../lib/format.js";
import { useFlightProof } from "../context/FlightProofContext.jsx";

/**
 * The student's licence and cross-border validations.
 * `info` comes from StudentPage: home authority, eligibility per authority, licence, validations.
 */
export default function LicenceCard({ info }) {
  const { runTx } = useFlightProof();
  const { home, licence, authorities } = info;
  const active = licence.status === 1;

  return (
    <div>
      <ul className="stats">
        <li>
          <span>Home authority</span>
          <strong>{authorities.find((a) => a.id === home)?.name ?? `#${home}`}</strong>
        </li>
        <li>
          <span>Licence</span>
          <strong className={active ? "ok-text" : licence.status === 0 ? "" : "error-text"}>
            {LICENCE_STATUS[licence.status]}
            {licence.issuedAt ? ` · issued ${utc(licence.issuedAt).slice(0, 10)}` : ""}
          </strong>
        </li>
      </ul>

      <h2 className="sub">Your logbook against each authority's rules</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Authority</th>
              <th>Rules check</th>
              <th>Validation</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {authorities.map((a) => {
              const isHome = a.id === home;
              const canRequest = active && !isHome && a.active && (a.validation === 0 || a.validation === 3);
              return (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td className={a.eligibility === 0 ? "ok-text" : ""}>
                    {a.eligibility === 0 ? "Meets the rules" : INELIGIBILITY[a.eligibility]}
                  </td>
                  <td>{isHome ? "Home authority" : VALIDATION_STATUS[a.validation]}</td>
                  <td>
                    {canRequest && (
                      <button
                        className="btn small"
                        onClick={() => runTx(`Ask ${a.name.split(" (")[0]} to validate`, (c) => c.licences.requestValidation(a.id))}
                      >
                        Request validation
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!active && (
        <p className="small muted">
          Your home authority issues the licence once you meet its rules. After that you can ask other authorities to
          validate it against their own rules.
        </p>
      )}
    </div>
  );
}
