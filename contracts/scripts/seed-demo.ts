/**
 * Seeds a local chain for the live demo:
 *   - Authority A (FAA-style rules) and Authority B (EASA-style rules), both clearly simulated
 *   - a flight school under A with two instructors, two students and the demo aircraft
 *   - a school under B (used to show that B cannot touch A's records)
 *   - the demo flights from shared/demo-scenario.json, logged and co-signed,
 *     ready for the oracle to verify
 *
 * Run against `npx hardhat node` started with DEMO_START_DATE (see README).
 * Wallets are the public Hardhat test accounts. Import them into MetaMask from the
 * `npx hardhat node` output. This script never prints private keys.
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const SHARED = path.join(__dirname, "..", "..", "shared");
const HOUR = 60;

const RULES_A = {
  minTotalMinutes: 40 * HOUR,
  minDualMinutes: 20 * HOUR,
  minSoloMinutes: 10 * HOUR,
  minCrossCountryMinutes: 5 * HOUR,
  minVerifiedBps: 6000,
};
const RULES_B = { ...RULES_A, minTotalMinutes: 45 * HOUR, minDualMinutes: 25 * HOUR };

const apt = (code: string) => ethers.hexlify(ethers.toUtf8Bytes(code));
const reg = (tail: string) => ethers.zeroPadBytes(ethers.toUtf8Bytes(tail), 8);

async function main() {
  const deploymentFile = path.join(SHARED, "deployments", `${network.name}.json`);
  if (!fs.existsSync(deploymentFile)) throw new Error(`Run the deploy script first (${deploymentFile} not found).`);
  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  const scenario = JSON.parse(fs.readFileSync(path.join(SHARED, "demo-scenario.json"), "utf8"));

  const s = await ethers.getSigners();
  const roles = {
    deployer: s[0],
    oracle: s[1],
    adminA: s[2],
    adminB: s[3],
    adminC: s[4],
    schoolAdmin: s[5],
    instructor: s[6],
    instructor2: s[7],
    student: s[8],
    student2: s[9],
    schoolAdminB: s[10],
    instructorB: s[11],
    studentB: s[12],
  };

  const authorities = await ethers.getContractAt("AuthorityRegistry", deployment.contracts.AuthorityRegistry);
  const registry = await ethers.getContractAt("TrainingRegistry", deployment.contracts.TrainingRegistry);
  const flightLog = await ethers.getContractAt("FlightLog", deployment.contracts.FlightLog);

  if ((await authorities.authorityCount()) > 0n) {
    console.log("Already seeded. Restart the node and deploy again for a fresh demo.");
    return;
  }

  const send = async (p: Promise<{ wait: () => Promise<unknown> }>) => (await p).wait();

  console.log("Creating authorities (simulated, not the real FAA/EASA)...");
  await send(authorities.addFoundingAuthority("Authority A (FAA-style rules, simulated)", roles.adminA.address, RULES_A));
  await send(authorities.addFoundingAuthority("Authority B (EASA-style rules, simulated)", roles.adminB.address, RULES_B));
  await send(authorities.sealGenesis());

  console.log("Creating schools, instructors, students and aircraft...");
  await send(registry.connect(roles.adminA).registerSchool(1, roles.schoolAdmin.address));
  await send(registry.connect(roles.adminA).registerInstructor(1, roles.instructor.address));
  await send(registry.connect(roles.adminA).registerInstructor(1, roles.instructor2.address));
  await send(registry.connect(roles.schoolAdmin).registerStudent(roles.student.address));
  await send(registry.connect(roles.schoolAdmin).registerStudent(roles.student2.address));
  for (const a of scenario.aircraft) {
    await send(registry.connect(roles.schoolAdmin).registerAircraft("0x" + a.icao24, reg(a.registration), a.adsbEquipped));
  }

  await send(registry.connect(roles.adminB).registerSchool(2, roles.schoolAdminB.address));
  await send(registry.connect(roles.adminB).registerInstructor(2, roles.instructorB.address));
  await send(registry.connect(roles.schoolAdminB).registerStudent(roles.studentB.address));

  console.log("Logging and co-signing the demo flights...");
  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  for (const f of scenario.flights) {
    const departure = Math.floor(Date.parse(f.departureUtc) / 1000);
    const landing = departure + f.minutes * 60;
    if (landing > now || now - landing > 3 * 24 * 3600) {
      console.warn(
        `  ! Skipping "${f.label}": the chain time must be 0-3 days after its landing. ` +
          `Start the node with DEMO_START_DATE=${scenario.demoStartDate}`,
      );
      continue;
    }
    await send(
      flightLog
        .connect(roles.student)
        .logFlight(f.aircraftIndex + 1, departure, f.minutes, apt(f.from), apt(f.to), f.flags),
    );
    const id = await flightLog.flightCount();
    await send(flightLog.connect(roles.instructor).signFlight(id));
    console.log(`  flight #${id}: ${f.label}`);
  }

  console.log("\nDemo wallets (Hardhat test accounts; import keys from the `npx hardhat node` output):");
  console.table(Object.fromEntries(Object.entries(roles).map(([k, v], i) => [k, `#${i}  ${v.address}`])));
  console.log("Next: start the oracle (cd ../oracle && npm start) to verify the signed flights.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
