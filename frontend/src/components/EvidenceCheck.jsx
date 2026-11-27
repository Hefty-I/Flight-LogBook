import { useState } from "react";
import { checkEvidence } from "../lib/evidence.js";
import { utc } from "../lib/format.js";

const RESULT = ["MATCH", "NO DATA", "MISMATCH"];

/**
 * "Check" button for one flight's oracle evidence: downloads the file (IPFS or the local
 * oracle copy), recomputes keccak256, compares it with the on-chain hash, and shows
 * what OpenSky actually saw. This is the off-chain integrity check.
 */
export default function EvidenceCheck({ evidence }) {
  const [state, setState] = useState({ status: "idle" });
  if (!evidence) return <span className="muted">—</span>;

  const run = async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "done", ...(await checkEvidence(evidence)) });
    } catch (err) {
      setState({ status: "error", error: err.message });
    }
  };

  if (state.status === "idle") {
    return (
      <button className="btn small" onClick={run} title={`On-chain hash ${evidence.hash}`}>
        Check evidence
      </button>
    );
  }
  if (state.status === "loading") return <span className="muted">Checking…</span>;
  if (state.status === "error") return <span className="error-text small wrap-text">{state.error}</span>;

  const { matches, json } = state;
  const seen = json?.opensky?.flights ?? [];
  return (
    <div className="evidence-result">
      <div className={matches ? "ok-text" : "error-text"}>
        {matches ? "✓ File matches the on-chain hash" : "✗ File was changed: hash does not match"}
      </div>
      <div className="small">
        Oracle decision: <strong>{RESULT[json?.decision?.result] ?? "?"}</strong> · {json?.decision?.reason}
      </div>
      <div className="small muted">
        OpenSky ({json?.opensky?.source}) saw {seen.length} flight{seen.length === 1 ? "" : "s"}
        {seen.length > 0 &&
          ": " +
            seen
              .map(
                (f) =>
                  `${utc(f.firstSeen).slice(11, 16)}–${utc(f.lastSeen).slice(11, 16)} ${f.estDepartureAirport ?? "?"}→${
                    f.estArrivalAirport ?? "?"
                  }`,
              )
              .join(", ")}
      </div>
    </div>
  );
}
