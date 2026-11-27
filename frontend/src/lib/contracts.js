import { Contract } from "ethers";
import { ABIS } from "./config.js";

/**
 * The four FlightProof contracts, connected to a "runner":
 * a provider for reading, or a MetaMask signer for sending transactions.
 */
export function getContracts(deployment, runner) {
  const c = deployment.contracts;
  return {
    authorities: new Contract(c.AuthorityRegistry, ABIS.AuthorityRegistry, runner),
    registry: new Contract(c.TrainingRegistry, ABIS.TrainingRegistry, runner),
    flightLog: new Contract(c.FlightLog, ABIS.FlightLog, runner),
    licences: new Contract(c.LicenceManager, ABIS.LicenceManager, runner),
  };
}
