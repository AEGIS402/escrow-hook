const { ethers, network } = require("hardhat");
const {
  assertE2E,
  deployE2EFixture,
  executeProtectedSwap,
  printScenarioResult,
  printableEscrow,
  swapParams,
  tokenAmount,
} = require("./shared");

async function main() {
  const fixture = await deployE2EFixture();
  const amountIn = ethers.parseEther("100");
  const attackAmount = ethers.parseEther("10000");
  const reason = ethers.encodeBytes32String("SANDWICH");

  const baselineSnapshot = await network.provider.send("evm_snapshot");
  const baselineEscrow = await executeProtectedSwap(fixture, ethers.id("e2e-baseline-victim"), amountIn);
  const baselineOutput = baselineEscrow.outputAmount;
  await network.provider.send("evm_revert", [baselineSnapshot]);

  await fixture.poolSwapTest
    .connect(fixture.attacker)
    .swap(fixture.key, swapParams(true, attackAmount), { takeClaims: false, settleUsingBurn: false }, "0x", {
      gasLimit: 4_000_000,
    });

  const tradeId = ethers.id("e2e-sandwich-claim");
  const victimEscrow = await executeProtectedSwap(fixture, tradeId, amountIn);

  const attackerOutputBalance = await fixture.outputToken.balanceOf(fixture.attacker.address);
  await fixture.poolSwapTest
    .connect(fixture.attacker)
    .swap(
      fixture.key,
      swapParams(false, attackerOutputBalance),
      { takeClaims: false, settleUsingBurn: false },
      "0x",
      { gasLimit: 4_000_000 },
    );

  assertE2E(victimEscrow.outputAmount < baselineOutput, "front-run must worsen the victim output");
  assertE2E(
    (await fixture.outputToken.balanceOf(fixture.recipient.address)) === 0n,
    "recipient must not receive funds before failed audit resolution",
  );

  const userInputBeforeClaim = await fixture.inputToken.balanceOf(fixture.user.address);
  const insuranceInputBeforeClaim = await fixture.inputToken.balanceOf(fixture.insurancePool.target);
  const insuranceOutputBeforeClaim = await fixture.outputToken.balanceOf(fixture.insurancePool.target);
  const vaultOutputBeforeClaim = await fixture.outputToken.balanceOf(fixture.vault.target);

  await fixture.vault.connect(fixture.auditor).payClaim(tradeId, reason, { gasLimit: 2_000_000 });

  const paidEscrow = await fixture.vault.escrows(tradeId);
  const userInputAfterClaim = await fixture.inputToken.balanceOf(fixture.user.address);
  const recipientOutputAfterClaim = await fixture.outputToken.balanceOf(fixture.recipient.address);
  const insuranceInputAfterClaim = await fixture.inputToken.balanceOf(fixture.insurancePool.target);
  const insuranceOutputAfterClaim = await fixture.outputToken.balanceOf(fixture.insurancePool.target);
  const vaultOutputAfterClaim = await fixture.outputToken.balanceOf(fixture.vault.target);

  assertE2E(paidEscrow.state === 3n, "failed audit must mark escrow ClaimPaid");
  assertE2E(userInputAfterClaim === userInputBeforeClaim + amountIn, "user must receive the original input amount");
  assertE2E(recipientOutputAfterClaim === 0n, "recipient settlement must remain blocked");
  assertE2E(
    insuranceOutputAfterClaim === insuranceOutputBeforeClaim + victimEscrow.outputAmount,
    "insurance pool must receive recovered escrow output",
  );
  assertE2E(vaultOutputAfterClaim === vaultOutputBeforeClaim - victimEscrow.outputAmount, "vault output must be recovered");

  printScenarioResult("E2E_SANDWICH_CLAIM_RESULT", {
    scenario: "sandwich-shaped-audit-failure-claim",
    conclusion:
      "PASS: suspicious settlement was blocked, user received the original input amount, and escrowed output was recovered by the insurance pool.",
    fork: {
      localNetwork: "hardhat",
      forkedChain: "sepolia",
      observedChainId: fixture.chainId,
    },
    inputs: {
      tradeId,
      user: fixture.user.address,
      auditor: fixture.auditor.address,
      attacker: fixture.attacker.address,
      settlementRecipient: fixture.recipient.address,
      inputToken: fixture.inputToken.target,
      outputToken: fixture.outputToken.target,
      victimAmountIn: tokenAmount(amountIn),
      attackerFrontRunAmountIn: tokenAmount(attackAmount),
      attackerBackRunAmountIn: tokenAmount(attackerOutputBalance),
      auditReason: "SANDWICH",
    },
    outputs: {
      baselineVictimOutput: tokenAmount(baselineOutput),
      attackedVictimOutput: tokenAmount(victimEscrow.outputAmount),
      outputShortfallVsBaseline: tokenAmount(baselineOutput - victimEscrow.outputAmount),
      pendingEscrow: printableEscrow(victimEscrow),
      finalEscrowState: paidEscrow.state.toString(),
      userInputBeforeClaim: tokenAmount(userInputBeforeClaim),
      userInputAfterClaim: tokenAmount(userInputAfterClaim),
      recipientOutputAfterClaim: tokenAmount(recipientOutputAfterClaim),
      insuranceInputBeforeClaim: tokenAmount(insuranceInputBeforeClaim),
      insuranceInputAfterClaim: tokenAmount(insuranceInputAfterClaim),
      insuranceOutputBeforeClaim: tokenAmount(insuranceOutputBeforeClaim),
      insuranceOutputAfterClaim: tokenAmount(insuranceOutputAfterClaim),
      vaultOutputBeforeClaim: tokenAmount(vaultOutputBeforeClaim),
      vaultOutputAfterClaim: tokenAmount(vaultOutputAfterClaim),
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
