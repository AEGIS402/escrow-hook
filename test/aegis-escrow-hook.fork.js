const { expect } = require("chai");
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

function toAddressBigInt(address) {
  return BigInt(address);
}

function sortTokens(tokenA, tokenB) {
  return toAddressBigInt(tokenA.target) < toAddressBigInt(tokenB.target)
    ? [tokenA, tokenB]
    : [tokenB, tokenA];
}

async function expectRevert(promise) {
  let reverted = false;
  try {
    await promise;
  } catch (error) {
    reverted = true;
  }
  expect(reverted).to.equal(true);
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

function protectedRequest(key, zeroForOne, tradeId, userAmount, settlementRecipient, expectedOutput = 0n) {
  return {
    key,
    zeroForOne,
    amountIn: userAmount,
    expectedOutput,
    sqrtPriceLimitX96: zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT,
    tradeId,
    settlementRecipient,
  };
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

async function deployFixture() {
  const [owner, auditor, liquidityProvider, user, recipient, attacker, insurer] = await ethers.getSigners();

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
  const attackerBalance = ethers.parseEther("100000");

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

describe("AEGIS402 insured escrow Uniswap v4 hook on Sepolia fork", function () {
  this.timeout(180_000);

  it("escrows protected swap output and releases it after a clean audit", async function () {
    const fixture = await deployFixture();
    const amountIn = ethers.parseEther("100");
    const tradeId = ethers.id("normal-protected-trade");
    const fee = await fixture.adapter.protectionFee(amountIn);

    const recipientOutputBefore = await fixture.outputToken.balanceOf(fixture.recipient.address);
    const poolInputBefore = await fixture.inputToken.balanceOf(fixture.insurancePool.target);

    const escrow = await executeProtectedSwap(fixture, tradeId, amountIn, ethers.parseEther("99"));

    expect(escrow.state).to.equal(1n);
    expect(escrow.user).to.equal(fixture.user.address);
    expect(escrow.settlementRecipient).to.equal(fixture.recipient.address);
    expect(escrow.inputAmount).to.equal(amountIn);
    expect(escrow.outputAmount > 0n).to.equal(true);
    expect(await fixture.outputToken.balanceOf(fixture.vault.target)).to.equal(escrow.outputAmount);
    expect(await fixture.outputToken.balanceOf(fixture.recipient.address)).to.equal(recipientOutputBefore);
    expect(await fixture.inputToken.balanceOf(fixture.insurancePool.target)).to.equal(poolInputBefore + fee);

    const cleanReason = ethers.encodeBytes32String("CLEAN");
    const evidenceHash = ethers.id("normal-audit-evidence");
    await fixture.vault
      .connect(fixture.auditor)
      .executeAuditDecision(auditDecision(tradeId, AUDIT_ACTION_RELEASE, cleanReason, evidenceHash));

    const released = await fixture.vault.escrows(tradeId);
    expect(released.state).to.equal(2n);
    expect(await fixture.vault.escrowStatus(tradeId)).to.equal(2n);
    expect(await fixture.outputToken.balanceOf(fixture.recipient.address)).to.equal(
      recipientOutputBefore + escrow.outputAmount,
    );
    expect(await fixture.outputToken.balanceOf(fixture.vault.target)).to.equal(0n);
  });

  it("blocks settlement and pays the input token amount after a sandwich-shaped audit failure", async function () {
    const fixture = await deployFixture();
    const amountIn = ethers.parseEther("100");
    const attackAmount = ethers.parseEther("10000");

    const snapshot = await network.provider.send("evm_snapshot");
    const baselineEscrow = await executeProtectedSwap(fixture, ethers.id("baseline-victim"), amountIn);
    const baselineOutput = baselineEscrow.outputAmount;
    await network.provider.send("evm_revert", [snapshot]);

    await fixture.poolSwapTest
      .connect(fixture.attacker)
      .swap(fixture.key, swapParams(fixture.zeroForOne, attackAmount), { takeClaims: false, settleUsingBurn: false }, "0x", {
        gasLimit: 4_000_000,
      });

    const victimTradeId = ethers.id("sandwich-victim");
    const victimEscrow = await executeProtectedSwap(fixture, victimTradeId, amountIn);

    const attackerOutputBalance = await fixture.outputToken.balanceOf(fixture.attacker.address);
    await fixture.poolSwapTest
      .connect(fixture.attacker)
      .swap(
        fixture.key,
        swapParams(!fixture.zeroForOne, attackerOutputBalance),
        { takeClaims: false, settleUsingBurn: false },
        "0x",
        { gasLimit: 4_000_000 },
      );

    expect(victimEscrow.outputAmount < baselineOutput).to.equal(true);
    expect(await fixture.outputToken.balanceOf(fixture.recipient.address)).to.equal(0n);

    const userInputBeforeClaim = await fixture.inputToken.balanceOf(fixture.user.address);
    const recoveredOutput = victimEscrow.outputAmount;
    const reason = ethers.encodeBytes32String("SANDWICH");

    await fixture.vault.connect(fixture.auditor).executeAuditDecision(
      auditDecision(victimTradeId, AUDIT_ACTION_BLOCK_AND_CLAIM, reason, ethers.id("sandwich-audit-evidence")),
      { gasLimit: 2_000_000 },
    );

    const paid = await fixture.vault.escrows(victimTradeId);
    expect(paid.state).to.equal(3n);
    expect(await fixture.vault.escrowStatus(victimTradeId)).to.equal(2n);
    expect(await fixture.inputToken.balanceOf(fixture.user.address)).to.equal(userInputBeforeClaim + amountIn);
    expect(await fixture.outputToken.balanceOf(fixture.recipient.address)).to.equal(0n);
    expect(await fixture.outputToken.balanceOf(fixture.insurancePool.target)).to.equal(recoveredOutput);
    expect(await fixture.outputToken.balanceOf(fixture.vault.target)).to.equal(0n);
  });

  it("reverts duplicate tradeIds", async function () {
    const fixture = await deployFixture();
    const amountIn = ethers.parseEther("10");
    const tradeId = ethers.id("duplicate-trade");

    await executeProtectedSwap(fixture, tradeId, amountIn);
    await expectRevert(executeProtectedSwap(fixture, tradeId, amountIn));
  });

  it("reverts claim payment when insurance reserve is insufficient", async function () {
    const fixture = await deployFixture();
    const amountIn = ethers.parseEther("100");
    const tradeId = ethers.id("underfunded-claim");

    await executeProtectedSwap(fixture, tradeId, amountIn);

    const reserveBalance = await fixture.inputToken.balanceOf(fixture.insurancePool.target);
    await fixture.insurancePool.withdraw(fixture.inputToken.target, fixture.owner.address, reserveBalance);

    await expectRevert(
      fixture.vault
        .connect(fixture.auditor)
        .executeAuditDecision(
          auditDecision(
            tradeId,
            AUDIT_ACTION_BLOCK_AND_CLAIM,
            ethers.encodeBytes32String("SANDWICH"),
            ethers.id("underfunded-claim-evidence"),
          ),
        ),
    );

    const escrow = await fixture.vault.escrows(tradeId);
    expect(escrow.state).to.equal(1n);
    expect(await fixture.vault.escrowStatus(tradeId)).to.equal(1n);
  });

  it("lets empty hookData swaps pass through without escrow", async function () {
    const fixture = await deployFixture();
    const amountIn = ethers.parseEther("25");

    const userOutputBefore = await fixture.outputToken.balanceOf(fixture.user.address);
    const vaultOutputBefore = await fixture.outputToken.balanceOf(fixture.vault.target);

    await fixture.poolSwapTest
      .connect(fixture.user)
      .swap(fixture.key, swapParams(fixture.zeroForOne, amountIn), { takeClaims: false, settleUsingBurn: false }, "0x", {
        gasLimit: 4_000_000,
      });

    expect((await fixture.outputToken.balanceOf(fixture.user.address)) > userOutputBefore).to.equal(true);
    expect(await fixture.outputToken.balanceOf(fixture.vault.target)).to.equal(vaultOutputBefore);
  });
});
