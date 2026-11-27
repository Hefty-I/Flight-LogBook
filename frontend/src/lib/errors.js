import { Interface, isHexString } from "ethers";
import { ABIS } from "./config.js";
import { INELIGIBILITY } from "./format.js";

// When a *transaction* fails during gas estimation, ethers reports the raw revert data
// ("unknown custom error") because the provider does not know our ABIs. We decode it here.
const INTERFACES = Object.values(ABIS).map((abi) => new Interface(abi));

function decodeRevert(err) {
  if (err?.revert?.name) return err.revert;
  const candidates = [err?.data, err?.info?.error?.data, err?.info?.error?.data?.data, err?.error?.data];
  const data = candidates.find((d) => isHexString(d) && d.length >= 10);
  if (!data) return null;
  for (const iface of INTERFACES) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) return parsed;
    } catch {
      // not this contract's error; try the next ABI
    }
  }
  return null;
}

// Plain-language explanations of the contracts' custom errors.
const FRIENDLY = {
  // roles and scope
  NotAuthorityAdmin: "Only the admin of that country's authority can do this.",
  NotActiveAuthorityAdmin: "Your wallet is not the admin of an active authority.",
  AccessControlUnauthorizedAccount: "Your wallet does not have the role needed for this action.",
  NotSchoolAdmin: "Only the flight school's admin can do this.",
  AddressAlreadyRegistered: "This wallet already has a role. One wallet can only hold one role.",
  SystemPaused: "The system is paused (emergency stop).",
  EnforcedPause: "The system is paused (emergency stop).",
  // registry
  SchoolInactive: "This flight school is deactivated.",
  AuthorityInactive: "That authority is suspended.",
  InvalidIcao24: "Enter the aircraft's 6-character ICAO24 hex address.",
  Icao24AlreadyRegistered: "This aircraft is already registered.",
  // flights
  NotRegisteredStudent: "Your wallet is not registered as a student.",
  AircraftUnavailable: "This aircraft is deactivated.",
  AircraftNotInSchool: "This aircraft belongs to another school.",
  InvalidDuration: "Duration must be between 1 and 720 minutes.",
  InvalidFlags: "Invalid flight type.",
  InvalidAirport: "Enter both airport codes.",
  CrossCountryNeedsDifferentAirports: "A cross-country flight must land at a different airport.",
  FlightNotFinished: "This flight has not landed yet (check the date, time and duration).",
  LoggedTooLate: "Flights must be logged within 3 days of landing.",
  AircraftBusy: "This aircraft is already booked for an overlapping time.",
  StudentBusy: "You already logged a flight that overlaps this time.",
  WrongStatus: "The flight is not in the right state for this action.",
  NotFlightStudent: "Only the student who logged this flight can do this.",
  InstructorNotActive: "Your wallet is not an active instructor.",
  InstructorWrongSchool: "Instructors can only sign flights of students at their own school.",
  SignWindowClosed: "Flights must be co-signed within 7 days of departure.",
  TooManyInstructors: "A student can be signed off by at most 10 instructors.",
  EmptyBatch: "Select at least one flight.",
  MissingEvidence: "Evidence is required.",
  NoDataNotAllowedForTrackedAircraft: "An ADS-B aircraft with no track is a mismatch, not 'no data'.",
  OracleTimeoutNotReached: "The oracle still has time: wait 14 days after departure.",
  DisputeWindowClosed: "Disputes are only possible within 30 days of departure.",
  NotClosable: "This flight cannot be closed yet.",
  // licences
  LicenceExists: "This pilot already has a licence.",
  NoLicence: "This pilot has no licence.",
  LicenceNotActive: "The licence is not active.",
  SameAuthority: "You cannot ask your own authority for a validation.",
  ValidationExists: "A validation is already pending or approved.",
  NoPendingValidation: "There is no pending validation request.",
  NotApproved: "This validation is not approved.",
  NothingToClear: "There is nothing to clear for this pilot and instructor.",
  InvalidTransition: "That licence status change is not allowed.",
  NotAStudent: "That wallet is not a registered student.",
  // authorities
  RulesBelowIcaoMinimum: "Rules cannot be below the ICAO minimum of 40 hours.",
  InvalidRules: "These rules contradict each other.",
  AlreadyVoted: "Your authority already voted on this proposal.",
  ProposalClosed: "This proposal is closed.",
  GenesisNotSealed: "Founding is not finished yet.",
  AlreadyAdmin: "That wallet already runs an authority.",
};

/** Turns an ethers/MetaMask error into one readable sentence. */
export function explainError(err) {
  if (err?.code === "ACTION_REJECTED" || err?.info?.error?.code === 4001) {
    return "You rejected the request in MetaMask.";
  }
  const revert = decodeRevert(err);
  if (revert?.name) {
    if (revert.name === "NotEligible") {
      return `Not eligible: ${INELIGIBILITY[Number(revert.args?.[2])] ?? "requirements not met"}.`;
    }
    return FRIENDLY[revert.name] ?? `Rejected by the contract: ${revert.name}`;
  }
  return err?.shortMessage || err?.reason || err?.message || "Something went wrong.";
}
