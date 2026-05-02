// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IAegisInsurancePool} from "./interfaces/IAegisInsurancePool.sol";
import {IPoolSwapTest} from "./interfaces/IPoolSwapTest.sol";
import {SafeERC20} from "./libraries/SafeERC20.sol";

contract AegisProtectedSwapAdapter {
    using SafeERC20 for address;

    uint256 public constant PROTECTION_FEE_BPS = 35;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    IPoolSwapTest public immutable poolSwapTest;
    IAegisInsurancePool public immutable insurancePool;

    struct ProtectedSwapRequest {
        PoolKey key;
        bool zeroForOne;
        uint128 amountIn;
        uint256 expectedOutput;
        uint160 sqrtPriceLimitX96;
        bytes32 tradeId;
        address settlementRecipient;
    }

    struct ProtectedHookData {
        bytes32 tradeId;
        address user;
        address settlementRecipient;
        uint256 amountIn;
        uint256 expectedOutput;
    }

    event ProtectedSwapSubmitted(
        bytes32 indexed tradeId,
        address indexed user,
        address indexed settlementRecipient,
        address inputToken,
        uint256 amountIn,
        uint256 protectionFee
    );

    error NativeCurrencyUnsupported();
    error ZeroAddress();
    error ZeroAmount();

    constructor(IPoolSwapTest officialPoolSwapTest, IAegisInsurancePool aegisInsurancePool) {
        if (address(officialPoolSwapTest) == address(0) || address(aegisInsurancePool) == address(0)) {
            revert ZeroAddress();
        }

        poolSwapTest = officialPoolSwapTest;
        insurancePool = aegisInsurancePool;
    }

    function protectionFee(uint256 amountIn) public pure returns (uint256) {
        return (amountIn * PROTECTION_FEE_BPS) / BPS_DENOMINATOR;
    }

    function protectedExactInputSingle(ProtectedSwapRequest calldata request) external returns (BalanceDelta delta) {
        if (request.amountIn == 0) revert ZeroAmount();
        if (request.settlementRecipient == address(0)) revert ZeroAddress();

        Currency inputCurrency = request.zeroForOne ? request.key.currency0 : request.key.currency1;
        address inputToken = Currency.unwrap(inputCurrency);
        if (inputToken == address(0)) revert NativeCurrencyUnsupported();

        uint256 feeAmount = protectionFee(request.amountIn);
        inputToken.safeTransferFrom(msg.sender, address(this), uint256(request.amountIn) + feeAmount);

        if (feeAmount > 0) {
            inputToken.safeTransfer(address(insurancePool), feeAmount);
            insurancePool.recordProtectionFee(inputToken, msg.sender, feeAmount, request.tradeId);
        }

        inputToken.safeApprove(address(poolSwapTest), 0);
        inputToken.safeApprove(address(poolSwapTest), request.amountIn);

        bytes memory hookData = abi.encode(
            ProtectedHookData({
                tradeId: request.tradeId,
                user: msg.sender,
                settlementRecipient: request.settlementRecipient,
                amountIn: request.amountIn,
                expectedOutput: request.expectedOutput
            })
        );

        delta = poolSwapTest.swap(
            request.key,
            SwapParams({
                zeroForOne: request.zeroForOne,
                amountSpecified: -int256(uint256(request.amountIn)),
                sqrtPriceLimitX96: request.sqrtPriceLimitX96
            }),
            IPoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );

        emit ProtectedSwapSubmitted(
            request.tradeId,
            msg.sender,
            request.settlementRecipient,
            inputToken,
            request.amountIn,
            feeAmount
        );
    }
}
