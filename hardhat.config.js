require("@nomicfoundation/hardhat-ethers");
require("dotenv").config();

const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL || "https://sepolia.gateway.tenderly.co";

module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      hardfork: "cancun",
      forking: {
        url: SEPOLIA_RPC_URL,
        enabled: true,
      },
    },
  },
};
