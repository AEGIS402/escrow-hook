const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const recipient = process.env.MINT_TO || "0xCAA001969758E2E2d71116f1318DFD84D4CE739d";
  const amountHuman = process.env.MINT_AMOUNT || "1000000000"; // 1B each, very generous

  const deploymentPath = path.join(__dirname, "..", "deployments", "sepolia-demo.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const { usdt: usdtAddr, aegis: aegisAddr } = deployment.contracts;

  const [signer] = await hre.ethers.getSigners();
  console.log("Signer:", signer.address);
  console.log("Recipient:", recipient);

  const erc20Abi = [
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function balanceOf(address) view returns (uint256)",
    "function mint(address to, uint256 amount)",
  ];

  const usdt = new hre.ethers.Contract(usdtAddr, erc20Abi, signer);
  const aegis = new hre.ethers.Contract(aegisAddr, erc20Abi, signer);

  for (const [label, token] of [["USDT", usdt], ["AEGIS", aegis]]) {
    const decimals = await token.decimals();
    const symbol = await token.symbol();
    const amount = hre.ethers.parseUnits(amountHuman, decimals);
    const before = await token.balanceOf(recipient);
    console.log(`\n${label} (${symbol}) @ ${await token.getAddress()}`);
    console.log(`  before: ${hre.ethers.formatUnits(before, decimals)}`);
    const tx = await token.mint(recipient, amount);
    console.log(`  tx:     ${tx.hash}`);
    const rcpt = await tx.wait();
    console.log(`  block:  ${rcpt.blockNumber}`);
    const after = await token.balanceOf(recipient);
    console.log(`  after:  ${hre.ethers.formatUnits(after, decimals)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
