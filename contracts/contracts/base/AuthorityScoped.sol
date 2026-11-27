// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessBase} from "./AccessBase.sol";
import {IAuthorityRegistry} from "../interfaces/IAuthorityRegistry.sol";

/// @title AuthorityScoped
/// @notice Second layer of the inheritance chain. Adds the link to the AuthorityRegistry,
///         the "only this country's regulator" check, and a system-wide pause:
///         pausing the AuthorityRegistry stops every contract that inherits from this one.
abstract contract AuthorityScoped is AccessBase {
    IAuthorityRegistry public immutable authorities;

    error NotAuthorityAdmin(uint32 authorityId, address caller);
    error AuthorityInactive(uint32 authorityId);

    constructor(address admin, address authorityRegistry) AccessBase(admin) {
        if (authorityRegistry == address(0)) revert ZeroAddress();
        authorities = IAuthorityRegistry(authorityRegistry);
    }

    function _systemPaused() internal view override returns (bool) {
        return paused() || authorities.paused();
    }

    function _checkAuthorityAdmin(uint32 authorityId) internal view {
        if (!authorities.isActiveAdmin(authorityId, msg.sender)) {
            revert NotAuthorityAdmin(authorityId, msg.sender);
        }
    }

    modifier onlyAuthorityAdmin(uint32 authorityId) {
        _checkAuthorityAdmin(authorityId);
        _;
    }
}
