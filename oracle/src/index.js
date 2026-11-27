/**
 * FlightProof oracle service.
 *
 *  1. Watches FlightLog for FlightSigned events (a flight co-signed by an instructor).
 *  2. Asks OpenSky which flights that aircraft really made around the claimed time.
 *  3. Decides MATCH / NO_DATA / MISMATCH, saves the evidence (IPFS if configured),
 *     and calls FlightLog.submitVerification with the evidence hash.
 *
 * Failure handling: OpenSky outages and rate limits are retried on the next poll;
 * pending work survives restarts (state/ folder); if the oracle is down for 14 days
 * the contract lets the student fall back to "Attested" (see FlightLog.claimOracleTimeout).
 *
 * Usage:  npm start        (keeps polling)
 *         npm run once     (one pass, then exit; handy for demos and CI)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { OpenSkyClient, RetryableError } from "./opensky.js";
import { matchFlight, ResultName } from "./matcher.js";
import { buildEvidence, canonicalJson, hashEvidence, storeEvidence } from "./evidence.js";
import { connect, eventToClaim, fetchSignedEvents, FlightStatus } from "./chain.js";

const WINDOW_PADDING_SEC = 2 * 3600; // ask OpenSky for 2h either side of the claim

const cfg = loadConfig();
const once = process.argv.includes("--once");
const { provider, wallet, signer, flightLog } = connect(cfg);
const opensky = new OpenSkyClient(cfg.opensky);

mkdirSync(cfg.stateDir, { recursive: true });
const stateFile = path.join(cfg.stateDir, `oracle-${cfg.network}.json`);
const freshState = () => ({
  deployedAt: cfg.deployment.deployedAt,
  nextBlock: cfg.deployment.startBlock,
  pending: {},
});
let state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : freshState();
// A new deployment (for example after restarting the local chain) starts from scratch;
// otherwise the saved block number would point past the new chain's events.
if (state.deployedAt !== cfg.deployment.deployedAt) state = freshState();
const saveState = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));

async function collectNewEvents() {
  const latest = await provider.getBlockNumber();
  if (state.nextBlock > latest) return;
  const events = await fetchSignedEvents(flightLog, state.nextBlock, latest, cfg.maxBlockRange);
  for (const ev of events) {
    const claim = eventToClaim(ev);
    state.pending[claim.flightId] ??= claim;
  }
  state.nextBlock = latest + 1;
  saveState();
  if (events.length) console.log(`Found ${events.length} newly signed flight(s)`);
}

async function verify(claim) {
  const landing = claim.departureTime + claim.durationMinutes * 60;
  if (cfg.opensky.mode === "live" && Date.now() / 1000 < landing + cfg.liveDelaySec) {
    return "waiting"; // OpenSky has not processed that day yet
  }

  const flight = await flightLog.getFlight(claim.flightId);
  if (Number(flight.status) !== FlightStatus.Signed) return "done"; // handled elsewhere (e.g. timeout)

  const { flights, source, query } = await opensky.flightsByAircraft(
    claim.icao24,
    claim.departureTime - WINDOW_PADDING_SEC,
    landing + WINDOW_PADDING_SEC,
  );
  const match = matchFlight(claim, flights, { toleranceSec: cfg.toleranceSec });

  const evidence = buildEvidence({
    chainId: cfg.deployment.chainId,
    flightLog: cfg.deployment.contracts.FlightLog,
    claim,
    query,
    source,
    flights,
    match,
    checkedAt: new Date().toISOString(),
  });
  const json = canonicalJson(evidence);
  const hash = hashEvidence(json);
  const uri = await storeEvidence(json, hash, cfg);

  const tx = await flightLog.submitVerification(claim.flightId, match.result, hash, uri);
  await tx.wait();
  console.log(
    `Flight #${claim.flightId} (${claim.icao24} ${claim.departureAirport}->${claim.arrivalAirport}): ` +
      `${ResultName[match.result]} - ${match.reason}\n    evidence ${uri}  tx ${tx.hash}`,
  );
  return "done";
}

async function processPending() {
  for (const [id, claim] of Object.entries(state.pending)) {
    try {
      const outcome = await verify(claim);
      if (outcome === "done") {
        delete state.pending[id];
        saveState();
      }
    } catch (err) {
      signer.reset(); // re-read the nonce from the chain before the next attempt
      const kind = err instanceof RetryableError ? "will retry" : "error";
      console.warn(`Flight #${id}: ${kind}: ${err.shortMessage || err.message}`);
    }
  }
}

async function tick() {
  await collectNewEvents();
  await processPending();
}

console.log(`FlightProof oracle on ${cfg.network} as ${wallet.address}`);
console.log(`OpenSky mode: ${cfg.opensky.mode}, FlightLog: ${cfg.deployment.contracts.FlightLog}`);

if (once) {
  await tick();
  const left = Object.keys(state.pending).length;
  console.log(left ? `${left} flight(s) still pending` : "All signed flights processed");
} else {
  const loop = async () => {
    try {
      await tick();
    } catch (err) {
      console.warn(`Poll failed: ${err.shortMessage || err.message}`);
    }
    setTimeout(loop, cfg.pollMs);
  };
  loop();
}
