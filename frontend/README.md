# FlightProof website

React + [ethers.js v6](https://docs.ethers.org/v6/) + MetaMask. No backend: roles and data are read
straight from the contracts. Without MetaMask the site works in **read-only** mode against the
local chain (useful for the public "verify a pilot" page).

## Run it

The local chain must be running, with the contracts deployed and seeded (see the main README).

```powershell
cd frontend; npm install; npm run dev
```

Open http://localhost:5173.

## MetaMask setup for the local demo

1. **Use a separate MetaMask account or browser profile for testing.** Never use a wallet that holds real money.
2. Click **Connect MetaMask**, then **Switch to Local Hardhat** (the site adds the network:
   RPC `http://127.0.0.1:8545`, chain id `31337`).
3. Import the demo wallets you need (MetaMask → *Add account* → *Import account*) using the private
   keys printed by `npx hardhat node`. These are **public test keys**: only for the local chain.

   | Hardhat account | Demo role |
   |---|---|
   | #2 | Authority A admin |
   | #3 | Authority B admin |
   | #5 | Flight school admin (school 1) |
   | #6 | Instructor |
   | #8 | Student |

4. **After restarting the local chain**, MetaMask remembers old transaction counts and may fail with
   a "nonce" error. Fix: MetaMask → Settings → Advanced → **Clear activity tab data**.

## Structure

```
src/
  context/FlightProofContext.jsx  provider (MetaMask or read-only), chain time, transaction runner
  hooks/useWallet.js              connect, account/chain changes, switch to the local chain
  hooks/useRoles.js               reads the wallet's roles from the contracts
  lib/                            ABIs + addresses, contract objects, formatting, error messages
  components/                     header, network notices, role badges, transaction panel
  pages/                          one page per role
```
