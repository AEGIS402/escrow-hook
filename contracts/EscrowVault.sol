// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AegisAuditEscrowBase} from "./AegisAuditEscrowBase.sol";
import {IAegisEscrowVault} from "./interfaces/IAegisEscrowVault.sol";
import {IAegisInsurancePool} from "./interfaces/IAegisInsurancePool.sol";
import {SafeERC20} from "./libraries/SafeERC20.sol";

contract EscrowVault is IAegisEscrowVault, AegisAuditEscrowBase {
    using SafeERC20 for address;

    enum State {
        None,
        Pending,
        Released,
        ClaimPaid,
        Recovered
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

    error NotHook();
    error DuplicateTrade(bytes32 tradeId);
    error InvalidEscrowState(bytes32 tradeId, State state);

    modifier onlyHook() {
        if (msg.sender != hook) revert NotHook();
        _;
    }

    constructor(address initialOwner, address initialAuditor, IAegisInsurancePool initialInsurancePool)
        AegisAuditEscrowBase(initialOwner, initialAuditor)
    {
        if (address(initialInsurancePool) == address(0)) revert ZeroAddress();
        insurancePool = initialInsurancePool;
    }

    function setHook(address newHook) external onlyOwner {
        if (newHook == address(0)) revert ZeroAddress();
        hook = newHook;
        emit HookSet(newHook);
    }

    function setAuditor(address newAuditor) external onlyOwner {
        _setAuditAgent(newAuditor);
        emit AuditorSet(newAuditor);
    }

    function auditor() external view returns (address) {
        return auditAgent;
    }

    function recordEscrow(EscrowInput calldata escrowInput) external onlyHook {
        if (escrows[escrowInput.tradeId].state != State.None) revert DuplicateTrade(escrowInput.tradeId);
        if (
            escrowInput.user == address(0) || escrowInput.inputToken == address(0)
                || escrowInput.outputToken == address(0) || escrowInput.settlementRecipient == address(0)
        ) {
            revert ZeroAddress();
        }

        _registerEscrow(
            escrowInput.tradeId,
            escrowInput.user,
            escrowInput.settlementRecipient,
            _protectedSwapPolicyHash(escrowInput)
        );

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

    function release(bytes32 tradeId) external onlyAuditAgent {
        _executeAuditDecision(
            AuditDecision({
                escrowId: tradeId,
                action: AuditAction.RELEASE,
                reason: bytes32(0),
                evidenceHash: bytes32(0),
                actionData: new bytes(0)
            })
        );
    }

    function payClaim(bytes32 tradeId, bytes32 reason) external onlyAuditAgent {
        _executeAuditDecision(
            AuditDecision({
                escrowId: tradeId,
                action: AuditAction.BLOCK_AND_CLAIM,
                reason: reason,
                evidenceHash: bytes32(0),
                actionData: new bytes(0)
            })
        );
    }

    function _executeAuditAction(AuditDecision memory decision) internal override {
        if (decision.action == AuditAction.RELEASE) {
            _releaseEscrow(decision.escrowId);
        } else if (decision.action == AuditAction.BLOCK_AND_CLAIM) {
            _payClaimEscrow(decision.escrowId, decision.reason);
        } else if (decision.action == AuditAction.RECOVER_TO_RESERVE) {
            _recoverEscrowToReserve(decision.escrowId, decision.reason);
        } else {
            revert UnsupportedAuditAction(decision.action);
        }
    }

    function _releaseEscrow(bytes32 tradeId) internal {
        Escrow storage escrow = escrows[tradeId];
        if (escrow.state != State.Pending) revert InvalidEscrowState(tradeId, escrow.state);

        escrow.state = State.Released;
        escrow.outputToken.safeTransfer(escrow.settlementRecipient, escrow.outputAmount);

        emit EscrowReleased(tradeId, escrow.outputToken, escrow.settlementRecipient, escrow.outputAmount);
    }

    function _payClaimEscrow(bytes32 tradeId, bytes32 reason) internal {
        Escrow storage escrow = escrows[tradeId];
        if (escrow.state != State.Pending) revert InvalidEscrowState(tradeId, escrow.state);

        escrow.state = State.ClaimPaid;
        escrow.outputToken.safeTransfer(address(insurancePool), escrow.outputAmount);
        insurancePool.notifyRecovery(escrow.outputToken, escrow.outputAmount, tradeId);
        insurancePool.payClaim(escrow.inputToken, escrow.user, escrow.inputAmount, tradeId, reason);

        emit EscrowRecovered(tradeId, escrow.outputToken, escrow.outputAmount, reason);
    }

    function _recoverEscrowToReserve(bytes32 tradeId, bytes32 reason) internal {
        Escrow storage escrow = escrows[tradeId];
        if (escrow.state != State.Pending) revert InvalidEscrowState(tradeId, escrow.state);

        escrow.state = State.Recovered;
        escrow.outputToken.safeTransfer(address(insurancePool), escrow.outputAmount);
        insurancePool.notifyRecovery(escrow.outputToken, escrow.outputAmount, tradeId);

        emit EscrowRecovered(tradeId, escrow.outputToken, escrow.outputAmount, reason);
    }

    function _protectedSwapPolicyHash(EscrowInput calldata escrowInput) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                "AEGIS_INSURED_SWAP_ESCROW_V1",
                escrowInput.tradeId,
                escrowInput.user,
                escrowInput.inputToken,
                escrowInput.inputAmount,
                escrowInput.outputToken,
                escrowInput.outputAmount,
                escrowInput.settlementRecipient,
                escrowInput.expectedOutput
            )
        );
    }
}
