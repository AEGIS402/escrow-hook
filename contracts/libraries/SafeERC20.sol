// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "../interfaces/IERC20.sol";

library SafeERC20 {
    error ERC20CallFailed(address token);

    function safeTransfer(address token, address to, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
    }

    function safeApprove(address token, address spender, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20.approve, (spender, amount)));
    }

    function _call(address token, bytes memory data) private {
        (bool success, bytes memory returndata) = token.call(data);
        if (!success || (returndata.length != 0 && !abi.decode(returndata, (bool)))) {
            revert ERC20CallFailed(token);
        }
    }
}
