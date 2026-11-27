// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AuthorityScoped} from "./base/AuthorityScoped.sol";
import {IAuthorityRegistry} from "./interfaces/IAuthorityRegistry.sol";
import {ITrainingRegistry} from "./interfaces/ITrainingRegistry.sol";
import {IFlightLog} from "./interfaces/IFlightLog.sol";

/// @title LicenceManager
/// @notice Issues pilot licences only when the logbook meets the home authority's rules,
///         and lets foreign authorities validate a licence against *their own* rules.
/// @dev "Lazy" status: suspending a licence or revoking an instructor never loops over
///      validations or flights. The effective status is worked out whenever it is read.
contract LicenceManager is AuthorityScoped {
    enum LicenceStatus {
        None,
        Active,
        Suspended,
        Revoked
    }

    /// @notice What a verifier (airline, foreign authority, public) should believe right now.
    enum EffectiveStatus {
        None,
        Active,
        UnderReview, // signed by a revoked instructor and not yet re-checked
        Suspended,
        Revoked,
        AuthoritySuspended // the issuing authority was suspended by the consortium
    }

    enum ValidationStatus {
        None,
        Pending,
        Approved,
        Rejected
    }

    enum EffectiveValidation {
        None,
        Pending,
        Valid,
        Rejected,
        HomeLicenceInactive
    }

    enum Ineligibility {
        None,
        NotAStudent,
        TotalTooLow,
        DualTooLow,
        SoloTooLow,
        CrossCountryTooLow,
        VerifiedShareTooLow,
        UnderReview
    }

    struct Licence {
        uint32 authorityId;
        LicenceStatus status;
        uint40 issuedAt;
    }

    ITrainingRegistry public immutable registry;
    IFlightLog public immutable flightLog;

    mapping(address => Licence) private _licences;
    mapping(address => mapping(uint32 => ValidationStatus)) private _validations;
    /// @notice pilot => revoked instructor => hours re-checked and accepted by the authority
    mapping(address => mapping(address => bool)) public reviewCleared;

    event LicenceIssued(address indexed pilot, uint32 indexed authorityId);
    event LicenceStatusChanged(address indexed pilot, LicenceStatus status);
    event ReviewCleared(address indexed pilot, address indexed instructor, uint32 indexed authorityId);
    event ValidationRequested(address indexed pilot, uint32 indexed homeAuthority, uint32 indexed foreignAuthority);
    event ValidationDecided(address indexed pilot, uint32 indexed foreignAuthority, bool approved);
    event ValidationWithdrawn(address indexed pilot, uint32 indexed foreignAuthority);

    error NotAStudent(address pilot);
    error LicenceExists(address pilot);
    error NoLicence(address pilot);
    error NotEligible(address pilot, uint32 authorityId, Ineligibility reason);
    error InvalidTransition(LicenceStatus from, LicenceStatus to);
    error LicenceNotActive(address pilot);
    error SameAuthority();
    error ValidationExists(address pilot, uint32 foreignAuthority);
    error NoPendingValidation(address pilot, uint32 foreignAuthority);
    error NotApproved(address pilot, uint32 foreignAuthority);
    error NothingToClear(address pilot, address instructor);

    constructor(
        address admin,
        address authorityRegistry,
        address trainingRegistry,
        address flightLog_
    ) AuthorityScoped(admin, authorityRegistry) {
        if (trainingRegistry == address(0) || flightLog_ == address(0)) revert ZeroAddress();
        registry = ITrainingRegistry(trainingRegistry);
        flightLog = IFlightLog(flightLog_);
    }

    // ───────────────────────── Home authority ─────────────────────────

    /// @notice Even the authority cannot issue a licence the logbook does not support.
    function issueLicence(address pilot) external whenSystemActive {
        uint32 home = _homeAuthority(pilot);
        _checkAuthorityAdmin(home);
        if (_licences[pilot].status != LicenceStatus.None) revert LicenceExists(pilot);

        Ineligibility why = eligibility(pilot, home);
        if (why != Ineligibility.None) revert NotEligible(pilot, home, why);

        _licences[pilot] = Licence({authorityId: home, status: LicenceStatus.Active, issuedAt: uint40(block.timestamp)});
        emit LicenceIssued(pilot, home);
    }

    function suspendLicence(address pilot) external whenSystemActive {
        _transition(pilot, LicenceStatus.Active, LicenceStatus.Suspended);
    }

    function reinstateLicence(address pilot) external whenSystemActive {
        _transition(pilot, LicenceStatus.Suspended, LicenceStatus.Active);
    }

    function revokeLicence(address pilot) external whenSystemActive {
        Licence storage l = _requireOwnLicence(pilot);
        if (l.status == LicenceStatus.Revoked) revert InvalidTransition(l.status, LicenceStatus.Revoked);
        l.status = LicenceStatus.Revoked;
        emit LicenceStatusChanged(pilot, LicenceStatus.Revoked);
    }

    /// @notice After re-examining a pilot whose instructor was revoked, the authority
    ///         accepts those hours again.
    function clearReview(address pilot, address instructor) external whenSystemActive {
        uint32 home = _homeAuthority(pilot);
        _checkAuthorityAdmin(home);
        if (
            registry.instructorStatus(instructor) != ITrainingRegistry.InstructorStatus.Revoked ||
            flightLog.minutesWith(pilot, instructor) == 0 ||
            reviewCleared[pilot][instructor]
        ) revert NothingToClear(pilot, instructor);

        reviewCleared[pilot][instructor] = true;
        emit ReviewCleared(pilot, instructor, home);
    }

    // ───────────────────────── Cross-border validation ─────────────────────────

    function requestValidation(uint32 foreignAuthority) external whenSystemActive {
        Licence storage l = _licences[msg.sender];
        if (licenceStatus(msg.sender) != EffectiveStatus.Active) revert LicenceNotActive(msg.sender);
        if (foreignAuthority == l.authorityId) revert SameAuthority();
        if (!authorities.isActive(foreignAuthority)) revert AuthorityInactive(foreignAuthority);

        ValidationStatus v = _validations[msg.sender][foreignAuthority];
        if (v == ValidationStatus.Pending || v == ValidationStatus.Approved) {
            revert ValidationExists(msg.sender, foreignAuthority);
        }
        _validations[msg.sender][foreignAuthority] = ValidationStatus.Pending;
        emit ValidationRequested(msg.sender, l.authorityId, foreignAuthority);
    }

    /// @notice The foreign authority can only approve if the on-chain logbook meets ITS rules.
    function decideValidation(
        address pilot,
        uint32 foreignAuthority,
        bool approve
    ) external whenSystemActive onlyAuthorityAdmin(foreignAuthority) {
        if (_validations[pilot][foreignAuthority] != ValidationStatus.Pending) {
            revert NoPendingValidation(pilot, foreignAuthority);
        }
        if (approve) {
            if (licenceStatus(pilot) != EffectiveStatus.Active) revert LicenceNotActive(pilot);
            Ineligibility why = eligibility(pilot, foreignAuthority);
            if (why != Ineligibility.None) revert NotEligible(pilot, foreignAuthority, why);
            _validations[pilot][foreignAuthority] = ValidationStatus.Approved;
        } else {
            _validations[pilot][foreignAuthority] = ValidationStatus.Rejected;
        }
        emit ValidationDecided(pilot, foreignAuthority, approve);
    }

    function withdrawValidation(
        address pilot,
        uint32 foreignAuthority
    ) external whenSystemActive onlyAuthorityAdmin(foreignAuthority) {
        if (_validations[pilot][foreignAuthority] != ValidationStatus.Approved) {
            revert NotApproved(pilot, foreignAuthority);
        }
        _validations[pilot][foreignAuthority] = ValidationStatus.Rejected;
        emit ValidationWithdrawn(pilot, foreignAuthority);
    }

    // ───────────────────────── Views ─────────────────────────

    /// @notice Why a pilot does not (yet) meet an authority's rules. `None` means eligible.
    function eligibility(address pilot, uint32 authorityId) public view returns (Ineligibility) {
        if (registry.studentSchool(pilot) == 0) return Ineligibility.NotAStudent;
        IAuthorityRegistry.RuleSet memory r = authorities.rulesOf(authorityId);
        IFlightLog.Totals memory t = flightLog.totalsOf(pilot);

        if (t.total < r.minTotalMinutes) return Ineligibility.TotalTooLow;
        if (t.dual < r.minDualMinutes) return Ineligibility.DualTooLow;
        if (t.solo < r.minSoloMinutes) return Ineligibility.SoloTooLow;
        if (t.crossCountry < r.minCrossCountryMinutes) return Ineligibility.CrossCountryTooLow;
        if (uint256(t.verified) * 10_000 < uint256(t.total) * r.minVerifiedBps) {
            return Ineligibility.VerifiedShareTooLow;
        }
        if (hasUnclearedReview(pilot)) return Ineligibility.UnderReview;
        return Ineligibility.None;
    }

    /// @notice True if any counted hours were signed by an instructor who has since been
    ///         revoked and the authority has not re-checked them. Bounded loop
    ///         (FlightLog caps instructors per student at 10).
    function hasUnclearedReview(address pilot) public view returns (bool) {
        address[] memory instructors = flightLog.instructorsOf(pilot);
        for (uint256 i = 0; i < instructors.length; ++i) {
            address ins = instructors[i];
            if (
                registry.instructorStatus(ins) == ITrainingRegistry.InstructorStatus.Revoked &&
                !reviewCleared[pilot][ins] &&
                flightLog.minutesWith(pilot, ins) > 0
            ) return true;
        }
        return false;
    }

    function licenceStatus(address pilot) public view returns (EffectiveStatus) {
        Licence memory l = _licences[pilot];
        if (l.status == LicenceStatus.None) return EffectiveStatus.None;
        if (l.status == LicenceStatus.Revoked) return EffectiveStatus.Revoked;
        if (!authorities.isActive(l.authorityId)) return EffectiveStatus.AuthoritySuspended;
        if (l.status == LicenceStatus.Suspended) return EffectiveStatus.Suspended;
        if (hasUnclearedReview(pilot)) return EffectiveStatus.UnderReview;
        return EffectiveStatus.Active;
    }

    /// @notice Lazy check: an approved validation is only "Valid" while the home licence is active.
    function validationStatus(address pilot, uint32 foreignAuthority) external view returns (EffectiveValidation) {
        ValidationStatus v = _validations[pilot][foreignAuthority];
        if (v == ValidationStatus.None) return EffectiveValidation.None;
        if (v == ValidationStatus.Pending) return EffectiveValidation.Pending;
        if (v == ValidationStatus.Rejected) return EffectiveValidation.Rejected;
        return
            licenceStatus(pilot) == EffectiveStatus.Active
                ? EffectiveValidation.Valid
                : EffectiveValidation.HomeLicenceInactive;
    }

    function getLicence(address pilot) external view returns (Licence memory) {
        return _licences[pilot];
    }

    // ───────────────────────── Internals ─────────────────────────

    function _homeAuthority(address pilot) private view returns (uint32) {
        uint32 schoolId = registry.studentSchool(pilot);
        if (schoolId == 0) revert NotAStudent(pilot);
        return registry.schoolAuthority(schoolId);
    }

    function _requireOwnLicence(address pilot) private view returns (Licence storage l) {
        l = _licences[pilot];
        if (l.status == LicenceStatus.None) revert NoLicence(pilot);
        _checkAuthorityAdmin(l.authorityId);
    }

    function _transition(address pilot, LicenceStatus from, LicenceStatus to) private {
        Licence storage l = _requireOwnLicence(pilot);
        if (l.status != from) revert InvalidTransition(l.status, to);
        l.status = to;
        emit LicenceStatusChanged(pilot, to);
    }
}
