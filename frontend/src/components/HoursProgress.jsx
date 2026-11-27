import { hoursMinutes } from "../lib/format.js";

function Bar({ label, value, required, display }) {
  const pct = required > 0 ? Math.min(100, (value / required) * 100) : 100;
  const done = value >= required;
  return (
    <div className="progress-row">
      <div className="progress-head">
        <span>{label}</span>
        <span className={done ? "ok-text" : "muted"}>{display}</span>
      </div>
      <div className="bar">
        <div className={`fill ${done ? "done" : ""}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Running totals from FlightLog against one authority's licence rules. */
export default function HoursProgress({ totals, rules }) {
  const total = Number(totals.total);
  const verified = Number(totals.verified);
  const share = total ? (verified / total) * 100 : 0;
  const needShare = Number(rules.minVerifiedBps) / 100;
  const rows = [
    ["Total", totals.total, rules.minTotalMinutes],
    ["Dual (with instructor)", totals.dual, rules.minDualMinutes],
    ["Solo", totals.solo, rules.minSoloMinutes],
    ["Cross-country", totals.crossCountry, rules.minCrossCountryMinutes],
  ];

  return (
    <div>
      {rows.map(([label, value, required]) => (
        <Bar
          key={label}
          label={label}
          value={Number(value)}
          required={Number(required)}
          display={`${hoursMinutes(value)} / ${hoursMinutes(required)}`}
        />
      ))}
      <Bar
        label="ADS-B verified share"
        value={share}
        required={needShare}
        display={`${share.toFixed(0)}% / ${needShare}% (${hoursMinutes(verified)} verified)`}
      />
    </div>
  );
}
