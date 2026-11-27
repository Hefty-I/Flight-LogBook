import { readFileSync } from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider, NonceManager, Wallet, toUtf8String } from "ethers";
import { SHARED } from "./config.js";

/** Must match FlightLog.Status in Solidity. */
export const FlightStatus = Object.freeze({
  None: 0,
  Logged: 1,
  Signed: 2,
  Verified: 3,
  Attested: 4,
  Mismatch: 5,
  Disputed: 6,
  Rejected: 7,
  Closed: 8,
});

export function connect(cfg) {
  const provider = new JsonRpcProvider(cfg.rpcUrl);
  const wallet = new Wallet(cfg.privateKey, provider);
  // The provider briefly caches eth_getTransactionCount, so two quick transactions
  // could get the same nonce. NonceManager counts nonces locally instead.
  const signer = new NonceManager(wallet);
  const abi = JSON.parse(readFileSync(path.join(SHARED, "abi", "FlightLog.json"), "utf8"));
  const flightLog = new Contract(cfg.deployment.contracts.FlightLog, abi, signer);
  return { provider, wallet, signer, flightLog };
}

/** bytes4 "0x45444645" -> "EDFE" */
export function decodeAirport(hex) {
  return toUtf8String(hex).replace(/\0/g, "");
}

/** Turns a FlightSigned event into the plain "claim" object the matcher works with. */
export function eventToClaim(ev) {
  const a = ev.args;
  return {
    flightId: a.flightId.toString(),
    instructor: a.instructor,
    student: a.student,
    icao24: a.icao24.slice(2).toLowerCase(),
    adsbEquipped: a.adsbEquipped,
    departureTime: Number(a.departureTime),
    durationMinutes: Number(a.durationMinutes),
    departureAirport: decodeAirport(a.departureAirport),
    arrivalAirport: decodeAirport(a.arrivalAirport),
    blockNumber: ev.blockNumber,
  };
}

/** Reads FlightSigned events in chunks (public RPCs limit the block range per request). */
export async function fetchSignedEvents(flightLog, fromBlock, toBlock, maxRange) {
  const out = [];
  for (let start = fromBlock; start <= toBlock; start += maxRange) {
    const end = Math.min(toBlock, start + maxRange - 1);
    out.push(...(await flightLog.queryFilter(flightLog.filters.FlightSigned(), start, end)));
  }
  return out;
}
