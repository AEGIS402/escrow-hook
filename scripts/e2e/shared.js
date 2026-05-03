const hre = require("hardhat");

const { ethers, network } = hre;

const POOL_MANAGER = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
const POOL_SWAP_TEST = "0x9b6b46e2c869aa39918db7f52f5557fe577b6eee";
const POOL_MODIFY_LIQUIDITY_TEST = "0x0c478023803a644c94c4ce1c1e7b9a087e411b0a";

const SQRT_PRICE_1_1 = 79228162514264337593543950336n;
const MIN_PRICE_LIMIT = 4295128740n;
const MAX_PRICE_LIMIT = 1461446703485210103287273052203988822378723970341n;
const HOOK_FLAGS = 0x44n;
const ALL_HOOK_MASK = (1n << 14n) - 1n;
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
  if (!condition) {
    throw new Error(`E2E assertion failed: ${message}`);
  }
}

function toAddressBigInt(address) {
  return BigInt(address);
}

function sortTokens(tokenA, tokenB) {
  return toAddressBigInt(tokenA.target) < toAddressBigInt(tokenB.target)
    ? [tokenA, tokenB]
    : [tokenB, tokenA];
}

async function mineHookSalt(deployerAddress, initCode) {
  const initCodeHash = ethers.keccak256(initCode);

  for (let i = 0n; i < 500_000n; i += 1n) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const predicted = ethers.getCreate2Address(deployerAddress, salt, initCodeHash);
    if ((toAddressBigInt(predicted) & ALL_HOOK_MASK) === HOOK_FLAGS) {
      return { salt, predicted };
    }
  }

  throw new Error("Unable to mine hook salt");
}

function swapParams(zeroForOne, amountIn) {
  return {
    zeroForOne,
    amountSpecified: -amountIn,
    sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT,
  };
}

function protectedRequest(key, zeroForOne, tradeId, amountIn, settlementRecipient, expectedOutput = 0n) {
  return {
    key,
    zeroForOne,
    amountIn,
    expectedOutput,
    sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT,
    tradeId,
    settlementRecipient,
  };
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

async function deployE2EFixture() {
  const [owner, auditor, liquidityProvider, user, recipient, attacker, insurer] = await ethers.getSigners();
  const networkInfo = await ethers.provider.getNetwork();
  assertE2E(network.name === "hardhat", "run this script with --network hardhat so Sepolia is forked locally");

  const usdt = await ethers.deployContract("MockERC20", ["Mock USDT", "USDT", 18]);
  const aegis = await ethers.deployContract("MockERC20", ["Mock AEGIS", "AEGIS", 18]);
  await usdt.waitForDeployment();
  await aegis.waitForDeployment();

  const [token0, token1] = sortTokens(usdt, aegis);
  const inputToken = usdt;
  const outputToken = aegis;
  const zeroForOne = token0.target === usdt.target;

  const insurancePool = await ethers.deployContract("InsurancePool", [owner.address]);
  await insurancePool.waitForDeployment();

  const vault = await ethers.deployContract("EscrowVault", [owner.address, auditor.address, insurancePool.target]);
  await vault.waitForDeployment();
  await insurancePool.setVault(vault.target);

  const create2Deployer = await ethers.deployContract("Create2Deployer");
  await create2Deployer.waitForDeployment();

  const hookFactory = await ethers.getContractFactory("AegisEscrowHook");
  const constructorArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address"],
    [POOL_MANAGER, vault.target],
  );
  const hookInitCode = ethers.concat([hookFactory.bytecode, constructorArgs]);
  const { salt, predicted } = await mineHookSalt(create2Deployer.target, hookInitCode);
  await create2Deployer.deploy(salt, hookInitCode);
  const hook = hookFactory.attach(predicted);
  await vault.setHook(hook.target);

  const adapter = await ethers.deployContract("AegisProtectedSwapAdapter", [POOL_SWAP_TEST, insurancePool.target]);
  await adapter.waitForDeployment();
  await insurancePool.setFeeReporter(adapter.target);

  const poolManager = new ethers.Contract(POOL_MANAGER, poolManagerAbi, owner);
  const poolModifyLiquidity = new ethers.Contract(
    POOL_MODIFY_LIQUIDITY_TEST,
    poolModifyLiquidityAbi,
    liquidityProvider,
  );
  const poolSwapTest = new ethers.Contract(POOL_SWAP_TEST, poolSwapTestAbi, owner);

  const key = {
    currency0: token0.target,
    currency1: token1.target,
    fee: 3000,
    tickSpacing: 60,
    hooks: hook.target,
  };

  await poolManager.initialize(key, SQRT_PRICE_1_1);

  const huge = ethers.parseEther("10000000");
  const reserve = ethers.parseEther("100000");
  const userBalance = ethers.parseEther("10000");
  const attackerBalance = ethers.parseEther("1000000");

  for (const token of [token0, token1]) {
    await token.mint(liquidityProvider.address, huge);
    await token.connect(liquidityProvider).approve(POOL_MODIFY_LIQUIDITY_TEST, MAX_UINT256);
  }

  await inputToken.mint(user.address, userBalance);
  await inputToken.connect(user).approve(adapter.target, MAX_UINT256);
  await inputToken.connect(user).approve(POOL_SWAP_TEST, MAX_UINT256);

  await inputToken.mint(attacker.address, attackerBalance);
  await inputToken.connect(attacker).approve(POOL_SWAP_TEST, MAX_UINT256);
  await outputToken.connect(attacker).approve(POOL_SWAP_TEST, MAX_UINT256);

  await inputToken.mint(insurer.address, reserve);
  await inputToken.connect(insurer).approve(insurancePool.target, reserve);
  await insurancePool.connect(insurer).fund(inputToken.target, reserve);

  await poolModifyLiquidity.modifyLiquidity(
    key,
    {
      tickLower: -887220,
      tickUpper: 887220,
      liquidityDelta: ethers.parseEther("1000000"),
      salt: ZERO_BYTES32,
    },
    "0x",
    { gasLimit: 8_000_000 },
  );

  return {
    chainId: networkInfo.chainId.toString(),
    owner,
    auditor,
    liquidityProvider,
    user,
    recipient,
    attacker,
    insurer,
    token0,
    token1,
    usdt,
    aegis,
    inputToken,
    outputToken,
    zeroForOne,
    insurancePool,
    vault,
    hook,
    adapter,
    poolManager,
    poolModifyLiquidity,
    poolSwapTest,
    key,
    reserve,
    create2Salt: salt,
  };
}

async function executeProtectedSwap(fixture, tradeId, amountIn, expectedOutput = 0n) {
  await fixture.adapter
    .connect(fixture.user)
    .protectedExactInputSingle(
      protectedRequest(fixture.key, fixture.zeroForOne, tradeId, amountIn, fixture.recipient.address, expectedOutput),
      { gasLimit: 4_000_000 },
    );

  return fixture.vault.escrows(tradeId);
}

function printScenarioResult(title, result) {
  console.log(`\n${title}`);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  AUDIT_ACTION_BLOCK_AND_CLAIM,
  AUDIT_ACTION_RELEASE,
  MAX_PRICE_LIMIT,
  MIN_PRICE_LIMIT,
  POOL_MANAGER,
  POOL_SWAP_TEST,
  POOL_MODIFY_LIQUIDITY_TEST,
  assertE2E,
  auditDecision,
  deployE2EFixture,
  executeProtectedSwap,
  printScenarioResult,
  printableEscrow,
  protectedRequest,
  swapParams,
  tokenAmount,
};
