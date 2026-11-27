import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { FlightLog } from "../typechain-types";

export const HOUR = 60; // minutes
export const DAY = 24 * 60 * 60; // seconds

/** Authority A: FAA-style (40h total, 20h dual, 10h solo, 5h cross-country, 60% ADS-B verified). */
export const RULES_A = {
  minTotalMinutes: 40 * HOUR,
  minDualMinutes: 20 * HOUR,
  minSoloMinutes: 10 * HOUR,
  minCrossCountryMinutes: 5 * HOUR,
  minVerifiedBps: 6000,
};

/** Authority B: EASA-style (45h total, 25h dual). */
export const RULES_B = {
  minTotalMinutes: 45 * HOUR,
  minDualMinutes: 25 * HOUR,
  minSoloMinutes: 10 * HOUR,
  minCrossCountryMinutes: 5 * HOUR,
  minVerifiedBps: 6000,
};

export const FLAG = { NONE: 0, SOLO: 1, XC: 2, NIGHT: 4 };

export const Status = {
  None: 0,
  Logged: 1,
  Signed: 2,
  Verified: 3,
  Attested: 4,
  Mismatch: 5,
  Disputed: 6,
  Rejected: 7,
  Closed: 8,
};

export const OracleResult = { Match: 0, NoData: 1, Mismatch: 2 };

export const Ineligibility = {
  None: 0,
  NotAStudent: 1,
  TotalTooLow: 2,
  DualTooLow: 3,
  SoloTooLow: 4,
  CrossCountryTooLow: 5,
  VerifiedShareTooLow: 6,
  UnderReview: 7,
};

export const EffectiveStatus = {
  None: 0,
  Active: 1,
  UnderReview: 2,
  Suspended: 3,
  Revoked: 4,
  AuthoritySuspended: 5,
};

export const EffectiveValidation = {
  None: 0,
  Pending: 1,
  Valid: 2,
  Rejected: 3,
  HomeLicenceInactive: 4,
};

/** ICAO airport code ("EDDF") -> bytes4 */
export const apt = (code: string) => ethers.hexlify(ethers.toUtf8Bytes(code));
/** 24-bit ICAO aircraft address ("3c6444") -> bytes3 */
export const icao = (hex: string) => "0x" + hex.toLowerCase();
/** Tail number ("D-EABC") -> bytes8, right-padded */
export const reg = (tail: string) => ethers.zeroPadBytes(ethers.toUtf8Bytes(tail), 8);
export const EVIDENCE = ethers.keccak256(ethers.toUtf8Bytes("evidence-json"));
export const EVIDENCE_URI = "ipfs://bafy-demo-evidence";

/**
 * Deploys the whole system with two founding authorities:
 *  - Authority A (id 1) with school 1, instructors, students and two aircraft
 *    (aircraft 1 broadcasts ADS-B, aircraft 2 does not)
 *  - Authority B (id 2) with school 2, its own instructor, student and aircraft 3
 */
export async function deployFixture() {
  const signers = await ethers.getSigners();
  const [
    deployer,
    oracle,
    adminA,
    adminB,
    adminC,
    schoolAdmin,
    instructor,
    instructor2,
    student,
    student2,
    outsider,
    schoolAdminB,
    instructorB,
    studentB,
  ] = signers;

  const authorities = await (await ethers.getContractFactory("AuthorityRegistry")).deploy(deployer.address);
  const registry = await (
    await ethers.getContractFactory("TrainingRegistry")
  ).deploy(deployer.address, await authorities.getAddress());
  const flightLog = await (
    await ethers.getContractFactory("FlightLog")
  ).deploy(deployer.address, await authorities.getAddress(), await registry.getAddress());
  const licences = await (
    await ethers.getContractFactory("LicenceManager")
  ).deploy(
    deployer.address,
    await authorities.getAddress(),
    await registry.getAddress(),
    await flightLog.getAddress(),
  );

  await flightLog.grantRole(await flightLog.ORACLE_ROLE(), oracle.address);

  await authorities.addFoundingAuthority("Authority A (FAA-style rules)", adminA.address, RULES_A);
  await authorities.addFoundingAuthority("Authority B (EASA-style rules)", adminB.address, RULES_B);
  await authorities.sealGenesis();

  await registry.connect(adminA).registerSchool(1, schoolAdmin.address);
  await registry.connect(adminA).registerInstructor(1, instructor.address);
  await registry.connect(adminA).registerInstructor(1, instructor2.address);
  await registry.connect(schoolAdmin).registerStudent(student.address);
  await registry.connect(schoolAdmin).registerStudent(student2.address);
  await registry.connect(schoolAdmin).registerAircraft(icao("3c6444"), reg("D-EABC"), true); // id 1
  await registry.connect(schoolAdmin).registerAircraft(icao("a1b2c3"), reg("N172SP"), false); // id 2

  await registry.connect(adminB).registerSchool(2, schoolAdminB.address);
  await registry.connect(adminB).registerInstructor(2, instructorB.address);
  await registry.connect(schoolAdminB).registerStudent(studentB.address);
  await registry.connect(schoolAdminB).registerAircraft(icao("4ca123"), reg("EI-ABC"), true); // id 3

  return {
    authorities,
    registry,
    flightLog,
    licences,
    deployer,
    oracle,
    adminA,
    adminB,
    adminC,
    schoolAdmin,
    instructor,
    instructor2,
    student,
    student2,
    outsider,
    schoolAdminB,
    instructorB,
    studentB,
  };
}

export type Ctx = Awaited<ReturnType<typeof deployFixture>>;

export interface FlightInput {
  aircraftId?: number;
  minutes: number;
  flags?: number;
  from?: string;
  to?: string;
  /** Departure time; defaults to "landed 10 minutes ago". */
  departure?: number;
}

/** Logs a flight and returns { id, departure }. */
export async function logFlight(flightLog: FlightLog, student: HardhatEthersSigner, f: FlightInput) {
  const now = await time.latest();
  const departure = f.departure ?? now - f.minutes * 60 - 600;
  const flags = f.flags ?? FLAG.NONE;
  const from = f.from ?? "EDDF";
  const to = f.to ?? (flags & FLAG.XC ? "EDDS" : from);
  await flightLog
    .connect(student)
    .logFlight(f.aircraftId ?? 1, departure, f.minutes, apt(from), apt(to), flags);
  return { id: await flightLog.flightCount(), departure };
}

/**
 * Log -> sign -> oracle result, then move the clock forward one day so the
 * next flight never overlaps. Returns the flight id.
 */
export async function completeFlight(
  ctx: Ctx,
  f: FlightInput & { result?: number },
  student: HardhatEthersSigner = ctx.student,
  instructor: HardhatEthersSigner = ctx.instructor,
) {
  const { id } = await logFlight(ctx.flightLog, student, f);
  await ctx.flightLog.connect(instructor).signFlight(id);
  await ctx.flightLog
    .connect(ctx.oracle)
    .submitVerification(id, f.result ?? OracleResult.Match, EVIDENCE, EVIDENCE_URI);
  await time.increase(DAY);
  return id;
}

/**
 * Exactly meets Authority A's rules (40h) but not Authority B's (45h):
 * 30h dual + 10h solo cross-country, all ADS-B verified.
 */
export async function buildLogbookForA(ctx: Ctx, student = ctx.student, instructor = ctx.instructor) {
  await completeFlight(ctx, { minutes: 600 }, student, instructor);
  await completeFlight(ctx, { minutes: 600 }, student, instructor);
  await completeFlight(ctx, { minutes: 600 }, student, instructor);
  await completeFlight(ctx, { minutes: 600, flags: FLAG.SOLO | FLAG.XC }, student, instructor);
}
