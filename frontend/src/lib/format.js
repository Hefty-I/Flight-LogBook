import { hexlify, toUtf8Bytes, toUtf8String, zeroPadBytes } from "ethers";

// These lists must match the enums in the Solidity contracts (same order).
export const FLIGHT_STATUS = ["None", "Logged", "Signed", "Verified", "Attested", "Mismatch", "Disputed", "Rejected", "Closed"];

export const LICENCE_STATUS = ["No licence", "Active", "Under review", "Suspended", "Revoked", "Issuing authority suspended"];

export const VALIDATION_STATUS = ["Not requested", "Pending", "Valid", "Rejected", "Home licence inactive"];

export const INELIGIBILITY = [
  "Eligible",
  "Not a registered student",
  "Total hours too low",
  "Dual (with instructor) hours too low",
  "Solo hours too low",
  "Cross-country hours too low",
  "Not enough ADS-B-verified hours",
  "Under review: an instructor who signed these hours was revoked",
];

export const FLAGS = { SOLO: 1, CROSS_COUNTRY: 2, NIGHT: 4 };

/** 2400 -> "40h 00m" */
export function hoursMinutes(minutes) {
  const m = Number(minutes);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "0x1234...abcd" */
export function shortAddress(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
}

/** UNIX seconds -> "2026-11-20 08:00 UTC" */
export function utc(seconds) {
  if (seconds == null) return "—";
  return new Date(Number(seconds) * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/** "EDFE" -> bytes4. ICAO airport codes are exactly 4 letters/digits. */
export function airportToBytes4(code) {
  const c = String(code).trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(c)) throw new Error(`"${code}" is not a 4-character ICAO airport code`);
  return hexlify(toUtf8Bytes(c));
}

/** bytes4 -> "EDFE" */
export function bytes4ToAirport(hex) {
  return toUtf8String(hex).replace(/\0/g, "");
}

/** "3C6444" -> "0x3c6444" (bytes3). The ICAO24 address is 6 hex characters. */
export function icao24ToBytes3(hex) {
  const h = String(hex).trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{6}$/.test(h)) throw new Error("ICAO24 must be 6 hex characters, e.g. 3c6444");
  return "0x" + h;
}

/** "D-EABC" -> bytes8 (right-padded). Tail numbers are at most 8 characters. */
export function registrationToBytes8(tail) {
  const t = String(tail).trim().toUpperCase();
  if (!t || t.length > 8) throw new Error("Registration must be 1–8 characters, e.g. D-EABC");
  return zeroPadBytes(toUtf8Bytes(t), 8);
}

/** bytes8 tail number -> "D-EABC" */
export function bytesToText(hex) {
  return toUtf8String(hex).replace(/\0/g, "");
}
