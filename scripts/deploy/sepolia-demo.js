const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const { ethers } = hre;

const POOL_MANAGER = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
const POOL_SWAP_TEST = "0x9b6b46e2c869aa39918db7f52f5557fe577b6eee";
const HOOK_FLAGS = 0x44n;
const ALL_HOOK_MASK = (1n << 14n) - 1n;

function salt(base, label, index = 0n) {
  return ethers.solidityPackedKeccak256(["bytes32", "string", "uint256"], [base, label, index]);
}

function initCode(factory, types, values) {
  const encodedArgs = ethers.AbiCoder.defaultAbiCoder().encode(types, values);
  return ethers.concat([factory.bytecode, encodedArgs]);
}

function create2Address(deployer, saltValue, bytecode) {
  return ethers.getCreate2Address(deployer, saltValue, ethers.keccak256(bytecode));
}

async function mineHookSalt(base, deployerAddress, hookInitFactory) {
  for (let i = 0n; i < 1_000_000n; i += 1n) {
    const hookSalt = salt(base, "hook", i);
    const predictedHook = create2Address(deployerAddress, hookSalt, hookInitFactory());
    if ((BigInt(predictedHook) & ALL_HOOK_MASK) === HOOK_FLAGS) {
      return { hookSalt, predictedHook, hookSaltIndex: i.toString() };
    }
  }

  throw new Error("Unable to mine a hook salt with the required v4 permission bits");
}

async function assertStandardDemoDeployer(demoDeployer) {
  try {
    const version = await demoDeployer.auditEscrowStandardVersion();
    if (version !== "1.0.0") {
      throw new Error(`unsupported version ${version}`);
    }
  } catch (error) {
    throw new Error(
      `AEGIS_DEMO_DEPLOYER points to a legacy or incompatible deployer at ${demoDeployer.target}. Unset AEGIS_DEMO_DEPLOYER to deploy a new standard-aware deployer.`,
    );
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 11155111n) {
    throw new Error(`Expected Sepolia chainId 11155111, got ${network.chainId}`);
  }

  const deployerBalance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deploying from ${deployer.address}`);
  console.log(`Deployer ETH balance ${ethers.formatEther(deployerBalance)}`);

  let demoDeployer;
  let demoDeployerReceipt = null;
  if (process.env.AEGIS_DEMO_DEPLOYER) {
    demoDeployer = await ethers.getContractAt("AegisDemoDeployer", process.env.AEGIS_DEMO_DEPLOYER);
    await assertStandardDemoDeployer(demoDeployer);
    console.log(`Using existing AegisDemoDeployer at ${demoDeployer.target}`);
  } else {
    demoDeployer = await ethers.deployContract("AegisDemoDeployer", [POOL_MANAGER, POOL_SWAP_TEST]);
    await demoDeployer.waitForDeployment();
    demoDeployerReceipt = await demoDeployer.deploymentTransaction().wait();
    console.log(`AegisDemoDeployer deployed at ${demoDeployer.target}`);
  }

  const base = ethers.id(`aegis-demo-${network.chainId}-${demoDeployer.target}-${Date.now()}`);
  const usdtSalt = salt(base, "usdt");
  const aegisSalt = salt(base, "aegis");
  const insurancePoolSalt = salt(base, "insurance-pool");
  const vaultSalt = salt(base, "vault");
  const adapterSalt = salt(base, "adapter");

  const tokenFactory = await ethers.getContractFactory("MockERC20");
  const insuranceFactory = await ethers.getContractFactory("InsurancePool");
  const vaultFactory = await ethers.getContractFactory("EscrowVault");
  const hookFactory = await ethers.getContractFactory("AegisEscrowHook");
  const adapterFactory = await ethers.getContractFactory("AegisProtectedSwapAdapter");

  const usdtInit = initCode(tokenFactory, ["string", "string", "uint8"], ["Mock USDT", "USDT", 18]);
  const aegisInit = initCode(tokenFactory, ["string", "string", "uint8"], ["Mock AEGIS", "AEGIS", 18]);
  const insuranceInit = initCode(insuranceFactory, ["address"], [demoDeployer.target]);

  const predictedUsdt = create2Address(demoDeployer.target, usdtSalt, usdtInit);
  const predictedAegis = create2Address(demoDeployer.target, aegisSalt, aegisInit);
  const predictedInsurancePool = create2Address(demoDeployer.target, insurancePoolSalt, insuranceInit);

  const vaultInit = initCode(
    vaultFactory,
    ["address", "address", "address"],
    [demoDeployer.target, deployer.address, predictedInsurancePool],
  );
  const predictedVault = create2Address(demoDeployer.target, vaultSalt, vaultInit);

  const hookInitFactory = () => initCode(hookFactory, ["address", "address"], [POOL_MANAGER, predictedVault]);
  const { hookSalt, predictedHook, hookSaltIndex } = await mineHookSalt(base, demoDeployer.target, hookInitFactory);

  const adapterInit = initCode(adapterFactory, ["address", "address"], [POOL_SWAP_TEST, predictedInsurancePool]);
  const predictedAdapter = create2Address(demoDeployer.target, adapterSalt, adapterInit);

  const insuranceReserve = ethers.parseEther("1000000");
  const config = {
    usdtSalt,
    aegisSalt,
    insurancePoolSalt,
    vaultSalt,
    hookSalt,
    adapterSalt,
    finalOwner: deployer.address,
    initialAuditor: deployer.address,
    insuranceUsdtAmount: insuranceReserve,
    insuranceAegisAmount: insuranceReserve,
  };

  console.log(`Mined hook salt index ${hookSaltIndex}`);
  console.log(`Predicted hook ${predictedHook}`);

  const estimatedGas = await demoDeployer.deployDemo.estimateGas(config);
  const gasLimit = (estimatedGas * 120n) / 100n;
  console.log(`Estimated deployDemo gas ${estimatedGas}; using gas limit ${gasLimit}`);

  const deployTx = await demoDeployer.deployDemo(config, { gasLimit });
  const deployReceipt = await deployTx.wait();

  const deployment = {
    network: "sepolia",
    chainId: network.chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    officialUniswapV4: {
      poolManager: POOL_MANAGER,
      poolSwapTest: POOL_SWAP_TEST,
      poolModifyLiquidityTest: "0x0c478023803a644c94c4ce1c1e7b9a087e411b0a",
    },
    auditEscrowStandard: {
      version: "1.0.0",
      entrypoint: "executeAuditDecision((bytes32,uint8,bytes32,bytes32,bytes))",
      actions: ["RELEASE", "BLOCK_AND_CLAIM", "RECOVER_TO_RESERVE", "CUSTOM"],
    },
    transactions: {
      aegisDemoDeployer: demoDeployerReceipt ? demoDeployerReceipt.hash : null,
      deployDemo: deployReceipt.hash,
    },
    contracts: {
      aegisDemoDeployer: demoDeployer.target,
      usdt: predictedUsdt,
      aegis: predictedAegis,
      insurancePool: predictedInsurancePool,
      vault: predictedVault,
      hook: predictedHook,
      adapter: predictedAdapter,
    },
    salts: {
      usdtSalt,
      aegisSalt,
      insurancePoolSalt,
      vaultSalt,
      hookSalt,
      hookSaltIndex,
      adapterSalt,
    },
    initialConfig: {
      finalOwner: deployer.address,
      initialAuditor: deployer.address,
      tokenDecimals: "18",
      protectionFeeBps: "50",
      insuranceUsdtAmount: ethers.formatEther(insuranceReserve),
      insuranceAegisAmount: ethers.formatEther(insuranceReserve),
    },
  };

  fs.mkdirSync(path.join(process.cwd(), "deployments"), { recursive: true });
  fs.writeFileSync(
    path.join(process.cwd(), "deployments", "sepolia-demo.json"),
    `${JSON.stringify(deployment, null, 2)}\n`,
  );

  console.log("SEPOLIA_DEMO_DEPLOYMENT");
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
