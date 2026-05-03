// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAegisAuditEscrow} from "./interfaces/IAegisAuditEscrow.sol";

abstract contract AegisAuditEscrowBase is IAegisAuditEscrow {
    address public owner;
    address public override auditAgent;

    mapping(bytes32 escrowId => EscrowStatus status) private _escrowStatuses;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotAuditAgent();
    error ZeroAddress();
    error InvalidEscrowId();
    error DuplicateEscrow(bytes32 escrowId);
    error UnknownEscrow(bytes32 escrowId);
    error InvalidEscrowStatus(bytes32 escrowId, EscrowStatus status);
    error UnsupportedAuditAction(AuditAction action);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAuditAgent() {
        if (msg.sender != auditAgent) revert NotAuditAgent();
        _;
    }

    constructor(address initialOwner, address initialAuditAgent) {
        if (initialOwner == address(0) || initialAuditAgent == address(0)) revert ZeroAddress();
        owner = initialOwner;
        auditAgent = initialAuditAgent;
        emit OwnershipTransferred(address(0), initialOwner);
        emit AuditAgentSet(initialAuditAgent);
    }

    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setAuditAgent(address newAuditAgent) public virtual onlyOwner {
        _setAuditAgent(newAuditAgent);
    }

    function escrowStatus(bytes32 escrowId) public view override returns (EscrowStatus) {
        return _escrowStatuses[escrowId];
    }

    function executeAuditDecision(AuditDecision calldata decision) external override onlyAuditAgent returns (bytes4) {
        _executeAuditDecision(decision);
        return IAegisAuditEscrow.executeAuditDecision.selector;
    }

    function _setAuditAgent(address newAuditAgent) internal {
        if (newAuditAgent == address(0)) revert ZeroAddress();
        auditAgent = newAuditAgent;
        emit AuditAgentSet(newAuditAgent);
    }

    function _registerEscrow(
        bytes32 escrowId,
        address subject,
        address beneficiary,
        bytes32 policyHash
    ) internal {
        if (escrowId == bytes32(0)) revert InvalidEscrowId();
        if (_escrowStatuses[escrowId] != EscrowStatus.None) revert DuplicateEscrow(escrowId);

        _escrowStatuses[escrowId] = EscrowStatus.Pending;
        emit EscrowRegistered(escrowId, subject, beneficiary, policyHash);
    }

    function _executeAuditDecision(AuditDecision memory decision) internal {
        EscrowStatus status = _escrowStatuses[decision.escrowId];
        if (status == EscrowStatus.None) revert UnknownEscrow(decision.escrowId);
        if (status != EscrowStatus.Pending) revert InvalidEscrowStatus(decision.escrowId, status);

        _escrowStatuses[decision.escrowId] = EscrowStatus.Resolved;
        _executeAuditAction(decision);

        emit AuditDecisionExecuted(
            decision.escrowId,
            decision.action,
            decision.reason,
            decision.evidenceHash,
            msg.sender
        );
    }

    function _executeAuditAction(AuditDecision memory decision) internal virtual;
}
