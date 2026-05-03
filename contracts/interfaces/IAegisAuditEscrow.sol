// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IAegisAuditEscrow {
    enum AuditAction {
        RELEASE,
        BLOCK_AND_CLAIM,
        RECOVER_TO_RESERVE,
        CUSTOM
    }

    enum EscrowStatus {
        None,
        Pending,
        Resolved
    }

    struct AuditDecision {
        bytes32 escrowId;
        AuditAction action;
        bytes32 reason;
        bytes32 evidenceHash;
        bytes actionData;
    }

    event EscrowRegistered(
        bytes32 indexed escrowId,
        address indexed subject,
        address indexed beneficiary,
        bytes32 policyHash
    );
    event AuditDecisionExecuted(
        bytes32 indexed escrowId,
        AuditAction indexed action,
        bytes32 indexed reason,
        bytes32 evidenceHash,
        address auditAgent
    );
    event AuditAgentSet(address indexed auditAgent);

    function auditAgent() external view returns (address);

    function escrowStatus(bytes32 escrowId) external view returns (EscrowStatus);

    function executeAuditDecision(AuditDecision calldata decision) external returns (bytes4);
}
