/** Must match FlightLog.OracleResult in Solidity. */
export const Result = Object.freeze({ MATCH: 0, NO_DATA: 1, MISMATCH: 2 });
export const ResultName = ["MATCH", "NO_DATA", "MISMATCH"];

const sameAirport = (a, b) => String(a).trim().toUpperCase() === String(b).trim().toUpperCase();

/**
 * Compares a logged flight ("claim") with the flights OpenSky saw for that aircraft.
 *
 * - firstSeen/lastSeen are when receivers first/last heard the aircraft, which is
 *   usually a few minutes after take-off and before landing, so both ends get a tolerance.
 * - OpenSky's airport fields are estimates and are sometimes null; null is not a mismatch.
 * - No data at all means MISMATCH for an ADS-B-equipped aircraft (it should have been
 *   heard) and NO_DATA for one without ADS-B (we cannot tell either way).
 *
 * @param claim {{ departureTime:number, durationMinutes:number, departureAirport:string,
 *                 arrivalAirport:string, adsbEquipped:boolean }}
 * @param flights OpenSky /flights/aircraft response items
 * @returns {{ result:number, reason:string, matched?:object, startDiffSec?:number, endDiffSec?:number }}
 */
export function matchFlight(claim, flights, { toleranceSec = 1800 } = {}) {
  const claimedStart = claim.departureTime;
  const claimedEnd = claim.departureTime + claim.durationMinutes * 60;

  if (!Array.isArray(flights) || flights.length === 0) {
    return claim.adsbEquipped
      ? { result: Result.MISMATCH, reason: "No ADS-B trace for an ADS-B-equipped aircraft in the claimed time window" }
      : { result: Result.NO_DATA, reason: "Aircraft has no ADS-B and no data was found; instructor attestation only" };
  }

  let closest = null;
  for (const f of flights) {
    const startDiffSec = Math.abs(f.firstSeen - claimedStart);
    const endDiffSec = Math.abs(f.lastSeen - claimedEnd);
    const depOk = !f.estDepartureAirport || sameAirport(f.estDepartureAirport, claim.departureAirport);
    const arrOk = !f.estArrivalAirport || sameAirport(f.estArrivalAirport, claim.arrivalAirport);

    if (startDiffSec <= toleranceSec && endDiffSec <= toleranceSec && depOk && arrOk) {
      return {
        result: Result.MATCH,
        reason: "ADS-B track matches the claimed times and airports",
        matched: f,
        startDiffSec,
        endDiffSec,
      };
    }
    const score = startDiffSec + endDiffSec;
    if (!closest || score < closest.score) closest = { f, score, startDiffSec, endDiffSec, depOk, arrOk };
  }

  const problems = [];
  if (closest.startDiffSec > toleranceSec) problems.push(`take-off differs by ${Math.round(closest.startDiffSec / 60)} min`);
  if (closest.endDiffSec > toleranceSec) problems.push(`landing differs by ${Math.round(closest.endDiffSec / 60)} min`);
  if (!closest.depOk) problems.push(`departed ${closest.f.estDepartureAirport}, not ${claim.departureAirport}`);
  if (!closest.arrOk) problems.push(`arrived ${closest.f.estArrivalAirport}, not ${claim.arrivalAirport}`);

  return {
    result: Result.MISMATCH,
    reason: `Closest ADS-B flight does not match: ${problems.join("; ")}`,
    matched: closest.f,
    startDiffSec: closest.startDiffSec,
    endDiffSec: closest.endDiffSec,
  };
}
