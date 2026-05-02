const { ethers } = require("hardhat");
const { runDeployedScenario } = require("./deployedScenario");

async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required to control the deployed demo owner on the local fork");
  }

  const owner = new ethers.Wallet(process.env.PRIVATE_KEY, ethers.provider);
  const managedOwner = new ethers.NonceManager(owner);
  managedOwner.address = owner.address;
  await runDeployedScenario({
    mode: "sepolia-fork",
    resultFileName: "sepolia-fork-e2e.json",
    owner: managedOwner,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
