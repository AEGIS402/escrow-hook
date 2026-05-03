const { ethers } = require("hardhat");
const {
  AUDIT_ACTION_BLOCK_AND_CLAIM,
  AUDIT_ACTION_RELEASE,
  assertE2E,
  auditDecision,
  buildContext,
  executeAuditDecisionOrLegacy,
  executeProtectedUsdtToAegis,
  loadDeployment,
  MIN_PRICE_LIMIT,
  plainAegisToUsdtSwap,
  plainUsdtToAegisSwap,
  prepareDemoPool,
  printableEscrow,
  saveResult,
  tokenAmount,
  waitForTx,
} = require("./deployedShared");

async function fundWallet(owner, wallet, amount) {
  const tx = await owner.sendTransaction({ to: wallet.address, value: amount });
  await tx.wait();
}

async function runDeployedScenario({ mode, resultFileName, owner }) {
  const deployment = loadDeployment();
  const ctx = buildContext(deployment, owner);
  const network = await ethers.provider.getNetwork();

  const auditorWallet = ethers.Wallet.createRandom().connect(ethers.provider);
  const userWallet = ethers.Wallet.createRandom().connect(ethers.provider);
  const attackerWallet = ethers.Wallet.createRandom().connect(ethers.provider);
  const auditor = new ethers.NonceManager(auditorWallet);
  const user = new ethers.NonceManager(userWallet);
  const attacker = new ethers.NonceManager(attackerWallet);
  auditor.address = auditorWallet.address;
  user.address = userWallet.address;
  attacker.address = attackerWallet.address;
  const fundAmount = ethers.parseEther(process.env.E2E_WALLET_FUND_ETH || "0.05");

  await fundWallet(owner, auditor, fundAmount);
  await fundWallet(owner, user, fundAmount);
  await fundWallet(owner, attacker, fundAmount);

  await waitForTx(ctx.vault.connect(owner).setAuditor(auditor.address, { gasLimit: 200_000 }));
  await prepareDemoPool(ctx, owner);

  const amountIn = ethers.parseEther("100");
  const expectedOutput = ethers.parseEther("99");
  const normalTradeId = ethers.id(`${mode}-normal-release-${Date.now()}`);
  const protectionFee = await ctx.adapter.protectionFee(amountIn);

  const normalRecipientBefore = await ctx.aegis.balanceOf(user.address);
  const insuranceUsdtBeforeNormal = await ctx.usdt.balanceOf(deployment.contracts.insurancePool);
  const normalEscrow = await executeProtectedUsdtToAegis(ctx, user, normalTradeId, amountIn, user.address, expectedOutput);

  assertE2E(BigInt(normalEscrow.state) === 1n, "normal swap must enter Pending state");
  assertE2E((await ctx.aegis.balanceOf(user.address)) === normalRecipientBefore, "normal recipient must wait for release");
  assertE2E(
    (await ctx.usdt.balanceOf(deployment.contracts.insurancePool)) === insuranceUsdtBeforeNormal + protectionFee,
    "normal protection fee must accrue to the insurance pool",
  );

  await executeAuditDecisionOrLegacy(
    ctx,
    auditor,
    auditDecision(
      normalTradeId,
      AUDIT_ACTION_RELEASE,
      ethers.encodeBytes32String("CLEAN"),
      ethers.id(`${mode}-normal-audit-evidence`),
    ),
    () => ctx.vault.connect(auditor).release(normalTradeId, { gasLimit: 500_000 }),
  );

  const releasedEscrow = await ctx.vault.escrows(normalTradeId);
  const normalRecipientAfter = await ctx.aegis.balanceOf(user.address);
  assertE2E(BigInt(releasedEscrow.state) === 2n, "normal escrow must be Released");
  assertE2E(
    normalRecipientAfter === normalRecipientBefore + normalEscrow.outputAmount,
    "normal recipient must receive escrowed AEGIS",
  );

  const attackAmount = ethers.parseEther(process.env.ATTACK_AMOUNT || "500000");
  const attackerAegisBefore = await ctx.aegis.balanceOf(attacker.address);
  await plainUsdtToAegisSwap(ctx, attacker, attackAmount);
  const attackerAegisAfterFrontRun = await ctx.aegis.balanceOf(attacker.address);
  const attackerBackRunAmount = attackerAegisAfterFrontRun - attackerAegisBefore;
  assertE2E(attackerBackRunAmount > 0n, "attacker front-run must receive AEGIS");

  const sandwichTradeId = ethers.id(`${mode}-sandwich-claim-${Date.now()}`);
  const sandwichEscrow = await executeProtectedUsdtToAegis(ctx, user, sandwichTradeId, amountIn, user.address);
  await plainAegisToUsdtSwap(ctx, attacker, attackerBackRunAmount);

  assertE2E(sandwichEscrow.outputAmount < normalEscrow.outputAmount, "extreme front-run must worsen victim output");
  assertE2E((await ctx.aegis.balanceOf(user.address)) === normalRecipientAfter, "sandwich output must remain escrowed");

  const userUsdtBeforeClaim = await ctx.usdt.balanceOf(user.address);
  const insuranceUsdtBeforeClaim = await ctx.usdt.balanceOf(deployment.contracts.insurancePool);
  const insuranceAegisBeforeClaim = await ctx.aegis.balanceOf(deployment.contracts.insurancePool);
  const vaultAegisBeforeClaim = await ctx.aegis.balanceOf(deployment.contracts.vault);

  await executeAuditDecisionOrLegacy(
    ctx,
    auditor,
    auditDecision(
      sandwichTradeId,
      AUDIT_ACTION_BLOCK_AND_CLAIM,
      ethers.encodeBytes32String("SANDWICH"),
      ethers.id(`${mode}-sandwich-audit-evidence`),
    ),
    () =>
      ctx.vault.connect(auditor).payClaim(sandwichTradeId, ethers.encodeBytes32String("SANDWICH"), {
        gasLimit: 1_000_000,
      }),
  );

  const paidEscrow = await ctx.vault.escrows(sandwichTradeId);
  const userUsdtAfterClaim = await ctx.usdt.balanceOf(user.address);
  const userAegisAfterClaim = await ctx.aegis.balanceOf(user.address);
  const insuranceUsdtAfterClaim = await ctx.usdt.balanceOf(deployment.contracts.insurancePool);
  const insuranceAegisAfterClaim = await ctx.aegis.balanceOf(deployment.contracts.insurancePool);
  const vaultAegisAfterClaim = await ctx.aegis.balanceOf(deployment.contracts.vault);

  assertE2E(BigInt(paidEscrow.state) === 3n, `sandwich escrow must be ClaimPaid, got ${paidEscrow.state}`);
  assertE2E(userUsdtAfterClaim === userUsdtBeforeClaim + amountIn, "user must receive original USDT input");
  assertE2E(userAegisAfterClaim === normalRecipientAfter, "user must not receive suspicious AEGIS output");
  assertE2E(
    insuranceAegisAfterClaim === insuranceAegisBeforeClaim + sandwichEscrow.outputAmount,
    "insurance pool must recover escrowed AEGIS",
  );
  assertE2E(vaultAegisAfterClaim === vaultAegisBeforeClaim - sandwichEscrow.outputAmount, "vault AEGIS must be cleared");

  const result = {
    mode,
    conclusion:
      "PASS: deployed USDT/AEGIS demo released clean settlement and paid insurance on the extreme loose-slippage sandwich case.",
    network: {
      chainId: network.chainId.toString(),
      name: mode,
    },
    deployment: deployment.contracts,
    auditEscrowStandard: deployment.auditEscrowStandard || null,
    generatedActors: {
      auditor: auditor.address,
      user: user.address,
      attacker: attacker.address,
      walletFundEth: ethers.formatEther(fundAmount),
    },
    normalCase: {
      auditAction: "RELEASE",
      tradeId: normalTradeId,
      inputToken: "USDT",
      outputToken: "AEGIS",
      amountIn: tokenAmount(amountIn),
      expectedOutput: tokenAmount(expectedOutput),
      protectionFee: tokenAmount(protectionFee),
      pendingEscrow: printableEscrow(normalEscrow),
      finalEscrowState: releasedEscrow.state.toString(),
      userAegisBeforeRelease: tokenAmount(normalRecipientBefore),
      userAegisAfterRelease: tokenAmount(normalRecipientAfter),
    },
    sandwichCase: {
      auditAction: "BLOCK_AND_CLAIM",
      tradeId: sandwichTradeId,
      victimSlippageModel: "max-loose price limit",
      victimSqrtPriceLimitX96: MIN_PRICE_LIMIT.toString(),
      attackerFrontRunUsdt: tokenAmount(attackAmount),
      attackerBackRunAegis: tokenAmount(attackerBackRunAmount),
      baselineCleanOutputAegis: tokenAmount(normalEscrow.outputAmount),
      attackedVictimOutputAegis: tokenAmount(sandwichEscrow.outputAmount),
      outputShortfallVsCleanCaseAegis: tokenAmount(normalEscrow.outputAmount - sandwichEscrow.outputAmount),
      pendingEscrow: printableEscrow(sandwichEscrow),
      finalEscrowState: paidEscrow.state.toString(),
      userUsdtBeforeClaim: tokenAmount(userUsdtBeforeClaim),
      userUsdtAfterClaim: tokenAmount(userUsdtAfterClaim),
      userAegisAfterClaim: tokenAmount(userAegisAfterClaim),
      insuranceUsdtBeforeClaim: tokenAmount(insuranceUsdtBeforeClaim),
      insuranceUsdtAfterClaim: tokenAmount(insuranceUsdtAfterClaim),
      insuranceAegisBeforeClaim: tokenAmount(insuranceAegisBeforeClaim),
      insuranceAegisAfterClaim: tokenAmount(insuranceAegisAfterClaim),
      vaultAegisBeforeClaim: tokenAmount(vaultAegisBeforeClaim),
      vaultAegisAfterClaim: tokenAmount(vaultAegisAfterClaim),
    },
  };

  saveResult(resultFileName, result);
  console.log(`DEPLOYED_DEMO_E2E_${mode.toUpperCase()}`);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  runDeployedScenario,
};
