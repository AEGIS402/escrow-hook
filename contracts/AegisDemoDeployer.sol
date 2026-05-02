// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {AegisEscrowHook} from "./AegisEscrowHook.sol";
import {AegisProtectedSwapAdapter} from "./AegisProtectedSwapAdapter.sol";
import {EscrowVault} from "./EscrowVault.sol";
import {IAegisEscrowVault} from "./interfaces/IAegisEscrowVault.sol";
import {IAegisInsurancePool} from "./interfaces/IAegisInsurancePool.sol";
import {IPoolSwapTest} from "./interfaces/IPoolSwapTest.sol";
import {InsurancePool} from "./InsurancePool.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract AegisDemoDeployer {
    IPoolManager public immutable poolManager;
    IPoolSwapTest public immutable poolSwapTest;

    struct DeployConfig {
        bytes32 usdtSalt;
        bytes32 aegisSalt;
        bytes32 insurancePoolSalt;
        bytes32 vaultSalt;
        bytes32 hookSalt;
        bytes32 adapterSalt;
        address finalOwner;
        address initialAuditor;
        uint256 insuranceUsdtAmount;
        uint256 insuranceAegisAmount;
    }

    struct DeployedContracts {
        address usdt;
        address aegis;
        address insurancePool;
        address vault;
        address hook;
        address adapter;
    }

    event DemoDeployed(
        address indexed finalOwner,
        address indexed initialAuditor,
        address usdt,
        address aegis,
        address insurancePool,
        address vault,
        address hook,
        address adapter,
        uint256 insuranceUsdtAmount,
        uint256 insuranceAegisAmount
    );

    error ZeroAddress();

    constructor(IPoolManager officialPoolManager, IPoolSwapTest officialPoolSwapTest) {
        if (address(officialPoolManager) == address(0) || address(officialPoolSwapTest) == address(0)) {
            revert ZeroAddress();
        }

        poolManager = officialPoolManager;
        poolSwapTest = officialPoolSwapTest;
    }

    function deployDemo(DeployConfig calldata config) external returns (DeployedContracts memory deployed) {
        if (config.finalOwner == address(0) || config.initialAuditor == address(0)) revert ZeroAddress();

        MockERC20 usdt = new MockERC20{salt: config.usdtSalt}("Mock USDT", "USDT", 18);
        MockERC20 aegis = new MockERC20{salt: config.aegisSalt}("Mock AEGIS", "AEGIS", 18);

        InsurancePool insurancePool = new InsurancePool{salt: config.insurancePoolSalt}(address(this));
        EscrowVault vault = new EscrowVault{salt: config.vaultSalt}(
            address(this), config.initialAuditor, IAegisInsurancePool(address(insurancePool))
        );
        AegisEscrowHook hook =
            new AegisEscrowHook{salt: config.hookSalt}(poolManager, IAegisEscrowVault(address(vault)));
        AegisProtectedSwapAdapter adapter =
            new AegisProtectedSwapAdapter{salt: config.adapterSalt}(poolSwapTest, IAegisInsurancePool(address(insurancePool)));

        insurancePool.setVault(address(vault));
        insurancePool.setFeeReporter(address(adapter));
        vault.setHook(address(hook));

        if (config.insuranceUsdtAmount > 0) usdt.mint(address(insurancePool), config.insuranceUsdtAmount);
        if (config.insuranceAegisAmount > 0) aegis.mint(address(insurancePool), config.insuranceAegisAmount);

        insurancePool.transferOwnership(config.finalOwner);
        vault.transferOwnership(config.finalOwner);

        deployed = DeployedContracts({
            usdt: address(usdt),
            aegis: address(aegis),
            insurancePool: address(insurancePool),
            vault: address(vault),
            hook: address(hook),
            adapter: address(adapter)
        });

        emit DemoDeployed(
            config.finalOwner,
            config.initialAuditor,
            deployed.usdt,
            deployed.aegis,
            deployed.insurancePool,
            deployed.vault,
            deployed.hook,
            deployed.adapter,
            config.insuranceUsdtAmount,
            config.insuranceAegisAmount
        );
    }
}
