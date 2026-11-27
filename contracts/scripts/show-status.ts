/** Prints every flight and the demo students' totals. `npx hardhat run scripts/show-status.ts --network localhost` */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const STATUS = ["None", "Logged", "Signed", "Verified", "Attested", "Mismatch", "Disputed", "Rejected", "Closed"];

async function main() {
  const file = path.join(__dirname, "..", "..", "shared", "deployments", `${network.name}.json`);
  const deployment = JSON.parse(fs.readFileSync(file, "utf8"));
  const flightLog = await ethers.getContractAt("FlightLog", deployment.contracts.FlightLog);

  const count = Number(await flightLog.flightCount());
  const rows = [];
  for (let id = 1; id <= count; id++) {
    const f = await flightLog.getFlight(id);
    rows.push({
      id,
      student: f.student.slice(0, 10) + "...",
      departureUtc: new Date(Number(f.departureTime) * 1000).toISOString().slice(0, 16),
      minutes: Number(f.durationMinutes),
      route: `${ethers.toUtf8String(f.departureAirport)}->${ethers.toUtf8String(f.arrivalAirport)}`,
      status: STATUS[Number(f.status)],
    });
  }
  console.table(rows);

  const signers = await ethers.getSigners();
  for (const [label, s] of [["student", signers[8]], ["student2", signers[9]]] as const) {
    const t = await flightLog.totalsOf(s.address);
    console.log(`${label}: total ${t.total} min, verified ${t.verified} min, solo ${t.solo}, cross-country ${t.crossCountry}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
