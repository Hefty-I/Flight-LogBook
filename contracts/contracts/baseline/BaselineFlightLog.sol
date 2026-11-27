// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AuthorityScoped} from "../base/AuthorityScoped.sol";
import {ITrainingRegistry} from "../interfaces/ITrainingRegistry.sol";
import {IFlightLog} from "../interfaces/IFlightLog.sol";

/// @title BaselineFlightLog — NAIVE VERSION, ONLY FOR THE GAS STUDY. Do not use for real.
/// @notice Same rules as FlightLog, written the "obvious" way, so we can measure what each
///         optimization in FlightLog saves (see scripts/gas-compare.ts and docs/GAS_RESULTS.md):
///   G1  every number is uint256 and flags are separate bools     (FlightLog: packed into 3 slots)
///   G2  no running totals: totals are recomputed by looping       (FlightLog: running totals)
///   G3  one storage slot per 10-minute time slot                  (FlightLog: one bitmap word per day)
///   G5  airports and evidence URI stored as strings               (FlightLog: bytes4, URI only in events)
///   G7  require() with text messages                              (FlightLog: custom errors)
contract BaselineFlightLog is AuthorityScoped, IFlightLog {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    uint256 public constant MAX_LOG_DELAY = 3 days;
    uint256 public constant SIGN_WINDOW = 7 days;
    uint256 private constant SLOT_SECONDS = 600;

    struct Flight {
        address student;
        uint256 aircraftId;
        uint256 departureTime;
        uint256 durationMinutes;
        bool solo;
        bool crossCountry;
        bool night;
        address instructor;
        string departureAirport;
        string arrivalAirport;
        uint256 status; // 1 Logged, 2 Signed, 3 Verified, 4 Attested, 5 Mismatch
        bytes32 evidenceHash;
        string evidenceURI;
    }

    ITrainingRegistry public immutable registry;
    uint256 public flightCount;
    mapping(uint256 => Flight) public flights;
    mapping(address => uint256[]) public flightsOf;
    mapping(uint256 => mapping(uint256 => bool)) public aircraftSlotTaken;
    mapping(address => mapping(uint256 => bool)) public studentSlotTaken;

    event FlightLogged(
        uint256 indexed flightId,
        address indexed student,
        uint256 indexed aircraftId,
        uint256 departureTime,
        uint256 durationMinutes,
        uint8 flags,
        string departureAirport,
        string arrivalAirport
    );
    event FlightSigned(
        uint256 indexed flightId,
        address indexed instructor,
        address indexed student,
        bytes3 icao24,
        bool adsbEquipped,
        uint256 departureTime,
        uint256 durationMinutes,
        string departureAirport,
        string arrivalAirport
    );
    event FlightVerified(uint256 indexed flightId, uint8 result, uint256 newStatus, bytes32 evidenceHash, string evidenceURI);

    constructor(
        address admin,
        address authorityRegistry,
        address trainingRegistry
    ) AuthorityScoped(admin, authorityRegistry) {
        registry = ITrainingRegistry(trainingRegistry);
    }

    function logFlight(
        uint32 aircraftId,
        uint40 departureTime,
        uint16 durationMinutes,
        string calldata departureAirport,
        string calldata arrivalAirport,
        uint8 flags
    ) external whenSystemActive returns (uint256 flightId) {
        // The "obvious" style: copy the inputs into a memory struct and pass it around.
        FlightInput memory input = FlightInput(
            aircraftId,
            departureTime,
            durationMinutes,
            departureAirport,
            arrivalAirport,
            flags
        );
        uint256 landing = _check(input);
        _occupy(aircraftId, departureTime, landing);
        flightId = _store(input);
    }

    struct FlightInput {
        uint256 aircraftId;
        uint256 departureTime;
        uint256 durationMinutes;
        string departureAirport;
        string arrivalAirport;
        uint8 flags;
    }

    function _check(FlightInput memory input) private view returns (uint256 landing) {
        uint32 schoolId = registry.studentSchool(msg.sender);
        require(schoolId != 0, "Not a registered student");
        require(registry.isSchoolActive(schoolId), "School inactive");
        ITrainingRegistry.Aircraft memory ac = registry.aircraftInfo(uint32(input.aircraftId));
        require(ac.active, "Aircraft unavailable");
        require(ac.schoolId == schoolId, "Aircraft belongs to another school");
        require(input.durationMinutes > 0 && input.durationMinutes <= 720, "Duration must be 1-720 minutes");
        require(input.flags <= 7, "Invalid flags");
        require(
            bytes(input.departureAirport).length == 4 && bytes(input.arrivalAirport).length == 4,
            "Airports must be 4-letter ICAO codes"
        );
        if (input.flags & 2 != 0) {
            require(
                keccak256(bytes(input.departureAirport)) != keccak256(bytes(input.arrivalAirport)),
                "Cross-country needs different airports"
            );
        }
        landing = input.departureTime + input.durationMinutes * 60;
        require(landing <= block.timestamp, "Flight has not landed yet");
        require(block.timestamp - landing <= MAX_LOG_DELAY, "Logged too late");
    }

    function _store(FlightInput memory input) private returns (uint256 flightId) {
        flightId = ++flightCount;
        Flight storage f = flights[flightId];
        f.student = msg.sender;
        f.aircraftId = input.aircraftId;
        f.departureTime = input.departureTime;
        f.durationMinutes = input.durationMinutes;
        f.solo = input.flags & 1 != 0;
        f.crossCountry = input.flags & 2 != 0;
        f.night = input.flags & 4 != 0;
        f.departureAirport = input.departureAirport;
        f.arrivalAirport = input.arrivalAirport;
        f.status = 1;
        flightsOf[msg.sender].push(flightId);

        emit FlightLogged(
            flightId,
            msg.sender,
            input.aircraftId,
            input.departureTime,
            input.durationMinutes,
            input.flags,
            input.departureAirport,
            input.arrivalAirport
        );
    }

    function signFlight(uint256 flightId) external whenSystemActive {
        require(
            registry.instructorStatus(msg.sender) == ITrainingRegistry.InstructorStatus.Active,
            "Not an active instructor"
        );
        Flight storage f = flights[flightId];
        require(f.status == 1, "Flight is not waiting for a signature");
        require(registry.studentSchool(f.student) == registry.instructorSchool(msg.sender), "Instructor from another school");
        require(block.timestamp <= f.departureTime + SIGN_WINDOW, "Sign window closed");

        f.instructor = msg.sender;
        f.status = 2;
        ITrainingRegistry.Aircraft memory ac = registry.aircraftInfo(uint32(f.aircraftId));
        emit FlightSigned(
            flightId,
            msg.sender,
            f.student,
            ac.icao24,
            ac.adsbEquipped,
            f.departureTime,
            f.durationMinutes,
            f.departureAirport,
            f.arrivalAirport
        );
    }

    function submitVerification(
        uint256 flightId,
        uint8 result,
        bytes32 evidenceHash,
        string calldata evidenceURI
    ) external whenSystemActive onlyRole(ORACLE_ROLE) {
        Flight storage f = flights[flightId];
        require(f.status == 2, "Flight is not signed");
        require(evidenceHash != bytes32(0), "Evidence required");
        require(result <= 2, "Invalid result");
        if (result == 1) {
            require(!registry.aircraftInfo(uint32(f.aircraftId)).adsbEquipped, "Tracked aircraft cannot be NoData");
        }
        f.evidenceHash = evidenceHash;
        f.evidenceURI = evidenceURI;
        f.status = result == 0 ? 3 : (result == 1 ? 4 : 5);
        emit FlightVerified(flightId, result, f.status, evidenceHash, evidenceURI);
    }

    /// @dev Naive overlap check: one storage slot per 10-minute slot, for the aircraft and the student.
    function _occupy(uint256 aircraftId, uint256 departureTime, uint256 landing) private {
        uint256 first = departureTime / SLOT_SECONDS;
        uint256 last = (landing - 1) / SLOT_SECONDS;
        for (uint256 s = first; s <= last; s++) {
            require(!aircraftSlotTaken[aircraftId][s], "Aircraft is busy");
            require(!studentSlotTaken[msg.sender][s], "Student is busy");
            aircraftSlotTaken[aircraftId][s] = true;
            studentSlotTaken[msg.sender][s] = true;
        }
    }

    // ── Views used by LicenceManager: recomputed by looping over every flight (no running totals) ──

    function totalsOf(address student) external view returns (IFlightLog.Totals memory t) {
        uint256[] storage ids = flightsOf[student];
        for (uint256 i = 0; i < ids.length; i++) {
            Flight storage f = flights[ids[i]];
            if (f.status != 3 && f.status != 4) continue;
            uint32 m = uint32(f.durationMinutes);
            t.total += m;
            if (f.solo) t.solo += m;
            else t.dual += m;
            if (f.crossCountry) t.crossCountry += m;
            if (f.night) t.night += m;
            if (f.status == 3) t.verified += m;
        }
    }

    function instructorsOf(address student) external view returns (address[] memory list) {
        uint256[] storage ids = flightsOf[student];
        address[] memory tmp = new address[](ids.length);
        uint256 n;
        for (uint256 i = 0; i < ids.length; i++) {
            address ins = flights[ids[i]].instructor;
            if (ins == address(0)) continue;
            bool seen;
            for (uint256 j = 0; j < n; j++) {
                if (tmp[j] == ins) {
                    seen = true;
                    break;
                }
            }
            if (!seen) tmp[n++] = ins;
        }
        list = new address[](n);
        for (uint256 k = 0; k < n; k++) list[k] = tmp[k];
    }

    function minutesWith(address student, address instructor) external view returns (uint32 m) {
        uint256[] storage ids = flightsOf[student];
        for (uint256 i = 0; i < ids.length; i++) {
            Flight storage f = flights[ids[i]];
            if (f.instructor == instructor && (f.status == 3 || f.status == 4)) m += uint32(f.durationMinutes);
        }
    }
}
