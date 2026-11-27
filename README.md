# FlightProof ✈️

A verified pilot training logbook. Students log flights, instructors co-sign them, and an
oracle checks every flight against real aircraft tracking data (ADS-B from the
[OpenSky Network](https://opensky-network.org)). Aviation authorities issue licences only when
the logbook meets their rules, and foreign authorities can validate a licence against
**their own** rules, straight from the on-chain record.

Why: pilot hours are self-reported and have been faked at scale (Pakistan 2020, India 2011-17,
the FAA's 2026 StarFlite case). Regulators currently cross-check by hand. FlightProof automates the
cross-check and gives every country the same tamper-evident record.

## Repository layout

```
contracts/   Solidity + Hardhat: contracts, tests (66), deploy/seed/status scripts
oracle/      Node.js service: OpenSky client, flight matcher, evidence + IPFS, tests (14)
shared/      Deployed addresses, ABIs and the demo scenario (used by oracle and frontend)
docs/        Architecture, data map, threat model and gas notes for the report
frontend/    React + ethers.js + MetaMask: one page per role, plus a public "verify a pilot" page
```

## Contracts at a glance

```
          OpenZeppelin AccessControl + Pausable
                          │
                 AccessBase (abstract)        roles, emergency pause, shared errors
                          │
       ┌──────────────────┴───────────────────┐
AuthorityRegistry                      AuthorityScoped (abstract)
countries, rule sets,                  "only this country's regulator", system-wide pause
consortium voting            ┌────────────────┼──────────────────┐
                      TrainingRegistry     FlightLog         LicenceManager
                      schools, people,     flights, oracle   licences, cross-border
                      aircraft             results, disputes validation
```

Details, state machine, data map and threat model: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

Needs Node.js 20+ (tested with 22). Commands are for PowerShell.

### 1. Run the tests

```powershell
cd contracts; npm install; npx hardhat test
```

```powershell
cd oracle; npm install; npm test
```

Gas table: `npm run gas` in `contracts/` (set `GAS_REPORT_FILE=gas-report.txt` to save it).

### 2. Run the local demo (4 terminals)

**Terminal 1: local chain**, starting on the demo date so the recorded flights are "recent":

```powershell
cd contracts; $env:DEMO_START_DATE="2026-11-20T12:00:00Z"; npx hardhat node
```

**Terminal 2: deploy and seed** (two simulated authorities, a school, people, aircraft, two signed flights):

```powershell
cd contracts; npm run deploy:local; npm run seed:local
```

**Terminal 3: oracle.** First copy `oracle/.env.example` to `oracle/.env` and paste the private key of
Hardhat **account #1** (printed by terminal 1) into `ORACLE_PRIVATE_KEY`. Then:

```powershell
cd oracle; npm run once
```

Expected: flight #1 → `MATCH` (Verified), flight #2 (the ghost flight) → `MISMATCH`.

**Terminal 4: check the result**

```powershell
cd contracts; npx hardhat run scripts/show-status.ts --network localhost
```

To demo with a **real** flight instead of the synthetic sample, see [oracle/README.md](oracle/README.md).

**Terminal 5: website** (MetaMask setup: [frontend/README.md](frontend/README.md))

```powershell
cd frontend; npm install; npm run dev
```

Open http://localhost:5173. Without MetaMask the site is read-only; "Verify a pilot" works for anyone.

## Status

| Part | State |
|---|---|
| Contracts (base + 4) | ✅ done, 66 tests passing (normal, boundary, failure, 8 attack scenarios) |
| Oracle (fixture mode) | ✅ done, 14 tests, verified end to end on a local chain |
| Oracle (live OpenSky) | ⚠️ written, unit-tested with a fake server, **not yet run against the real API** (needs an OpenSky API client) |
| IPFS via Pinata | ⚠️ written, unit-tested with a fake server, not yet run against Pinata |
| Demo data | ⚠️ synthetic sample; record a real flight before the final demo |
| Gas study | ✅ baseline vs optimized measured side by side: [docs/GAS_RESULTS.md](docs/GAS_RESULTS.md) (`npm run gas:compare`) |
| Website | ✅ student, instructor, school and authority pages + public verify page with evidence check; tested in a browser with a test wallet (check with real MetaMask before the demo) |
| Sepolia deployment | ⏳ to do (`npm run deploy:sepolia` after filling `contracts/.env`) |

## Measured gas (optimized version, Hardhat, optimizer 200 runs)

| Operation | Avg gas |
|---|---|
| `logFlight` | ~153,000 |
| `signFlight` | ~93,600 |
| `signFlights` (3 flights in one tx) | ~161,500 (three single `signFlight` calls average ~281,000 in the tests) |
| `submitVerification` | ~89,100 |
| `issueLicence` | ~88,000 (constant: running totals, no loop over flights) |

Averages include first-time storage writes; compare like with like in the report (see docs).

## Security notes

- Never commit `.env` files or private keys. Only `.env.example` files belong in the repo.
- Local demo wallets are the public Hardhat test accounts. Never send real funds to them.
- The local demo uses **simulated** authorities ("Authority A, FAA-style rules"). Label them that
  way in the demo; they are not the real FAA or EASA.

## Attribution

- [OpenZeppelin Contracts v5](https://github.com/OpenZeppelin/openzeppelin-contracts) (MIT): `AccessControl`, `Pausable`.
- [ethers.js v6](https://docs.ethers.org/v6/), [Hardhat](https://hardhat.org) tooling.
- Starter code drafted with an AI assistant (Claude). Disclose this in the report as your course
  policy requires, and make sure each member can explain the parts they own.
