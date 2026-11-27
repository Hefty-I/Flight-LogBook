import { useEffect, useState } from "react";
import { useFlightProof } from "../../context/FlightProofContext.jsx";
import { hoursMinutes } from "../../lib/format.js";

const FIELDS = [
  ["minTotalMinutes", "Total"],
  ["minDualMinutes", "Dual"],
  ["minSoloMinutes", "Solo"],
  ["minCrossCountryMinutes", "Cross-country"],
];

/**
 * The authority's own licence rules. The contract refuses rules below the ICAO 40-hour
 * minimum or rules that contradict themselves (try it: that is a security demo).
 */
export default function RulesPanel({ authorityId, rules }) {
  const { runTx } = useFlightProof();
  const [form, setForm] = useState(null);

  useEffect(() => {
    setForm({
      ...Object.fromEntries(FIELDS.map(([k]) => [k, Number(rules[k]) / 60])),
      verifiedPct: Number(rules.minVerifiedBps) / 100,
    });
  }, [rules]);

  if (!form) return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    const next = {
      ...Object.fromEntries(FIELDS.map(([k]) => [k, Math.round(Number(form[k]) * 60)])),
      minVerifiedBps: Math.round(Number(form.verifiedPct) * 100),
    };
    runTx("Update licence rules", (c) => c.authorities.updateRules(authorityId, next));
  };

  return (
    <form className="form" onSubmit={submit}>
      {FIELDS.map(([k, label]) => (
        <label key={k}>
          {label} (hours) · now {hoursMinutes(rules[k])}
          <input type="number" min="0" step="0.5" value={form[k]} onChange={set(k)} />
        </label>
      ))}
      <label>
        ADS-B verified (%) · now {Number(rules.minVerifiedBps) / 100}%
        <input type="number" min="0" max="100" step="1" value={form.verifiedPct} onChange={set("verifiedPct")} />
      </label>
      <div className="full form-foot">
        <span className="small muted">The ICAO minimum is 40 hours total. The contract enforces it.</span>
        <button className="btn" type="submit">
          Update rules
        </button>
      </div>
    </form>
  );
}
