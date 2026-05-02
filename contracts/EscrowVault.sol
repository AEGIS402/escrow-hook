// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAegisEscrowVault} from "./interfaces/IAegisEscrowVault.sol";
import {IAegisInsurancePool} from "./interfaces/IAegisInsurancePool.sol";
import {SafeERC20} from "./libraries/SafeERC20.sol";

contract EscrowVault is IAegisEscrowVault {
    using SafeERC20 for address;

    enum State {
        None,
        Pending,
        Released,
        ClaimPaid
    }

    struct Escrow {
        State state;
        address user;
        address inputToken;
        uint256 inputAmount;
        address outputToken;
        uint256 outputAmount;
        address settlementRecipient;
        uint256 expectedOutput;
    }

    address public owner;
    address public auditor;
    address public hook;
    IAegisInsurancePool public insurancePool;

    mapping(bytes32 tradeId => Escrow escrow) public escrows;

    event HookSet(address indexed hook);
    event AuditorSet(address indexed auditor);
    event ProtectedSwapEscrowed(
        bytes32 indexed tradeId,
        address indexed user,
        address indexed settlementRecipient,
        address inputToken,
        uint256 inputAmount,
        address outputToken,
        uint256 outputAmount,
        uint256 expectedOutput
    );
    event EscrowReleased(
        bytes32 indexed tradeId,
        address indexed outputToken,
        address indexed settlementRecipient,
        uint256 outputAmount
    );
    event EscrowRecovered(bytes32 indexed tradeId, address indexed outputToken, uint256 outputAmount, bytes32 reason);

    error NotOwner();
    error NotHook();
    error NotAuditor();
    error ZeroAddress();
    error DuplicateTrade(bytes32 tradeId);
    error InvalidEscrowState(bytes32 tradeId, State state);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyHook() {
        if (msg.sender != hook) revert NotHook();
        _;
    }

    modifier onlyAuditor() {
        if (msg.sender != auditor) revert NotAuditor();
        _;
    }

    constructor(address initialOwner, address initialAuditor, IAegisInsurancePool initialInsurancePool) {
        if (initialOwner == address(0) || initialAuditor == address(0) || address(initialInsurancePool) == address(0)) {
            revert ZeroAddress();
        }

        owner = initialOwner;
        auditor = initialAuditor;
        insurancePool = initialInsurancePool;
    }

    function setHook(address newHook) external onlyOwner {
        if (newHook == address(0)) revert ZeroAddress();
        hook = newHook;
        emit HookSet(newHook);
    }

    function setAuditor(address newAuditor) external onlyOwner {
        if (newAuditor == address(0)) revert ZeroAddress();
        auditor = newAuditor;
        emit AuditorSet(newAuditor);
    }

    function recordEscrow(EscrowInput calldata escrowInput) external onlyHook {
        if (escrows[escrowInput.tradeId].state != State.None) revert DuplicateTrade(escrowInput.tradeId);
        if (
            escrowInput.user == address(0) || escrowInput.inputToken == address(0)
                || escrowInput.outputToken == address(0) || escrowInput.settlementRecipient == address(0)
        ) {
            revert ZeroAddress();
        }

        escrows[escrowInput.tradeId] = Escrow({
            state: State.Pending,
            user: escrowInput.user,
            inputToken: escrowInput.inputToken,
            inputAmount: escrowInput.inputAmount,
            outputToken: escrowInput.outputToken,
            outputAmount: escrowInput.outputAmount,
            settlementRecipient: escrowInput.settlementRecipient,
            expectedOutput: escrowInput.expectedOutput
        });

        emit ProtectedSwapEscrowed(
            escrowInput.tradeId,
            escrowInput.user,
            escrowInput.settlementRecipient,
            escrowInput.inputToken,
            escrowInput.inputAmount,
            escrowInput.outputToken,
            escrowInput.outputAmount,
            escrowInput.expectedOutput
        );
    }

    function release(bytes32 tradeId) external onlyAuditor {
        Escrow storage escrow = escrows[tradeId];
        if (escrow.state != State.Pending) revert InvalidEscrowState(tradeId, escrow.state);

        escrow.state = State.Released;
        escrow.outputToken.safeTransfer(escrow.settlementRecipient, escrow.outputAmount);

        emit EscrowReleased(tradeId, escrow.outputToken, escrow.settlementRecipient, escrow.outputAmount);
    }

    function payClaim(bytes32 tradeId, bytes32 reason) external onlyAuditor {
        Escrow storage escrow = escrows[tradeId];
        if (escrow.state != State.Pending) revert InvalidEscrowState(tradeId, escrow.state);

        escrow.state = State.ClaimPaid;
        escrow.outputToken.safeTransfer(address(insurancePool), escrow.outputAmount);
        insurancePool.notifyRecovery(escrow.outputToken, escrow.outputAmount, tradeId);
        insurancePool.payClaim(escrow.inputToken, escrow.user, escrow.inputAmount, tradeId, reason);

        emit EscrowRecovered(tradeId, escrow.outputToken, escrow.outputAmount, reason);
    }
}
