const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const { ethers } = hre;

const SQRT_PRICE_1_1 = 79228162514264337593543950336n;
const MIN_PRICE_LIMIT = 4295128740n;
const MAX_PRICE_LIMIT = 1461446703485210103287273052203988822378723970341n;
const MAX_UINT256 = (1n << 256n) - 1n;
const ZERO_BYTES32 = ethers.ZeroHash;
const AUDIT_ACTION_RELEASE = 0;
const AUDIT_ACTION_BLOCK_AND_CLAIM = 1;

const poolManagerAbi = [
  "function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,uint160 sqrtPriceX96) external returns (int24 tick)",
];

const poolModifyLiquidityAbi = [
  "function modifyLiquidity((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt) params,bytes hookData) external payable returns (int256 delta)",
];

const poolSwapTestAbi = [
  "function swap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,(bool takeClaims,bool settleUsingBurn) testSettings,bytes hookData) external payable returns (int256 delta)",
];

function assertE2E(condition, message) {
  if (!condition) throw new Error(`E2E assertion failed: ${message}`);
}

async function waitForTx(txPromise) {
  const tx = await txPromise;
  return tx.wait();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function signerAddress(signer) {
  return signer.address || signer.getAddress();
}

function tokenAmount(value) {
  return ethers.formatUnits(value, 18);
}

function auditDecision(escrowId, action, reason = ZERO_BYTES32, evidenceHash = ZERO_BYTES32, actionData = "0x") {
  return {
    escrowId,
    action,
    reason,
    evidenceHash,
    actionData,
  };
}

function supportsAuditEscrowStandard(deployment) {
  return Boolean(deployment.auditEscrowStandard);
}

async function executeAuditDecisionOrLegacy(ctx, auditAgent, decision, legacyCall) {
  if (supportsAuditEscrowStandard(ctx.deployment)) {
    return waitForTx(ctx.vault.connect(auditAgent).executeAuditDecision(decision, { gasLimit: 1_000_000 }));
  }

  return waitForTx(legacyCall());
}

async function waitForEscrowState(ctx, tradeId, expectedState, label) {
  let lastEscrow = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    lastEscrow = await ctx.vault.escrows(tradeId);
    if (BigInt(lastEscrow.state) === expectedState) return lastEscrow;
    await sleep(2_500);
  }

  throw new Error(
    `Timed out waiting for ${label} escrow ${tradeId} to reach state ${expectedState}; last state ${lastEscrow.state}`,
  );
}

function loadDeployment() {
  const deploymentPath = path.join(process.cwd(), "deployments", "sepolia-demo.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error("Missing deployments/sepolia-demo.json. Run npm run deploy:sepolia first.");
  }
  return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
}

function saveResult(fileName, result) {
  const outputPath = path.join(process.cwd(), "deployments", fileName);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

function sortAddresses(addressA, addressB) {
  return BigInt(addressA) < BigInt(addressB) ? [addressA, addressB] : [addressB, addressA];
}

function buildContext(deployment, signer) {
  const [currency0, currency1] = sortAddresses(deployment.contracts.usdt, deployment.contracts.aegis);
  const usdtToAegisZeroForOne = currency0 === deployment.contracts.usdt;

  const key = {
    currency0,
    currency1,
    fee: 3000,
    tickSpacing: 60,
    hooks: deployment.contracts.hook,
  };

  return {
    deployment,
    key,
    usdtToAegisZeroForOne,
    usdtToAegisPriceLimit: usdtToAegisZeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT,
    aegisToUsdtPriceLimit: usdtToAegisZeroForOne ? MAX_PRICE_LIMIT : MIN_PRICE_LIMIT,
    usdt: new ethers.Contract(deployment.contracts.usdt, require("../../artifacts/contracts/mocks/MockERC20.sol/MockERC20.json").abi, signer),
    aegis: new ethers.Contract(
      deployment.contracts.aegis,
      require("../../artifacts/contracts/mocks/MockERC20.sol/MockERC20.json").abi,
      signer,
    ),
    vault: new ethers.Contract(
      deployment.contracts.vault,
      require("../../artifacts/contracts/EscrowVault.sol/EscrowVault.json").abi,
      signer,
    ),
    adapter: new ethers.Contract(
      deployment.contracts.adapter,
      require("../../artifacts/contracts/AegisProtectedSwapAdapter.sol/AegisProtectedSwapAdapter.json").abi,
      signer,
    ),
    insurancePool: new ethers.Contract(
      deployment.contracts.insurancePool,
      require("../../artifacts/contracts/InsurancePool.sol/InsurancePool.json").abi,
      signer,
    ),
    poolManager: new ethers.Contract(deployment.officialUniswapV4.poolManager, poolManagerAbi, signer),
    poolModifyLiquidity: new ethers.Contract(
      deployment.officialUniswapV4.poolModifyLiquidityTest,
      poolModifyLiquidityAbi,
      signer,
    ),
    poolSwapTest: new ethers.Contract(deployment.officialUniswapV4.poolSwapTest, poolSwapTestAbi, signer),
  };
}

async function prepareDemoPool(ctx, liquidityProvider) {
  const providerAddress = await signerAddress(liquidityProvider);
  const huge = ethers.parseEther("10000000");
  await waitForTx(ctx.usdt.connect(liquidityProvider).mint(providerAddress, huge));
  await waitForTx(ctx.aegis.connect(liquidityProvider).mint(providerAddress, huge));
  await waitForTx(
    ctx.usdt.connect(liquidityProvider).approve(ctx.deployment.officialUniswapV4.poolModifyLiquidityTest, MAX_UINT256),
  );
  await waitForTx(
    ctx.aegis.connect(liquidityProvider).approve(ctx.deployment.officialUniswapV4.poolModifyLiquidityTest, MAX_UINT256),
  );

  try {
    await waitForTx(ctx.poolManager.connect(liquidityProvider).initialize(ctx.key, SQRT_PRICE_1_1, { gasLimit: 1_000_000 }));
  } catch (error) {
    console.log(`Pool initialize skipped or already completed: ${error.shortMessage || error.message}`);
  }
  const liquidityParams = {
    tickLower: -887220,
    tickUpper: 887220,
    liquidityDelta: ethers.parseEther("1000000"),
    salt: ZERO_BYTES32,
  };

  try {
    await waitForTx(
      ctx.poolModifyLiquidity
        .connect(liquidityProvider)
        .modifyLiquidity(ctx.key, liquidityParams, "0x", { gasLimit: 8_000_000 }),
    );
  } catch (error) {
    console.error("Pool liquidity preparation failed", {
      liquidityProvider: providerAddress,
      usdt: ctx.deployment.contracts.usdt,
      aegis: ctx.deployment.contracts.aegis,
      hook: ctx.deployment.contracts.hook,
      key: ctx.key,
      usdtCodeLength: (await ethers.provider.getCode(ctx.deployment.contracts.usdt)).length,
      aegisCodeLength: (await ethers.provider.getCode(ctx.deployment.contracts.aegis)).length,
      hookCodeLength: (await ethers.provider.getCode(ctx.deployment.contracts.hook)).length,
      usdtBalance: tokenAmount(await ctx.usdt.balanceOf(providerAddress)),
      aegisBalance: tokenAmount(await ctx.aegis.balanceOf(providerAddress)),
      usdtAllowance: tokenAmount(
        await ctx.usdt.allowance(providerAddress, ctx.deployment.officialUniswapV4.poolModifyLiquidityTest),
      ),
      aegisAllowance: tokenAmount(
        await ctx.aegis.allowance(providerAddress, ctx.deployment.officialUniswapV4.poolModifyLiquidityTest),
      ),
    });
    throw error;
  }
}

function protectedUsdtToAegisRequest(ctx, tradeId, amountIn, settlementRecipient, expectedOutput = 0n) {
  return {
    key: ctx.key,
    zeroForOne: ctx.usdtToAegisZeroForOne,
    amountIn,
    expectedOutput,
    sqrtPriceLimitX96: ctx.usdtToAegisPriceLimit,
    tradeId,
    settlementRecipient,
  };
}

function exactInputSwapParams(zeroForOne, amountIn) {
  return {
    zeroForOne,
    amountSpecified: -amountIn,
    sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT,
  };
}

async function executeProtectedUsdtToAegis(ctx, user, tradeId, amountIn, settlementRecipient, expectedOutput = 0n) {
  await waitForTx(ctx.usdt.connect(user).mint(user.address, amountIn * 100n));
  await waitForTx(ctx.usdt.connect(user).approve(ctx.deployment.contracts.adapter, MAX_UINT256));
  await waitForTx(
    ctx.adapter.connect(user).protectedExactInputSingle(
      protectedUsdtToAegisRequest(ctx, tradeId, amountIn, settlementRecipient, expectedOutput),
      { gasLimit: 4_000_000 },
    ),
  );

  return waitForEscrowState(ctx, tradeId, 1n, "protected swap");
}

async function plainUsdtToAegisSwap(ctx, trader, amountIn) {
  await waitForTx(ctx.usdt.connect(trader).mint(trader.address, amountIn));
  await waitForTx(ctx.usdt.connect(trader).approve(ctx.deployment.officialUniswapV4.poolSwapTest, MAX_UINT256));
  await waitForTx(
    ctx.poolSwapTest.connect(trader).swap(
      ctx.key,
      exactInputSwapParams(ctx.usdtToAegisZeroForOne, amountIn),
      { takeClaims: false, settleUsingBurn: false },
      "0x",
      { gasLimit: 4_000_000 },
    ),
  );
}

async function plainAegisToUsdtSwap(ctx, trader, amountIn) {
  await waitForTx(ctx.aegis.connect(trader).approve(ctx.deployment.officialUniswapV4.poolSwapTest, MAX_UINT256));
  await waitForTx(
    ctx.poolSwapTest.connect(trader).swap(
      ctx.key,
      exactInputSwapParams(!ctx.usdtToAegisZeroForOne, amountIn),
      { takeClaims: false, settleUsingBurn: false },
      "0x",
      { gasLimit: 4_000_000 },
    ),
  );
}

function printableEscrow(escrow) {
  return {
    state: escrow.state.toString(),
    user: escrow.user,
    inputToken: escrow.inputToken,
    inputAmount: tokenAmount(escrow.inputAmount),
    outputToken: escrow.outputToken,
    outputAmount: tokenAmount(escrow.outputAmount),
    settlementRecipient: escrow.settlementRecipient,
    expectedOutput: tokenAmount(escrow.expectedOutput),
  };
}

module.exports = {
  AUDIT_ACTION_BLOCK_AND_CLAIM,
  AUDIT_ACTION_RELEASE,
  MAX_PRICE_LIMIT,
  MIN_PRICE_LIMIT,
  assertE2E,
  auditDecision,
  buildContext,
  executeProtectedUsdtToAegis,
  executeAuditDecisionOrLegacy,
  loadDeployment,
  plainAegisToUsdtSwap,
  plainUsdtToAegisSwap,
  prepareDemoPool,
  printableEscrow,
  saveResult,
  tokenAmount,
  waitForEscrowState,
  waitForTx,
};
