# FlightProof oracle

Watches `FlightLog` for co-signed flights, asks OpenSky what the aircraft really did,
and posts `MATCH` / `NO_DATA` / `MISMATCH` on-chain together with an evidence hash.

| File | Job |
|---|---|
| `src/index.js` | Main loop: read `FlightSigned` events, verify, submit. State (event cursor + pending flights) is saved in `state/` so restarts lose nothing. |
| `src/opensky.js` | OpenSky client. `live` mode uses OAuth2 client credentials; `fixture` mode replays recorded data. |
| `src/matcher.js` | Pure decision logic (unit-tested). |
| `src/evidence.js` | Builds the evidence JSON, hashes it (keccak256), pins it to IPFS (Pinata) or keeps it locally. |
| `src/record.js` | Saves real OpenSky data into `fixtures/` for a demo that works offline. |

## Decision rules

- Take-off and landing must each be within `MATCH_TOLERANCE_MIN` (default 30) of the claim.
  OpenSky's `firstSeen`/`lastSeen` are when receivers first/last heard the aircraft, usually a
  few minutes after take-off and before landing.
- OpenSky's estimated airports must agree when present. `null` (unknown) is not a mismatch.
- No data for an **ADS-B-equipped** aircraft → `MISMATCH` (it should have been heard).
  No data for an aircraft **without ADS-B** → `NO_DATA` (counts as instructor-attested only).
  The contract enforces this too: it rejects `NO_DATA` for equipped aircraft.

## Using a real flight in the demo

1. Create a free OpenSky account and an **API client** on your account page. Put the client ID and
   secret in `.env` (`OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`). Never commit them.
2. Pick a small training aircraft that broadcasts ADS-B (coverage is best in Europe and North
   America). Find its 24-bit ICAO address (`icao24`, six hex characters) on a flight-tracking site.
3. Record a day of its flights. OpenSky processes flights overnight, so pick a past day:

   ```powershell
   npm run record -- 3c6444 2026-11-20T00:00:00Z 2026-11-21T00:00:00Z
   ```

4. The script prints ready-made flight entries. Copy one into `shared/demo-scenario.json`, set the
   aircraft's `icao24`/registration there, and set `demoStartDate` to a few hours after that
   flight landed. Start the chain with that date (`DEMO_START_DATE`) and seed as usual.
5. Optional: `OPENSKY_MODE=live` to query OpenSky during the demo itself (keep the recorded
   fixture as a fallback in case the API is slow).

**Untested parts:** the live OpenSky calls and the Pinata upload are covered by unit tests with a
fake server only. Run them once with real credentials before relying on them. The reported limit
of about 2 days per `/flights/aircraft` request comes from OpenSky's OpenAPI spec. Check the
current official docs.
