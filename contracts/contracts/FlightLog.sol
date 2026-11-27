// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AuthorityScoped} from "./base/AuthorityScoped.sol";
import {ITrainingRegistry} from "./interfaces/ITrainingRegistry.sol";
import {IFlightLog} from "./interfaces/IFlightLog.sol";

/// @title FlightLog
/// @notice The logbook. A student logs a flight, an instructor co-signs it, and the oracle
///         checks it against real ADS-B tracking data (OpenSky Network).
///
///   Logged ──sign──▶ Signed ──oracle──▶ Verified  (counts, ADS-B confirmed)
///                          │      └───▶ Attested  (counts, no ADS-B data: aircraft not equipped)
///                          │      └───▶ Mismatch ──dispute──▶ Disputed ──▶ Attested / Rejected
///                          └──oracle silent 14 days──▶ Attested (fail-safe)
///   Logged (unsigned 7 days), Mismatch (after 30 days), Rejected ──closeFlight──▶ Closed
///
/// @dev All time limits are measured from the departure time, so no extra timestamps are stored.
contract FlightLog is AuthorityScoped, IFlightLog {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    uint256 public constant MAX_LOG_DELAY = 3 days; // log within 3 days of landing
    uint256 public constant SIGN_WINDOW = 7 days; // co-sign within 7 days of departure
    uint256 public constant ORACLE_TIMEOUT = 14 days; // then the student may fall back to "Attested"
    uint256 public constant DISPUTE_DEADLINE = 30 days; // dispute a mismatch until then
    uint16 public constant MAX_DURATION_MINUTES = 720; // 12 hours
    uint256 public constant MAX_INSTRUCTORS_PER_STUDENT = 10; // bounds the review loop in LicenceManager

    uint8 public constant FLAG_SOLO = 1;
    uint8 public constant FLAG_CROSS_COUNTRY = 2;
    uint8 public constant FLAG_NIGHT = 4;
    uint8 private constant ALL_FLAGS = 7;

    // A day is split into 144 ten-minute slots, stored as bits of a single uint256.
    uint256 private constant SLOT_SECONDS = 600;
    uint256 private constant SLOTS_PER_DAY = 144;

    enum Status {
        None,
        Logged,
        Signed,
        Verified,
        Attested,
        Mismatch,
        Disputed,
        Rejected,
        Closed
    }

    enum OracleResult {
        Match,
        NoData,
        Mismatch
    }

    /// @dev Packed into three storage slots.
    struct Flight {
        // slot 1: 20 + 4 + 5 + 2 + 1 = 32 bytes
        address student;
        uint32 aircraftId;
        uint40 departureTime; // UTC, seconds
        uint16 durationMinutes;
        uint8 flags;
        // slot 2: 20 + 4 + 4 + 1 = 29 bytes
        address instructor;
        bytes4 departureAirport; // ICAO airport code, e.g. "EDDF"
        bytes4 arrivalAirport;
        Status status;
        // slot 3
        bytes32 evidenceHash; // keccak256 of the oracle's evidence file (stored on IPFS)
    }

    ITrainingRegistry public immutable registry;
    uint256 public flightCount;

    mapping(uint256 => Flight) private _flights;
    mapping(address => IFlightLog.Totals) private _totals;
    mapping(address => address[]) private _instructorsOf;
    mapping(address => mapping(address => bool)) private _linked;
    mapping(address => mapping(address => uint32)) private _minutesWith;
    // aircraftId => day number => bitmap of the 144 ten-minute slots of that day
    mapping(uint32 => mapping(uint256 => uint256)) private _aircraftDays;
    mapping(address => mapping(uint256 => uint256)) private _studentDays;

    event FlightLogged(
        uint256 indexed flightId,
        address indexed student,
        uint32 indexed aircraftId,
        uint40 departureTime,
        uint16 durationMinutes,
        uint8 flags,
        bytes4 departureAirport,
        bytes4 arrivalAirport
    );
    /// @notice Carries everything the oracle needs, so it never has to read storage.
    event FlightSigned(
        uint256 indexed flightId,
        address indexed instructor,
        address indexed student,
        bytes3 icao24,
        bool adsbEquipped,
        uint40 departureTime,
        uint16 durationMinutes,
        bytes4 departureAirport,
        bytes4 arrivalAirport
    );
    /// @notice evidenceURI (an IPFS link) lives only in the event log: cheaper than storage.
    event FlightVerified(
        uint256 indexed flightId,
        OracleResult result,
        Status newStatus,
        bytes32 evidenceHash,
        string evidenceURI
    );
    event FlightCounted(uint256 indexed flightId, address indexed student, uint16 durationMinutes, bool adsbVerified);
    event OracleTimeoutClaimed(uint256 indexed flightId);
    event DisputeOpened(uint256 indexed flightId, address indexed student, bytes32 reasonHash, string reasonURI);
    event DisputeResolved(uint256 indexed flightId, bool accepted, address indexed resolver);
    event FlightClosed(uint256 indexed flightId, Status previousStatus);

    error NotRegisteredStudent(address account);
    error SchoolInactive(uint32 schoolId);
    error AircraftUnavailable(uint32 aircraftId);
    error AircraftNotInSchool(uint32 aircraftId);
    error InvalidDuration(uint16 durationMinutes);
    error InvalidFlags(uint8 flags);
    error InvalidAirport();
    error CrossCountryNeedsDifferentAirports();
    error FlightNotFinished();
    error LoggedTooLate();
    error AircraftBusy(uint32 aircraftId);
    error StudentBusy(address student);
    error FlightNotFound(uint256 flightId);
    error WrongStatus(uint256 flightId, Status current);
    error NotFlightStudent(uint256 flightId);
    error InstructorNotActive(address instructor);
    error InstructorWrongSchool(address instructor, uint256 flightId);
    error SignWindowClosed(uint256 flightId);
    error TooManyInstructors(address student);
    error EmptyBatch();
    error MissingEvidence();
    error NoDataNotAllowedForTrackedAircraft(uint256 flightId);
    error OracleTimeoutNotReached(uint256 flightId);
    error DisputeWindowClosed(uint256 flightId);
    error NotClosable(uint256 flightId, Status current);

    constructor(
        address admin,
        address authorityRegistry,
        address trainingRegistry
    ) AuthorityScoped(admin, authorityRegistry) {
        if (trainingRegistry == address(0)) revert ZeroAddress();
        registry = ITrainingRegistry(trainingRegistry);
    }

    // ───────────────────────── Student: log a flight ─────────────────────────

    function logFlight(
        uint32 aircraftId,
        uint40 departureTime,
        uint16 durationMinutes,
        bytes4 departureAirport,
        bytes4 arrivalAirport,
        uint8 flags
    ) external whenSystemActive returns (uint256 flightId) {
        uint32 schoolId = registry.studentSchool(msg.sender);
        if (schoolId == 0) revert NotRegisteredStudent(msg.sender);
        _requireSchoolUsable(schoolId);

        ITrainingRegistry.Aircraft memory ac = registry.aircraftInfo(aircraftId);
        if (!ac.active) revert AircraftUnavailable(aircraftId);
        if (ac.schoolId != schoolId) revert AircraftNotInSchool(aircraftId);

        if (durationMinutes == 0 || durationMinutes > MAX_DURATION_MINUTES) revert InvalidDuration(durationMinutes);
        if (flags > ALL_FLAGS) revert InvalidFlags(flags);
        if (departureAirport == bytes4(0) || arrivalAirport == bytes4(0)) revert InvalidAirport();
        if (flags & FLAG_CROSS_COUNTRY != 0 && departureAirport == arrivalAirport) {
            revert CrossCountryNeedsDifferentAirports();
        }

        uint256 landing = uint256(departureTime) + uint256(durationMinutes) * 60;
        if (landing > block.timestamp) revert FlightNotFinished();
        if (block.timestamp - landing > MAX_LOG_DELAY) revert LoggedTooLate();

        // One aircraft cannot fly two flights at once, and neither can one student.
        if (!_occupy(_aircraftDays[aircraftId], departureTime, durationMinutes)) revert AircraftBusy(aircraftId);
        if (!_occupy(_studentDays[msg.sender], departureTime, durationMinutes)) revert StudentBusy(msg.sender);

        flightId = ++flightCount;
        Flight storage f = _flights[flightId];
        f.student = msg.sender;
        f.aircraftId = aircraftId;
        f.departureTime = departureTime;
        f.durationMinutes = durationMinutes;
        f.flags = flags;
        f.departureAirport = departureAirport;
        f.arrivalAirport = arrivalAirport;
        f.status = Status.Logged;

        emit FlightLogged(
            flightId,
            msg.sender,
            aircraftId,
            departureTime,
            durationMinutes,
            flags,
            departureAirport,
            arrivalAirport
        );
    }

    // ───────────────────────── Instructor: co-sign ─────────────────────────

    function signFlight(uint256 flightId) external whenSystemActive {
        uint32 schoolId = _requireActiveInstructor();
        _sign(flightId, schoolId);
    }

    /// @notice Gas optimization: sign many flights in one transaction.
    function signFlights(uint256[] calldata flightIds) external whenSystemActive {
        if (flightIds.length == 0) revert EmptyBatch();
        uint32 schoolId = _requireActiveInstructor();
        for (uint256 i = 0; i < flightIds.length; ++i) {
            _sign(flightIds[i], schoolId);
        }
    }

    // ───────────────────────── Oracle ─────────────────────────

    function submitVerification(
        uint256 flightId,
        OracleResult result,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external whenSystemActive onlyRole(ORACLE_ROLE) {
        Flight storage f = _requireFlight(flightId);
        if (f.status != Status.Signed) revert WrongStatus(flightId, f.status);
        if (evidenceHash == bytes32(0)) revert MissingEvidence();
        // A tracked aircraft that left no ADS-B trace is a mismatch, not "no data".
        // This stops a lazy or bribed oracle from waving fake flights through.
        if (result == OracleResult.NoData && registry.aircraftInfo(f.aircraftId).adsbEquipped) {
            revert NoDataNotAllowedForTrackedAircraft(flightId);
        }

        Status newStatus = result == OracleResult.Match
            ? Status.Verified
            : (result == OracleResult.NoData ? Status.Attested : Status.Mismatch);

        f.evidenceHash = evidenceHash;
        f.status = newStatus;
        emit FlightVerified(flightId, result, newStatus, evidenceHash, evidenceURI);

        if (newStatus != Status.Mismatch) _count(flightId, f);
    }

    /// @notice Fail-safe if the oracle is down: after 14 days the flight counts as
    ///         instructor-attested. Licence rules still require a minimum ADS-B-verified share.
    function claimOracleTimeout(uint256 flightId) external whenSystemActive {
        Flight storage f = _requireFlight(flightId);
        if (msg.sender != f.student) revert NotFlightStudent(flightId);
        if (f.status != Status.Signed) revert WrongStatus(flightId, f.status);
        if (block.timestamp <= uint256(f.departureTime) + ORACLE_TIMEOUT) revert OracleTimeoutNotReached(flightId);

        f.status = Status.Attested;
        emit OracleTimeoutClaimed(flightId);
        _count(flightId, f);
    }

    // ───────────────────────── Disputes ─────────────────────────

    function openDispute(
        uint256 flightId,
        bytes32 reasonHash,
        string calldata reasonURI
    ) external whenSystemActive {
        Flight storage f = _requireFlight(flightId);
        if (msg.sender != f.student) revert NotFlightStudent(flightId);
        if (f.status != Status.Mismatch) revert WrongStatus(flightId, f.status);
        if (block.timestamp > uint256(f.departureTime) + DISPUTE_DEADLINE) revert DisputeWindowClosed(flightId);
        if (reasonHash == bytes32(0)) revert MissingEvidence();

        f.status = Status.Disputed;
        emit DisputeOpened(flightId, msg.sender, reasonHash, reasonURI);
    }

    /// @notice Decided by the authority of the student's school (e.g. after checking radar data).
    function resolveDispute(uint256 flightId, bool accept) external whenSystemActive {
        Flight storage f = _requireFlight(flightId);
        if (f.status != Status.Disputed) revert WrongStatus(flightId, f.status);
        _checkAuthorityAdmin(registry.schoolAuthority(registry.studentSchool(f.student)));

        if (accept) {
            f.status = Status.Attested;
            emit DisputeResolved(flightId, true, msg.sender);
            _count(flightId, f);
        } else {
            f.status = Status.Rejected;
            emit DisputeResolved(flightId, false, msg.sender);
        }
    }

    /// @notice Anyone may close a dead flight. This frees its time slots, so a fake claim
    ///         cannot block the aircraft's real flight forever (griefing protection).
    function closeFlight(uint256 flightId) external whenSystemActive {
        Flight storage f = _requireFlight(flightId);
        Status s = f.status;
        uint256 dep = f.departureTime;
        bool closable = s == Status.Rejected ||
            (s == Status.Mismatch && block.timestamp > dep + DISPUTE_DEADLINE) ||
            (s == Status.Logged && block.timestamp > dep + SIGN_WINDOW);
        if (!closable) revert NotClosable(flightId, s);

        f.status = Status.Closed;
        _release(_aircraftDays[f.aircraftId], dep, f.durationMinutes);
        _release(_studentDays[f.student], dep, f.durationMinutes);
        emit FlightClosed(flightId, s);
    }

    // ───────────────────────── Views ─────────────────────────

    function getFlight(uint256 flightId) external view returns (Flight memory) {
        return _flights[flightId];
    }

    function totalsOf(address student) external view returns (IFlightLog.Totals memory) {
        return _totals[student];
    }

    function instructorsOf(address student) external view returns (address[] memory) {
        return _instructorsOf[student];
    }

    function minutesWith(address student, address instructor) external view returns (uint32) {
        return _minutesWith[student][instructor];
    }

    function aircraftDayBitmap(uint32 aircraftId, uint256 day) external view returns (uint256) {
        return _aircraftDays[aircraftId][day];
    }

    // ───────────────────────── Internals ─────────────────────────

    function _sign(uint256 flightId, uint32 instructorSchoolId) private {
        Flight storage f = _requireFlight(flightId);
        if (f.status != Status.Logged) revert WrongStatus(flightId, f.status);
        address student = f.student;
        if (registry.studentSchool(student) != instructorSchoolId) revert InstructorWrongSchool(msg.sender, flightId);
        if (block.timestamp > uint256(f.departureTime) + SIGN_WINDOW) revert SignWindowClosed(flightId);

        if (!_linked[student][msg.sender]) {
            if (_instructorsOf[student].length >= MAX_INSTRUCTORS_PER_STUDENT) revert TooManyInstructors(student);
            _linked[student][msg.sender] = true;
            _instructorsOf[student].push(msg.sender);
        }

        f.instructor = msg.sender;
        f.status = Status.Signed;

        ITrainingRegistry.Aircraft memory ac = registry.aircraftInfo(f.aircraftId);
        emit FlightSigned(
            flightId,
            msg.sender,
            student,
            ac.icao24,
            ac.adsbEquipped,
            f.departureTime,
            f.durationMinutes,
            f.departureAirport,
            f.arrivalAirport
        );
    }

    /// @dev Running totals: licence checks read one slot instead of looping over every flight.
    function _count(uint256 flightId, Flight storage f) private {
        uint16 minutes_ = f.durationMinutes;
        uint8 flags = f.flags;
        address student = f.student;
        bool adsbVerified = f.status == Status.Verified;

        IFlightLog.Totals storage t = _totals[student];
        t.total += minutes_;
        if (flags & FLAG_SOLO != 0) t.solo += minutes_;
        else t.dual += minutes_;
        if (flags & FLAG_CROSS_COUNTRY != 0) t.crossCountry += minutes_;
        if (flags & FLAG_NIGHT != 0) t.night += minutes_;
        if (adsbVerified) t.verified += minutes_;

        _minutesWith[student][f.instructor] += minutes_;
        emit FlightCounted(flightId, student, minutes_, adsbVerified);
    }

    function _requireFlight(uint256 flightId) private view returns (Flight storage f) {
        f = _flights[flightId];
        if (f.status == Status.None) revert FlightNotFound(flightId);
    }

    function _requireActiveInstructor() private view returns (uint32 schoolId) {
        if (registry.instructorStatus(msg.sender) != ITrainingRegistry.InstructorStatus.Active) {
            revert InstructorNotActive(msg.sender);
        }
        schoolId = registry.instructorSchool(msg.sender);
        _requireSchoolUsable(schoolId);
    }

    function _requireSchoolUsable(uint32 schoolId) private view {
        if (!registry.isSchoolActive(schoolId)) revert SchoolInactive(schoolId);
        uint32 authorityId = registry.schoolAuthority(schoolId);
        if (!authorities.isActive(authorityId)) revert AuthorityInactive(authorityId);
    }

    /// @dev Marks the ten-minute slots covered by [departure, landing) as busy.
    ///      Returns false if any slot is already taken. A flight touches at most two days.
    function _occupy(
        mapping(uint256 => uint256) storage dayBits,
        uint256 departure,
        uint256 durationMinutes
    ) private returns (bool) {
        (uint256 first, uint256 last) = _slotRange(departure, durationMinutes);
        uint256 lastDay = last / SLOTS_PER_DAY;
        for (uint256 day = first / SLOTS_PER_DAY; day <= lastDay; ++day) {
            uint256 mask = _dayMask(day, first, last);
            uint256 bits = dayBits[day];
            if (bits & mask != 0) return false;
            dayBits[day] = bits | mask;
        }
        return true;
    }

    function _release(mapping(uint256 => uint256) storage dayBits, uint256 departure, uint256 durationMinutes) private {
        (uint256 first, uint256 last) = _slotRange(departure, durationMinutes);
        uint256 lastDay = last / SLOTS_PER_DAY;
        for (uint256 day = first / SLOTS_PER_DAY; day <= lastDay; ++day) {
            dayBits[day] &= ~_dayMask(day, first, last);
        }
    }

    function _slotRange(uint256 departure, uint256 durationMinutes) private pure returns (uint256 first, uint256 last) {
        first = departure / SLOT_SECONDS;
        last = (departure + durationMinutes * 60 - 1) / SLOT_SECONDS;
    }

    function _dayMask(uint256 day, uint256 first, uint256 last) private pure returns (uint256) {
        uint256 dayStart = day * SLOTS_PER_DAY;
        uint256 s = first > dayStart ? first - dayStart : 0;
        uint256 e = last < dayStart + SLOTS_PER_DAY - 1 ? last - dayStart : SLOTS_PER_DAY - 1;
        return ((uint256(1) << (e - s + 1)) - 1) << s;
    }
}
