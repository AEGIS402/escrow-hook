// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "./interfaces/IERC20.sol";
import {SafeERC20} from "./libraries/SafeERC20.sol";

contract InsurancePool {
    using SafeERC20 for address;

    address public owner;
    address public vault;
    address public feeReporter;

    event VaultSet(address indexed vault);
    event FeeReporterSet(address indexed feeReporter);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ReserveFunded(address indexed token, address indexed funder, uint256 amount);
    event ProtectionFeePaid(bytes32 indexed tradeId, address indexed token, address indexed payer, uint256 amount);
    event AuditFailedClaimPaid(
        bytes32 indexed tradeId,
        address indexed token,
        address indexed user,
        uint256 amount,
        bytes32 reason
    );
    event RecoveryReceived(bytes32 indexed tradeId, address indexed token, uint256 amount);
    event ReserveWithdrawn(address indexed token, address indexed recipient, uint256 amount);

    error NotOwner();
    error NotVault();
    error NotFeeReporter();
    error ZeroAddress();
    error InsufficientReserve(address token, uint256 requested, uint256 available);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    modifier onlyFeeReporter() {
        if (msg.sender != feeReporter) revert NotFeeReporter();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
    }

    function setVault(address newVault) external onlyOwner {
        if (newVault == address(0)) revert ZeroAddress();
        vault = newVault;
        emit VaultSet(newVault);
    }

    function setFeeReporter(address newFeeReporter) external onlyOwner {
        if (newFeeReporter == address(0)) revert ZeroAddress();
        feeReporter = newFeeReporter;
        emit FeeReporterSet(newFeeReporter);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function fund(address token, uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit ReserveFunded(token, msg.sender, amount);
    }

    function recordProtectionFee(address token, address payer, uint256 amount, bytes32 tradeId) external onlyFeeReporter {
        if (IERC20(token).balanceOf(address(this)) < amount) revert InsufficientReserve(token, amount, 0);
        emit ProtectionFeePaid(tradeId, token, payer, amount);
    }

    function payClaim(address token, address user, uint256 amount, bytes32 tradeId, bytes32 reason) external onlyVault {
        uint256 available = IERC20(token).balanceOf(address(this));
        if (available < amount) revert InsufficientReserve(token, amount, available);

        token.safeTransfer(user, amount);
        emit AuditFailedClaimPaid(tradeId, token, user, amount, reason);
    }

    function notifyRecovery(address token, uint256 amount, bytes32 tradeId) external onlyVault {
        emit RecoveryReceived(tradeId, token, amount);
    }

    function withdraw(address token, address recipient, uint256 amount) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        token.safeTransfer(recipient, amount);
        emit ReserveWithdrawn(token, recipient, amount);
    }
}
