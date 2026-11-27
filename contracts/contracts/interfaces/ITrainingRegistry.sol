// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice What FlightLog and LicenceManager need to know about schools, people and aircraft.
interface ITrainingRegistry {
    enum InstructorStatus {
        None,
        Active,
        Revoked
    }

    /// @dev icao24 is the aircraft's worldwide-unique 24-bit transponder address.
    ///      Packed into one slot: 3 + 4 + 1 + 1 + 8 = 17 bytes.
    struct Aircraft {
        bytes3 icao24;
        uint32 schoolId;
        bool active;
        bool adsbEquipped;
        bytes8 registration; // tail number, e.g. "N172SP" or "D-EABC"
    }

    function schoolAuthority(uint32 schoolId) external view returns (uint32);

    function isSchoolActive(uint32 schoolId) external view returns (bool);

    function studentSchool(address student) external view returns (uint32);

    function instructorSchool(address instructor) external view returns (uint32);

    function instructorStatus(address instructor) external view returns (InstructorStatus);

    function aircraftInfo(uint32 aircraftId) external view returns (Aircraft memory);
}
