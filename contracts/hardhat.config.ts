import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config({ quiet: true });

// Never commit a real key. Only .env.example belongs in the repository.
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
const sepoliaAccounts = deployerKey ? [deployerKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      // For the demo the local chain can start on a chosen date, so recorded
      // (historical) OpenSky flights are "recent" from the chain's point of view.
      initialDate: process.env.DEMO_START_DATE || undefined,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL ?? "",
      accounts: sepoliaAccounts,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    outputFile: process.env.GAS_REPORT_FILE || undefined,
    noColors: !!process.env.GAS_REPORT_FILE,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY ?? "",
  },
};

export default config;
