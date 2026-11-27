// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice What LicenceManager needs to know about a pilot's logged hours.
interface IFlightLog {
    /// @notice Running totals of counted minutes, updated whenever a flight starts to count.
    /// @dev Six uint32 values = 24 bytes, one storage slot.
    struct Totals {
        uint32 total;
        uint32 dual;
        uint32 solo;
        uint32 crossCountry;
        uint32 night;
        uint32 verified; // minutes confirmed by ADS-B data
    }

    function totalsOf(address student) external view returns (Totals memory);

    function instructorsOf(address student) external view returns (address[] memory);

    function minutesWith(address student, address instructor) external view returns (uint32);
}
