import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { keccak256, toUtf8Bytes } from "ethers";

/** JSON with sorted keys, so the same evidence always produces the same bytes and hash. */
export function canonicalJson(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, sort(v[k])]),
      );
    }
    return typeof v === "bigint" ? v.toString() : v;
  };
  return JSON.stringify(sort(value));
}

export function hashEvidence(json) {
  return keccak256(toUtf8Bytes(json));
}

/**
 * Everything a third party needs to re-check the oracle's decision: the claim,
 * the exact OpenSky query and answer, and the result. Contains no personal data
 * (wallet addresses only; ADS-B data is public).
 */
export function buildEvidence({ chainId, flightLog, claim, query, source, flights, match, checkedAt }) {
  return {
    schema: "flightproof-evidence/1",
    chainId,
    flightLog,
    flightId: String(claim.flightId),
    claim: {
      student: claim.student,
      instructor: claim.instructor,
      icao24: claim.icao24,
      adsbEquipped: claim.adsbEquipped,
      departureTime: claim.departureTime,
      durationMinutes: claim.durationMinutes,
      departureAirport: claim.departureAirport,
      arrivalAirport: claim.arrivalAirport,
    },
    opensky: { source, query, flights },
    decision: {
      result: match.result,
      reason: match.reason,
      startDiffSec: match.startDiffSec ?? null,
      endDiffSec: match.endDiffSec ?? null,
    },
    checkedAt,
  };
}

/**
 * Keeps a local copy and, if PINATA_JWT is set, pins the exact bytes to IPFS so that
 * keccak256(file) equals the hash stored on-chain. Falls back to a local URI.
 */
export async function storeEvidence(json, hash, { pinataJwt, stateDir, fetchImpl = fetch }) {
  const dir = path.join(stateDir, "evidence");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${hash}.json`), json);

  if (pinataJwt) {
    try {
      const form = new FormData();
      form.append("file", new Blob([json], { type: "application/json" }), `flightproof-${hash}.json`);
      const res = await fetchImpl("https://api.pinata.cloud/pinning/pinFileToIPFS", {
        method: "POST",
        headers: { Authorization: `Bearer ${pinataJwt}` },
        body: form,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { IpfsHash } = await res.json();
      return `ipfs://${IpfsHash}`;
    } catch (err) {
      console.warn(`  ! IPFS upload failed (${err.message}); using the local copy instead`);
    }
  }
  return `local://evidence/${hash}.json`;
}
