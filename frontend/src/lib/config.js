// ABIs are committed in ../shared/abi. Deployment files are written by `npm run deploy:*`
// in contracts/ (localhost.json is git-ignored, so it only exists after a local deploy).
import AuthorityRegistry from "../../../shared/abi/AuthorityRegistry.json";
import TrainingRegistry from "../../../shared/abi/TrainingRegistry.json";
import FlightLog from "../../../shared/abi/FlightLog.json";
import LicenceManager from "../../../shared/abi/LicenceManager.json";

export const ABIS = { AuthorityRegistry, TrainingRegistry, FlightLog, LicenceManager };

const deploymentFiles = import.meta.glob("../../../shared/deployments/*.json", { eager: true, import: "default" });

export const LOCAL_CHAIN_ID = 31337;
export const LOCAL_RPC = "http://127.0.0.1:8545";

export const CHAIN_NAMES = {
  31337: "Local Hardhat",
  11155111: "Sepolia testnet",
};

/** The deployment (contract addresses) for a chain id, or null if none was deployed there. */
export function deploymentForChain(chainId) {
  return Object.values(deploymentFiles).find((d) => d.chainId === Number(chainId)) ?? null;
}
