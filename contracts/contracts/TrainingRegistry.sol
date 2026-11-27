// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AuthorityScoped} from "./base/AuthorityScoped.sol";
import {ITrainingRegistry} from "./interfaces/ITrainingRegistry.sol";

/// @title TrainingRegistry
/// @notice Flight schools, instructors, students and aircraft, each belonging to one authority.
/// @dev Separation of duties:
///      - the authority registers schools and instructors and can revoke instructors;
///      - the school registers its students and aircraft.
///      A corrupt school therefore cannot invent its own instructors.
///      One wallet holds one role only, so nobody can sign their own flights.
contract TrainingRegistry is AuthorityScoped {
    struct School {
        address admin; // 20 bytes
        uint32 authorityId; // 4 bytes
        bool active; //  1 byte  -> one slot
    }

    struct Instructor {
        uint32 schoolId;
        ITrainingRegistry.InstructorStatus status;
        uint40 statusChangedAt;
    }

    uint32 public schoolCount;
    uint32 public aircraftCount;

    mapping(uint32 => School) private _schools;
    mapping(address => uint32) public schoolAdminOf;
    mapping(uint32 => ITrainingRegistry.Aircraft) private _aircraft;
    mapping(bytes3 => uint32) public aircraftByIcao24;
    mapping(address => Instructor) private _instructors;
    mapping(address => uint32) private _studentSchool;

    event SchoolRegistered(uint32 indexed schoolId, uint32 indexed authorityId, address indexed admin);
    event SchoolStatusChanged(uint32 indexed schoolId, bool active);
    event AircraftRegistered(
        uint32 indexed aircraftId,
        uint32 indexed schoolId,
        bytes3 icao24,
        bytes8 registration,
        bool adsbEquipped
    );
    event AircraftStatusChanged(uint32 indexed aircraftId, bool active);
    event InstructorRegistered(address indexed instructor, uint32 indexed schoolId);
    event InstructorRevoked(address indexed instructor, uint32 indexed schoolId, uint32 indexed authorityId);
    event StudentRegistered(address indexed student, uint32 indexed schoolId);

    error UnknownSchool(uint32 schoolId);
    error SchoolInactive(uint32 schoolId);
    error NotSchoolAdmin(address caller);
    error AddressAlreadyRegistered(address account);
    error InvalidIcao24();
    error Icao24AlreadyRegistered(bytes3 icao24);
    error UnknownAircraft(uint32 aircraftId);
    error UnknownInstructor(address instructor);
    error InstructorAlreadyRevoked(address instructor);

    constructor(address admin, address authorityRegistry) AuthorityScoped(admin, authorityRegistry) {}

    // ───────────────────────── Authority actions ─────────────────────────

    function registerSchool(
        uint32 authorityId,
        address schoolAdmin
    ) external whenSystemActive onlyAuthorityAdmin(authorityId) returns (uint32 schoolId) {
        _requireFreshAddress(schoolAdmin);
        schoolId = ++schoolCount;
        _schools[schoolId] = School({admin: schoolAdmin, authorityId: authorityId, active: true});
        schoolAdminOf[schoolAdmin] = schoolId;
        emit SchoolRegistered(schoolId, authorityId, schoolAdmin);
    }

    function setSchoolActive(uint32 schoolId, bool active) external whenSystemActive {
        School storage s = _requireSchool(schoolId);
        _checkAuthorityAdmin(s.authorityId);
        s.active = active;
        emit SchoolStatusChanged(schoolId, active);
    }

    /// @notice Instructors hold an authority-issued rating, so the authority registers them.
    function registerInstructor(uint32 schoolId, address instructor) external whenSystemActive {
        School storage s = _requireSchool(schoolId);
        _checkAuthorityAdmin(s.authorityId);
        if (!s.active) revert SchoolInactive(schoolId);
        _requireFreshAddress(instructor);
        _instructors[instructor] = Instructor({
            schoolId: schoolId,
            status: ITrainingRegistry.InstructorStatus.Active,
            statusChangedAt: uint40(block.timestamp)
        });
        emit InstructorRegistered(instructor, schoolId);
    }

    /// @notice Revoking an instructor puts every flight they signed "under review"
    ///         (LicenceManager checks this lazily, so no loop over flights is needed here).
    function revokeInstructor(address instructor) external whenSystemActive {
        Instructor storage i = _instructors[instructor];
        if (i.status == ITrainingRegistry.InstructorStatus.None) revert UnknownInstructor(instructor);
        uint32 authorityId = _schools[i.schoolId].authorityId;
        _checkAuthorityAdmin(authorityId);
        if (i.status == ITrainingRegistry.InstructorStatus.Revoked) revert InstructorAlreadyRevoked(instructor);
        i.status = ITrainingRegistry.InstructorStatus.Revoked;
        i.statusChangedAt = uint40(block.timestamp);
        emit InstructorRevoked(instructor, i.schoolId, authorityId);
    }

    // ───────────────────────── School actions ─────────────────────────

    function registerStudent(address student) external whenSystemActive {
        uint32 schoolId = _requireActiveSchoolAdmin();
        _requireFreshAddress(student);
        _studentSchool[student] = schoolId;
        emit StudentRegistered(student, schoolId);
    }

    function registerAircraft(
        bytes3 icao24,
        bytes8 registration,
        bool adsbEquipped
    ) external whenSystemActive returns (uint32 aircraftId) {
        uint32 schoolId = _requireActiveSchoolAdmin();
        if (icao24 == bytes3(0)) revert InvalidIcao24();
        if (aircraftByIcao24[icao24] != 0) revert Icao24AlreadyRegistered(icao24);

        aircraftId = ++aircraftCount;
        _aircraft[aircraftId] = ITrainingRegistry.Aircraft({
            icao24: icao24,
            schoolId: schoolId,
            active: true,
            adsbEquipped: adsbEquipped,
            registration: registration
        });
        aircraftByIcao24[icao24] = aircraftId;
        emit AircraftRegistered(aircraftId, schoolId, icao24, registration, adsbEquipped);
    }

    function setAircraftActive(uint32 aircraftId, bool active) external whenSystemActive {
        ITrainingRegistry.Aircraft storage a = _aircraft[aircraftId];
        if (a.schoolId == 0) revert UnknownAircraft(aircraftId);
        if (schoolAdminOf[msg.sender] != a.schoolId) revert NotSchoolAdmin(msg.sender);
        a.active = active;
        emit AircraftStatusChanged(aircraftId, active);
    }

    // ───────────────────────── Views (ITrainingRegistry) ─────────────────────────

    function schoolAuthority(uint32 schoolId) external view returns (uint32) {
        return _schools[schoolId].authorityId;
    }

    function isSchoolActive(uint32 schoolId) external view returns (bool) {
        return _schools[schoolId].active;
    }

    function getSchool(uint32 schoolId) external view returns (School memory) {
        return _schools[schoolId];
    }

    function studentSchool(address student) external view returns (uint32) {
        return _studentSchool[student];
    }

    function instructorSchool(address instructor) external view returns (uint32) {
        return _instructors[instructor].schoolId;
    }

    function instructorStatus(address instructor) external view returns (ITrainingRegistry.InstructorStatus) {
        return _instructors[instructor].status;
    }

    function getInstructor(address instructor) external view returns (Instructor memory) {
        return _instructors[instructor];
    }

    function aircraftInfo(uint32 aircraftId) external view returns (ITrainingRegistry.Aircraft memory) {
        return _aircraft[aircraftId];
    }

    // ───────────────────────── Internals ─────────────────────────

    function _requireSchool(uint32 schoolId) private view returns (School storage s) {
        s = _schools[schoolId];
        if (s.admin == address(0)) revert UnknownSchool(schoolId);
    }

    function _requireActiveSchoolAdmin() private view returns (uint32 schoolId) {
        schoolId = schoolAdminOf[msg.sender];
        if (schoolId == 0) revert NotSchoolAdmin(msg.sender);
        if (!_schools[schoolId].active) revert SchoolInactive(schoolId);
        uint32 authorityId = _schools[schoolId].authorityId;
        if (!authorities.isActive(authorityId)) revert AuthorityInactive(authorityId);
    }

    /// @dev One wallet, one role: an address may not be an authority admin, school admin,
    ///      instructor and student at the same time.
    function _requireFreshAddress(address account) private view {
        if (account == address(0)) revert ZeroAddress();
        if (
            schoolAdminOf[account] != 0 ||
            _instructors[account].status != ITrainingRegistry.InstructorStatus.None ||
            _studentSchool[account] != 0 ||
            authorities.adminOf(account) != 0
        ) revert AddressAlreadyRegistered(account);
    }
}
