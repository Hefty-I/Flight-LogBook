// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title AccessBase
/// @notice Root of every FlightProof contract. Holds the global roles, the emergency
///         pause switch and the shared errors, so no contract re-implements them.
/// @dev Reused third-party code: OpenZeppelin AccessControl and Pausable (MIT).
abstract contract AccessBase is AccessControl, Pausable {
    /// @notice Can pause and unpause in an emergency. A multisig in production.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    error ZeroAddress();
    error SystemPaused();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @dev Overridden in AuthorityScoped so one switch can stop the whole system.
    function _systemPaused() internal view virtual returns (bool) {
        return paused();
    }

    modifier whenSystemActive() {
        if (_systemPaused()) revert SystemPaused();
        _;
    }
}
