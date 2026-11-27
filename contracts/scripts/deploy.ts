import { ethers, network, artifacts } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const CONTRACTS = ["AuthorityRegistry", "TrainingRegistry", "FlightLog", "LicenceManager"] as const;
const SHARED = path.join(__dirname, "..", "..", "shared");

async function main() {
  const [deployer, defaultOracle] = await ethers.getSigners();
  const oracleAddress = process.env.ORACLE_ADDRESS || defaultOracle?.address;
  if (!oracleAddress) throw new Error("Set ORACLE_ADDRESS in .env (the oracle service's wallet address).");

  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  const startBlock = await ethers.provider.getBlockNumber();

  const authorities = await (await ethers.getContractFactory("AuthorityRegistry")).deploy(deployer.address);
  await authorities.waitForDeployment();
  const authAddr = await authorities.getAddress();

  const registry = await (await ethers.getContractFactory("TrainingRegistry")).deploy(deployer.address, authAddr);
  await registry.waitForDeployment();
  const regAddr = await registry.getAddress();

  const flightLog = await (await ethers.getContractFactory("FlightLog")).deploy(deployer.address, authAddr, regAddr);
  await flightLog.waitForDeployment();
  const logAddr = await flightLog.getAddress();

  const licences = await (
    await ethers.getContractFactory("LicenceManager")
  ).deploy(deployer.address, authAddr, regAddr, logAddr);
  await licences.waitForDeployment();
  const licAddr = await licences.getAddress();

  await (await flightLog.grantRole(await flightLog.ORACLE_ROLE(), oracleAddress)).wait();

  const { chainId } = await ethers.provider.getNetwork();
  const deployment = {
    network: network.name,
    chainId: Number(chainId),
    startBlock,
    deployer: deployer.address,
    oracle: oracleAddress,
    contracts: {
      AuthorityRegistry: authAddr,
      TrainingRegistry: regAddr,
      FlightLog: logAddr,
      LicenceManager: licAddr,
    },
    deployedAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.join(SHARED, "deployments"), { recursive: true });
  fs.mkdirSync(path.join(SHARED, "abi"), { recursive: true });
  fs.writeFileSync(path.join(SHARED, "deployments", `${network.name}.json`), JSON.stringify(deployment, null, 2));
  for (const name of CONTRACTS) {
    const { abi } = await artifacts.readArtifact(name);
    fs.writeFileSync(path.join(SHARED, "abi", `${name}.json`), JSON.stringify(abi, null, 2));
  }

  console.table(deployment.contracts);
  console.log(`Oracle role granted to ${oracleAddress}`);
  console.log(`Saved addresses to shared/deployments/${network.name}.json and ABIs to shared/abi/`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
