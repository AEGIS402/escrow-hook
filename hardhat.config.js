require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config();

const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL || "https://sepolia.gateway.tenderly.co";
const RAW_PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const PRIVATE_KEY =
  RAW_PRIVATE_KEY && RAW_PRIVATE_KEY.startsWith("0x")
    ? RAW_PRIVATE_KEY
    : RAW_PRIVATE_KEY
      ? `0x${RAW_PRIVATE_KEY}`
      : "";
const sepoliaAccounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];
const FORK_BLOCK_NUMBER = process.env.FORK_BLOCK_NUMBER ? Number(process.env.FORK_BLOCK_NUMBER) : undefined;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

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
        ...(FORK_BLOCK_NUMBER ? { blockNumber: FORK_BLOCK_NUMBER } : {}),
      },
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      chainId: 11155111,
      accounts: sepoliaAccounts,
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
  sourcify: {
    enabled: false,
  },
};
