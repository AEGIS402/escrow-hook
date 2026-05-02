const { ethers } = require("hardhat");
const {
  assertE2E,
  deployE2EFixture,
  executeProtectedSwap,
  printScenarioResult,
  printableEscrow,
  tokenAmount,
} = require("./shared");

async function main() {
  const fixture = await deployE2EFixture();
  const amountIn = ethers.parseEther("100");
  const expectedOutput = ethers.parseEther("99");
  const tradeId = ethers.id("e2e-normal-release");
  const protectionFee = await fixture.adapter.protectionFee(amountIn);

  const recipientOutputBefore = await fixture.outputToken.balanceOf(fixture.recipient.address);
  const vaultOutputBefore = await fixture.outputToken.balanceOf(fixture.vault.target);
  const insuranceInputBefore = await fixture.inputToken.balanceOf(fixture.insurancePool.target);

  const pendingEscrow = await executeProtectedSwap(fixture, tradeId, amountIn, expectedOutput);
  assertE2E(pendingEscrow.state === 1n, "protected swap must enter Pending state");
  assertE2E(
    (await fixture.outputToken.balanceOf(fixture.vault.target)) === vaultOutputBefore + pendingEscrow.outputAmount,
    "swap output must be held by the vault before audit release",
  );
  assertE2E(
    (await fixture.outputToken.balanceOf(fixture.recipient.address)) === recipientOutputBefore,
    "recipient must not receive funds before audit release",
  );
  assertE2E(
    (await fixture.inputToken.balanceOf(fixture.insurancePool.target)) === insuranceInputBefore + protectionFee,
    "insurance pool must receive the protection fee",
  );

  await fixture.vault.connect(fixture.auditor).release(tradeId);

  const releasedEscrow = await fixture.vault.escrows(tradeId);
  const recipientOutputAfter = await fixture.outputToken.balanceOf(fixture.recipient.address);
  const vaultOutputAfter = await fixture.outputToken.balanceOf(fixture.vault.target);
  const insuranceInputAfter = await fixture.inputToken.balanceOf(fixture.insurancePool.target);

  assertE2E(releasedEscrow.state === 2n, "audit pass must mark the escrow Released");
  assertE2E(
    recipientOutputAfter === recipientOutputBefore + pendingEscrow.outputAmount,
    "recipient must receive the escrowed output after release",
  );
  assertE2E(vaultOutputAfter === vaultOutputBefore, "vault must not keep output after release");

  printScenarioResult("E2E_NORMAL_RELEASE_RESULT", {
    scenario: "normal-clean-audit-release",
    conclusion: "PASS: protected output was escrowed first, then released to the settlement recipient by auditor action.",
    fork: {
      localNetwork: "hardhat",
      forkedChain: "sepolia",
      observedChainId: fixture.chainId,
    },
    officialUniswapV4: {
      poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
      poolSwapTest: "0x9b6b46e2c869aa39918db7f52f5557fe577b6eee",
      poolModifyLiquidityTest: "0x0c478023803a644c94c4ce1c1e7b9a087e411b0a",
    },
    inputs: {
      tradeId,
      user: fixture.user.address,
      auditor: fixture.auditor.address,
      settlementRecipient: fixture.recipient.address,
      inputToken: fixture.inputToken.target,
      outputToken: fixture.outputToken.target,
      amountIn: tokenAmount(amountIn),
      expectedOutput: tokenAmount(expectedOutput),
      protectionFee: tokenAmount(protectionFee),
    },
    outputs: {
      pendingEscrow: printableEscrow(pendingEscrow),
      finalEscrowState: releasedEscrow.state.toString(),
      recipientOutputBefore: tokenAmount(recipientOutputBefore),
      recipientOutputAfter: tokenAmount(recipientOutputAfter),
      vaultOutputBefore: tokenAmount(vaultOutputBefore),
      vaultOutputAfter: tokenAmount(vaultOutputAfter),
      insuranceInputBefore: tokenAmount(insuranceInputBefore),
      insuranceInputAfter: tokenAmount(insuranceInputAfter),
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
