/**
 * Records real OpenSky flights of one aircraft into fixtures/opensky/<icao24>.json,
 * so the demo can replay real data even if OpenSky is unreachable on demo day.
 *
 *   npm run record -- <icao24> <beginISO> <endISO>
 *   npm run record -- 3c6444 2026-11-20T00:00:00Z 2026-11-21T00:00:00Z
 *
 * Needs OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET in .env. The interval is reportedly
 * limited to about 2 days per request.
 */
import dotenv from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";
import { OpenSkyClient } from "./opensky.js";

dotenv.config({ quiet: true });

const [icao24, beginIso, endIso] = process.argv.slice(2);
if (!icao24 || !beginIso || !endIso) {
  console.error("Usage: npm run record -- <icao24> <beginISO> <endISO>");
  process.exit(1);
}

const begin = Math.floor(Date.parse(beginIso) / 1000);
const end = Math.floor(Date.parse(endIso) / 1000);
const fixturesDir = path.join(ROOT, "fixtures", "opensky");
const client = new OpenSkyClient({
  mode: "live",
  clientId: process.env.OPENSKY_CLIENT_ID,
  clientSecret: process.env.OPENSKY_CLIENT_SECRET,
  tokenUrl:
    process.env.OPENSKY_TOKEN_URL ||
    "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
  apiUrl: process.env.OPENSKY_API_URL || "https://opensky-network.org/api",
  fixturesDir,
});

const { flights } = await client.flightsByAircraft(icao24, begin, end);
console.log(`OpenSky returned ${flights.length} flight(s) for ${icao24}`);

mkdirSync(fixturesDir, { recursive: true });
const file = path.join(fixturesDir, `${icao24.toLowerCase()}.json`);
const existing = existsSync(file) && !JSON.parse(readFileSync(file, "utf8"))._note?.startsWith("SYNTHETIC")
  ? JSON.parse(readFileSync(file, "utf8")).flights
  : [];
const byStart = new Map([...existing, ...flights].map((f) => [f.firstSeen, f]));
const merged = [...byStart.values()].sort((a, b) => a.firstSeen - b.firstSeen);
writeFileSync(
  file,
  JSON.stringify({ _note: `Recorded from OpenSky on ${new Date().toISOString()}`, icao24, flights: merged }, null, 2),
);
console.log(`Saved ${merged.length} flight(s) to ${path.relative(ROOT, file)}\n`);

console.log("Suggested entries for shared/demo-scenario.json:");
for (const f of flights) {
  const dep = Math.floor(f.firstSeen / 600) * 600; // round take-off down to 10 minutes
  const minutes = Math.ceil((f.lastSeen - dep) / 60);
  console.log(
    JSON.stringify({
      label: `Real flight ${f.callsign?.trim() || icao24}`,
      aircraftIndex: 0,
      departureUtc: new Date(dep * 1000).toISOString(),
      minutes,
      from: f.estDepartureAirport || "????",
      to: f.estArrivalAirport || "????",
      flags: f.estDepartureAirport && f.estArrivalAirport && f.estDepartureAirport !== f.estArrivalAirport ? 2 : 0,
    }),
  );
}
