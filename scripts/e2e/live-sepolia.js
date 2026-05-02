const { ethers } = require("hardhat");
const { runDeployedScenario } = require("./deployedScenario");

async function main() {
  const [owner] = await ethers.getSigners();
  const managedOwner = new ethers.NonceManager(owner);
  managedOwner.address = owner.address;
  await runDeployedScenario({
    mode: "sepolia-live",
    resultFileName: "sepolia-live-e2e.json",
    owner: managedOwner,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
