// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IAegisInsurancePool {
    function recordProtectionFee(address token, address payer, uint256 amount, bytes32 tradeId) external;
    function payClaim(address token, address user, uint256 amount, bytes32 tradeId, bytes32 reason) external;
    function notifyRecovery(address token, uint256 amount, bytes32 tradeId) external;
}
