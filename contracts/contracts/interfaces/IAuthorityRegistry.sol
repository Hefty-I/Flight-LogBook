// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice What the other FlightProof contracts need to know about aviation authorities.
interface IAuthorityRegistry {
    /// @notice Licence rules of one authority. All durations are in minutes.
    /// @dev Packed into a single 32-byte storage slot (4 x uint32 + uint16 = 18 bytes).
    struct RuleSet {
        uint32 minTotalMinutes;
        uint32 minDualMinutes;
        uint32 minSoloMinutes;
        uint32 minCrossCountryMinutes;
        // Share of counted minutes that must be ADS-B verified, in basis points (6000 = 60%).
        uint16 minVerifiedBps;
    }

    function isActiveAdmin(uint32 authorityId, address account) external view returns (bool);

    function isActive(uint32 authorityId) external view returns (bool);

    function adminOf(address account) external view returns (uint32);

    function rulesOf(uint32 authorityId) external view returns (RuleSet memory);

    function paused() external view returns (bool);
}
