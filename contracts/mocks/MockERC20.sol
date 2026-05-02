// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 allowance)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    error InsufficientBalance();
    error InsufficientAllowance();
    error ZeroAddress();

    constructor(string memory tokenName, string memory tokenSymbol, uint8 tokenDecimals) {
        name = tokenName;
        symbol = tokenSymbol;
        decimals = tokenDecimals;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance();
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }

        _transfer(from, to, amount);
        return true;
    }

    function mint(address to, uint256 amount) external {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert InsufficientBalance();

        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
