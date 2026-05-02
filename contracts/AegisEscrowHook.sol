// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IAegisEscrowVault} from "./interfaces/IAegisEscrowVault.sol";

contract AegisEscrowHook is BaseHook {
    using BalanceDeltaLibrary for BalanceDelta;

    struct ProtectedHookData {
        bytes32 tradeId;
        address user;
        address settlementRecipient;
        uint256 amountIn;
        uint256 expectedOutput;
    }

    IAegisEscrowVault public immutable vault;

    error OnlyExactInputProtectedSwaps();
    error NativeCurrencyUnsupported();
    error InvalidProtectedAmount(uint256 expected, uint256 actual);
    error NoOutputToEscrow();

    constructor(IPoolManager manager, IAegisEscrowVault escrowVault) BaseHook(manager) {
        vault = escrowVault;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function encodeHookData(
        bytes32 tradeId,
        address user,
        address settlementRecipient,
        uint256 amountIn,
        uint256 expectedOutput
    ) external pure returns (bytes memory) {
        return abi.encode(ProtectedHookData(tradeId, user, settlementRecipient, amountIn, expectedOutput));
    }

    function _afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        if (hookData.length == 0) {
            return (BaseHook.afterSwap.selector, 0);
        }
        if (params.amountSpecified >= 0) revert OnlyExactInputProtectedSwaps();

        ProtectedHookData memory protectedData = abi.decode(hookData, (ProtectedHookData));
        uint256 exactAmountIn = uint256(-params.amountSpecified);
        if (protectedData.amountIn != exactAmountIn) {
            revert InvalidProtectedAmount(protectedData.amountIn, exactAmountIn);
        }

        Currency inputCurrency = params.zeroForOne ? key.currency0 : key.currency1;
        Currency outputCurrency = params.zeroForOne ? key.currency1 : key.currency0;
        address inputToken = Currency.unwrap(inputCurrency);
        address outputToken = Currency.unwrap(outputCurrency);
        if (inputToken == address(0) || outputToken == address(0)) revert NativeCurrencyUnsupported();

        int128 outputDelta = params.zeroForOne ? delta.amount1() : delta.amount0();
        if (outputDelta <= 0) revert NoOutputToEscrow();

        uint256 outputAmount = uint256(uint128(outputDelta));
        poolManager.take(outputCurrency, address(vault), outputAmount);
        vault.recordEscrow(
            IAegisEscrowVault.EscrowInput({
                tradeId: protectedData.tradeId,
                user: protectedData.user,
                inputToken: inputToken,
                inputAmount: exactAmountIn,
                outputToken: outputToken,
                outputAmount: outputAmount,
                settlementRecipient: protectedData.settlementRecipient,
                expectedOutput: protectedData.expectedOutput
            })
        );

        return (BaseHook.afterSwap.selector, outputDelta);
    }
}
