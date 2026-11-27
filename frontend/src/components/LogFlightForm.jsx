import { useEffect, useState } from "react";
import { useFlightProof } from "../context/FlightProofContext.jsx";
import { FLAGS, airportToBytes4, utc } from "../lib/format.js";

const pad = (n) => String(n).padStart(2, "0");
/** UNIX seconds -> { date: "2026-11-20", time: "08:00" } in UTC */
function toUtcParts(seconds) {
  const d = new Date(seconds * 1000);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}
/** "2026-11-20" + "08:00" (UTC) -> UNIX seconds */
function fromUtcParts(date, time) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000);
}

/**
 * Logs a flight. The same rules as the contract are checked here first, so most mistakes
 * are caught before MetaMask opens. The contract still has the final say (e.g. overlaps).
 */
export default function LogFlightForm({ aircraft }) {
  const { runTx, chain } = useFlightProof();
  const [form, setForm] = useState({
    aircraftId: "",
    date: "",
    time: "",
    minutes: 60,
    from: "",
    to: "",
    solo: false,
    xc: false,
    night: false,
  });

  // Default: a flight that landed 30 minutes before the current chain time.
  useEffect(() => {
    if (chain.time && !form.date) {
      const { date, time } = toUtcParts(Math.floor((chain.time - 90 * 60) / 600) * 600);
      setForm((f) => ({ ...f, date, time }));
    }
  }, [chain.time, form.date]);
  useEffect(() => {
    if (!form.aircraftId && aircraft.length) setForm((f) => ({ ...f, aircraftId: String(aircraft[0].id) }));
  }, [aircraft, form.aircraftId]);

  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const departure = form.date && form.time ? fromUtcParts(form.date, form.time) : null;
  const minutes = Number(form.minutes);
  const landing = departure != null ? departure + minutes * 60 : null;

  function problem() {
    if (!form.aircraftId) return "Choose an aircraft.";
    if (!departure) return "Enter the departure date and time (UTC).";
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) return "Duration must be 1–720 minutes.";
    if (!/^[A-Za-z0-9]{4}$/.test(form.from) || !/^[A-Za-z0-9]{4}$/.test(form.to)) {
      return "Airports must be 4-character ICAO codes, e.g. EDFE.";
    }
    if (form.xc && form.from.toUpperCase() === form.to.toUpperCase()) {
      return "A cross-country flight must land at a different airport.";
    }
    if (chain.time && landing > chain.time + 120) return "This flight lands after the current chain time.";
    if (chain.time && chain.time - landing > 3 * 24 * 3600) return "Flights must be logged within 3 days of landing.";
    return null;
  }
  const error = problem();

  async function submit(e) {
    e.preventDefault();
    if (error) return;
    const flags = (form.solo ? FLAGS.SOLO : 0) | (form.xc ? FLAGS.CROSS_COUNTRY : 0) | (form.night ? FLAGS.NIGHT : 0);
    await runTx(`Log flight ${form.from.toUpperCase()}→${form.to.toUpperCase()}`, (c) =>
      c.flightLog.logFlight(
        Number(form.aircraftId),
        departure,
        minutes,
        airportToBytes4(form.from),
        airportToBytes4(form.to),
        flags,
      ),
    );
  }

  if (!aircraft.length) return <p className="muted">Your school has no active aircraft yet.</p>;

  return (
    <form className="form" onSubmit={submit}>
      <label className="full">
        Aircraft
        <select value={form.aircraftId} onChange={set("aircraftId")}>
          {aircraft.map((a) => (
            <option key={a.id} value={a.id}>
              {a.registration} · ICAO24 {a.icao24} · {a.adsb ? "ADS-B" : "no ADS-B"}
            </option>
          ))}
        </select>
      </label>
      <label>
        Departure date (UTC)
        <input type="date" value={form.date} onChange={set("date")} />
      </label>
      <label>
        Departure time (UTC)
        <input type="time" value={form.time} onChange={set("time")} />
      </label>
      <label>
        Duration (minutes)
        <input type="number" min="1" max="720" value={form.minutes} onChange={set("minutes")} />
      </label>
      <label>
        From (ICAO)
        <input value={form.from} onChange={set("from")} placeholder="EDFE" maxLength={4} />
      </label>
      <label>
        To (ICAO)
        <input value={form.to} onChange={set("to")} placeholder="EDFZ" maxLength={4} />
      </label>
      <div className="checks full">
        <label>
          <input type="checkbox" checked={form.solo} onChange={set("solo")} /> Solo
        </label>
        <label>
          <input type="checkbox" checked={form.xc} onChange={set("xc")} /> Cross-country
        </label>
        <label>
          <input type="checkbox" checked={form.night} onChange={set("night")} /> Night
        </label>
      </div>
      <div className="full form-foot">
        <span className={error ? "error-text small" : "muted small"}>
          {error ?? `Lands ${utc(landing)} · chain time ${utc(chain.time)}`}
        </span>
        <button className="btn" type="submit" disabled={!!error}>
          Log flight
        </button>
      </div>
    </form>
  );
}
