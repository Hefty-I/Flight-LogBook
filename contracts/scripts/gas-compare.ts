/**
 * Gas study: runs IDENTICAL flights through the optimized FlightLog and the naive
 * BaselineFlightLog, measures every transaction's real gasUsed (from receipts), and writes
 * docs/GAS_RESULTS.md (the gas-evaluation sheet for the report).
 *
 *   npx hardhat run scripts/gas-compare.ts
 *
 * Same compiler settings (0.8.24, optimizer 200 runs), same Hardhat network, same signers,
 * same inputs in the same order, fresh deployment, shared AuthorityRegistry + TrainingRegistry.
 */
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import * as fs from "fs";
import * as path from "path";

const HOUR = 60;
const DAY = 24 * 3600;
const RULES = {
  minTotalMinutes: 40 * HOUR,
  minDualMinutes: 20 * HOUR,
  minSoloMinutes: 10 * HOUR,
  minCrossCountryMinutes: 5 * HOUR,
  minVerifiedBps: 6000,
};
const SOLO = 1;
const XC = 2;
const EVIDENCE = ethers.keccak256(ethers.toUtf8Bytes("evidence"));
// A realistic IPFS link (CIDv1, 59 characters)
const EVIDENCE_URI = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

const apt = (code: string) => ethers.hexlify(ethers.toUtf8Bytes(code));
const reg = (tail: string) => ethers.zeroPadBytes(ethers.toUtf8Bytes(tail), 8);
const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

async function gas(txPromise: Promise<{ wait: () => Promise<{ gasUsed: bigint } | null> }>) {
  const receipt = await (await txPromise).wait();
  return Number(receipt!.gasUsed);
}

async function main() {
  const [deployer, oracle, adminA, schoolAdmin, instructor, s1, s2, s3] = await ethers.getSigners();

  // ── Shared registries ──
  const authorities = await (await ethers.getContractFactory("AuthorityRegistry")).deploy(deployer.address);
  const registry = await (
    await ethers.getContractFactory("TrainingRegistry")
  ).deploy(deployer.address, await authorities.getAddress());
  await authorities.addFoundingAuthority("Authority A", adminA.address, RULES);
  await authorities.sealGenesis();
  await registry.connect(adminA).registerSchool(1, schoolAdmin.address);
  await registry.connect(adminA).registerInstructor(1, instructor.address);
  for (const s of [s1, s2, s3]) await registry.connect(schoolAdmin).registerStudent(s.address);
  await registry.connect(schoolAdmin).registerAircraft("0x3c6444", reg("D-EABC"), true);

  // ── The two versions under test ──
  async function deploySystem(contractName: string) {
    const factory = await ethers.getContractFactory(contractName);
    const flightLog = (await factory.deploy(
      deployer.address,
      await authorities.getAddress(),
      await registry.getAddress(),
    )) as any;
    const deployGas = Number((await flightLog.deploymentTransaction()!.wait())!.gasUsed);
    await flightLog.grantRole(await flightLog.ORACLE_ROLE(), oracle.address);
    const licences = await (
      await ethers.getContractFactory("LicenceManager")
    ).deploy(deployer.address, await authorities.getAddress(), await registry.getAddress(), await flightLog.getAddress());
    return { flightLog, licences, deployGas, optimized: contractName === "FlightLog" };
  }

  type System = Awaited<ReturnType<typeof deploySystem>>;

  async function run(sys: System) {
    const { flightLog, licences, optimized } = sys;
    const airport = (code: string) => (optimized ? apt(code) : code);
    const r = {
      log120: [] as number[],
      log60: [] as number[],
      sign: [] as number[],
      verify: [] as number[],
      issue20: 0,
      issue40: 0,
      log600: 0,
      sign5single: 0,
      sign5batch: 0,
      deploy: sys.deployGas,
    };

    // One flight: log -> sign -> verify. Returns the flight id.
    async function flight(student: any, minutes: number, flags: number, out: number[]) {
      await time.increase(DAY);
      const dep = (await time.latest()) - minutes * 60 - 600;
      const to = flags & XC ? "EDFZ" : "EDFE";
      out.push(await gas(flightLog.connect(student).logFlight(1, dep, minutes, airport("EDFE"), airport(to), flags)));
      const id = await flightLog.flightCount();
      r.sign.push(await gas(flightLog.connect(instructor).signFlight(id)));
      r.verify.push(await gas(flightLog.connect(oracle).submitVerification(id, 0, EVIDENCE, EVIDENCE_URI)));
      return id;
    }

    // Scenario 1: 20 flights x 2 h = 40 h (5 solo cross-country), then issue the licence.
    for (let i = 0; i < 20; i++) await flight(s1, 120, i < 5 ? SOLO | XC : 0, r.log120);
    r.issue20 = await gas(licences.connect(adminA).issueLicence(s1.address));

    // Scenario 2: the same 40 h as 40 flights x 1 h (10 solo cross-country), then issue.
    for (let i = 0; i < 40; i++) await flight(s2, 60, i < 10 ? SOLO | XC : 0, r.log60);
    r.issue40 = await gas(licences.connect(adminA).issueLicence(s2.address));

    // Scenario 3: one long 10-hour flight (60 ten-minute slots).
    await time.increase(DAY);
    const dep = (await time.latest()) - 600 * 60 - 600;
    r.log600 = await gas(flightLog.connect(s3).logFlight(1, dep, 600, airport("EDFE"), airport("EDFZ"), XC));

    // Scenario 4: signing 5 flights one by one vs. in one batch (batch exists only when optimized).
    if (optimized) {
      const ids: bigint[] = [];
      await time.increase(DAY);
      const base = (await time.latest()) - 12 * 3600;
      for (let i = 0; i < 10; i++) {
        await flightLog.connect(s3).logFlight(1, base + i * 3600, 30, airport("EDFE"), airport("EDFE"), 0);
        ids.push(await flightLog.flightCount());
      }
      const single = [];
      for (const id of ids.slice(0, 5)) single.push(await gas(flightLog.connect(instructor).signFlight(id)));
      r.sign5single = sum(single);
      r.sign5batch = await gas(flightLog.connect(instructor).signFlights(ids.slice(5)));
    }
    return r;
  }

  const optimizedSys = await deploySystem("FlightLog");
  const baselineSys = await deploySystem("BaselineFlightLog");
  console.log("Running the optimized version...");
  const opt = await run(optimizedSys);
  console.log("Running the baseline version...");
  const base = await run(baselineSys);

  const pct = (b: number, o: number) => `${(((o - b) / b) * 100).toFixed(1)}%`;
  const rows: [string, number, number, string][] = [
    ["logFlight, 2-hour flight (avg of 20)", avg(base.log120), avg(opt.log120), "G1 packing, G3 bitmap, G5 bytes4"],
    ["logFlight, 1-hour flight (avg of 40)", avg(base.log60), avg(opt.log60), "G1, G3, G5"],
    ["logFlight, 10-hour flight", base.log600, opt.log600, "G3 bitmap vs one slot per 10 min"],
    ["signFlight (avg of 60)", avg(base.sign), avg(opt.sign), "G1 (fewer slots read)"],
    ["submitVerification (avg of 60)", avg(base.verify), avg(opt.verify), "G5 URI in event; G2 totals added here"],
    ["issueLicence after 20 flights", base.issue20, opt.issue20, "G2 running totals (no loop)"],
    ["issueLicence after 40 flights", base.issue40, opt.issue40, "G2: baseline grows with flights"],
    ["FlightLog deployment (one-time)", base.deploy, opt.deploy, "not like-for-like: optimized has more features"],
  ];

  console.table(
    rows.map(([op, b, o, why]) => ({ operation: op, baseline: b, optimized: o, change: pct(b, o), optimization: why })),
  );
  console.log(
    `Batch signing (optimized): 5 x signFlight = ${opt.sign5single}, signFlights(5) = ${opt.sign5batch} (${pct(opt.sign5single, opt.sign5batch)})`,
  );

  // ── Write the gas-evaluation sheet ──
  const table = rows
    .map(([op, b, o, why]) => `| ${op} | ${b.toLocaleString("en-US")} | ${o.toLocaleString("en-US")} | ${pct(b, o)} | ${why} |`)
    .join("\n");
  const md = `# Gas evaluation (generated by \`scripts/gas-compare.ts\`)

Generated: ${new Date().toISOString()}

## Results

| Operation | Baseline gas | Optimized gas | Change | Optimization |
|---|---|---|---|---|
${table}
| Sign 5 flights: 5 × \`signFlight\` vs 1 × \`signFlights\` | ${opt.sign5single.toLocaleString("en-US")} | ${opt.sign5batch.toLocaleString("en-US")} | ${pct(opt.sign5single, opt.sign5batch)} | G4 batch signing (both on the optimized contract) |

Negative change = the optimized version is cheaper.

## Methodology

- **Same conditions:** both versions are deployed fresh on the Hardhat network with the same compiler
  (Solidity 0.8.24, optimizer 200 runs), and they share one AuthorityRegistry and TrainingRegistry
  with the same authority, school, instructor, students and aircraft.
- **Same inputs, same order:** identical flights (departure times, durations, airports, flags),
  the same oracle result and the same 59-character IPFS evidence link.
- **Measured, not estimated:** every number is \`gasUsed\` from the transaction receipt.
  Averages smooth out first-write (cold storage) effects, which hit both versions equally.
- **Baseline:** \`contracts/baseline/BaselineFlightLog.sol\` enforces the same rules written the
  "obvious" way. The same LicenceManager code is deployed against each version.
- **Reproduce:** \`npx hardhat run scripts/gas-compare.ts\` in \`contracts/\`.

## Optimizations

| # | What we did | Baseline (naive) |
|---|---|---|
| G1 | \`Flight\` struct packed into 3 storage slots (\`uint40\` time, \`uint16\` duration, \`uint8\` flags) | every field \`uint256\`, flags as 3 bools |
| G2 | Running totals updated when a flight starts to count, so licence checks read 1 slot | totals recomputed by looping over every flight |
| G3 | A day's 144 ten-minute slots stored as bits of ONE \`uint256\` | one storage slot per 10-minute slot (aircraft and student) |
| G4 | \`signFlights(ids[])\` signs many flights in one transaction | one transaction per flight |
| G5 | Airports as \`bytes4\`; evidence URI only in the event log (hash stored) | airports and URI stored as strings |
| G6 | Lazy licence/validation status, computed on read | (not measured here: the naive version loops over all validations on every suspension) |
| G7 | Custom errors instead of \`require\` strings | \`require(cond, "text")\` (smaller code and cheaper failures; not measured separately) |

## Trade-offs

- **Readability:** packed types (\`uint40\`, \`uint16\`, bit flags, a bitmap) are harder to read and
  need care against overflow. The value ranges are checked (duration ≤ 720 min, flags ≤ 7).
- **Cost moved, not removed (G2):** running totals make each verification slightly more expensive,
  but licence checks become constant-cost instead of growing with every flight. Licence checks are
  also called by validation approvals and reads, so the trade is worth it, and it removes a
  denial-of-service risk (a loop that could eventually run out of gas).
- **Precision (G3):** flights are rounded to 10-minute slots, so two flights inside the same
  10 minutes on one aircraft are treated as overlapping.
- **Off-chain dependency (G5):** the evidence link lives only in event logs, so readers need an
  indexer or event query to find it. The hash on-chain still guarantees integrity.
- **bytes4 airports:** the website converts "EDFE" to bytes and back.
- **Deployment cost:** the optimized FlightLog costs more to deploy, because it also contains features
  the baseline lacks (disputes, oracle timeout, closing dead flights, batch signing, bitmap logic).
  This is a one-time cost, paid once, while the savings above apply to every flight.
`;
  const out = path.join(__dirname, "..", "..", "docs", "GAS_RESULTS.md");
  fs.writeFileSync(out, md);
  console.log(`\nWrote ${path.relative(process.cwd(), out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
