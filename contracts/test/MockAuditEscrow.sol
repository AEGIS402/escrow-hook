// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AegisAuditEscrowBase} from "../AegisAuditEscrowBase.sol";

contract MockAuditEscrow is AegisAuditEscrowBase {
    event MockAuditAction(
        bytes32 indexed escrowId,
        AuditAction indexed action,
        bytes32 indexed reason,
        bytes32 evidenceHash,
        bytes actionData
    );

    constructor(address initialOwner, address initialAuditAgent)
        AegisAuditEscrowBase(initialOwner, initialAuditAgent)
    {}

    function register(bytes32 escrowId, address subject, address beneficiary, bytes32 policyHash) external {
        _registerEscrow(escrowId, subject, beneficiary, policyHash);
    }

    function _executeAuditAction(AuditDecision memory decision) internal override {
        emit MockAuditAction(
            decision.escrowId,
            decision.action,
            decision.reason,
            decision.evidenceHash,
            decision.actionData
        );
    }
}
