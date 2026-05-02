// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IAegisEscrowVault {
    struct EscrowInput {
        bytes32 tradeId;
        address user;
        address inputToken;
        uint256 inputAmount;
        address outputToken;
        uint256 outputAmount;
        address settlementRecipient;
        uint256 expectedOutput;
    }

    function recordEscrow(EscrowInput calldata escrowInput) external;
}
