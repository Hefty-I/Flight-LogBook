import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployFixture,
  logFlight,
  completeFlight,
  buildLogbookForA,
  RULES_A,
  HOUR,
  DAY,
  Status,
  OracleResult,
  EVIDENCE,
  EVIDENCE_URI,
  Ineligibility,
  EffectiveStatus,
  EffectiveValidation,
} from "./helpers";

/**
 * Project-specific attack and misuse scenarios (rubric section E).
 * Each test is written as a short story: the attack, then the control that stops it.
 */
describe("Attack scenarios", () => {
  it("1. Ghost flight: student and instructor log a flight that never happened", async () => {
    const { flightLog, student, student2, instructor, oracle, adminA } = await loadFixture(deployFixture);

    // The colluding pair log and sign a 3-hour flight on the ADS-B-equipped aircraft.
    const { id, departure } = await logFlight(flightLog, student, { minutes: 180 });
    await flightLog.connect(instructor).signFlight(id);

    // A bribed oracle cannot wave it through as "no data": the aircraft broadcasts ADS-B.
    await expect(
      flightLog.connect(oracle).submitVerification(id, OracleResult.NoData, EVIDENCE, EVIDENCE_URI),
    ).to.be.revertedWithCustomError(flightLog, "NoDataNotAllowedForTrackedAircraft");

    // OpenSky has no such flight -> Mismatch -> not counted.
    await flightLog.connect(oracle).submitVerification(id, OracleResult.Mismatch, EVIDENCE, EVIDENCE_URI);
    expect((await flightLog.totalsOf(student.address)).total).to.equal(0);

    // The dispute is rejected by the authority, and the dead claim is closed.
    await flightLog.connect(student).openDispute(id, EVIDENCE, "ipfs://weak-excuse");
    await flightLog.connect(adminA).resolveDispute(id, false);
    await flightLog.connect(student2).closeFlight(id);
    expect((await flightLog.getFlight(id)).status).to.equal(Status.Closed);

    // The fake claim no longer blocks that time slot for a real flight.
    await logFlight(flightLog, student2, { minutes: 60, departure: departure + 3600 });
  });

  it("2. Double claim: two students claim the same aircraft at the same time", async () => {
    const { flightLog, student, student2 } = await loadFixture(deployFixture);
    const { departure } = await logFlight(flightLog, student, { minutes: 120 });
    await expect(logFlight(flightLog, student2, { minutes: 60, departure: departure + 1800 }))
      .to.be.revertedWithCustomError(flightLog, "AircraftBusy")
      .withArgs(1);
  });

  it("3. Corrupt instructor: revocation puts licences and foreign validations under review", async () => {
    const ctx = await loadFixture(deployFixture);
    const { licences, registry, adminA, adminB, student, instructor } = ctx;

    await buildLogbookForA(ctx);
    await completeFlight(ctx, { minutes: 300 }); // 45h, enough for Authority B as well
    await licences.connect(adminA).issueLicence(student.address);
    await licences.connect(student).requestValidation(2);
    await licences.connect(adminB).decideValidation(student.address, 2, true);

    // The instructor is caught faking records elsewhere and revoked.
    await registry.connect(adminA).revokeInstructor(instructor.address);

    // No loop over flights or validations was needed, yet everything reacts:
    expect(await licences.licenceStatus(student.address)).to.equal(EffectiveStatus.UnderReview);
    expect(await licences.validationStatus(student.address, 2)).to.equal(EffectiveValidation.HomeLicenceInactive);
    expect(await licences.eligibility(student.address, 1)).to.equal(Ineligibility.UnderReview);

    // Only the home authority can clear the review after re-examining the pilot.
    await expect(licences.connect(adminB).clearReview(student.address, instructor.address))
      .to.be.revertedWithCustomError(licences, "NotAuthorityAdmin")
      .withArgs(1, adminB.address);
    await licences.connect(adminA).clearReview(student.address, instructor.address);
    expect(await licences.licenceStatus(student.address)).to.equal(EffectiveStatus.Active);
    expect(await licences.validationStatus(student.address, 2)).to.equal(EffectiveValidation.Valid);
    await expect(licences.connect(adminA).clearReview(student.address, instructor.address)).to.be.revertedWithCustomError(
      licences,
      "NothingToClear",
    );
  });

  it("4. Rogue oracle: an attacker or a lazy oracle cannot approve flights", async () => {
    const { flightLog, student, instructor, outsider } = await loadFixture(deployFixture);
    const { id } = await logFlight(flightLog, student, { minutes: 60 });
    await flightLog.connect(instructor).signFlight(id);
    await expect(
      flightLog.connect(outsider).submitVerification(id, OracleResult.Match, EVIDENCE, EVIDENCE_URI),
    ).to.be.revertedWithCustomError(flightLog, "AccessControlUnauthorizedAccount");
    expect((await flightLog.getFlight(id)).status).to.equal(Status.Signed);
  });

  it("5. Corrupt regulator: cannot issue a licence for missing hours or lower rules below ICAO", async () => {
    const ctx = await loadFixture(deployFixture);
    await completeFlight(ctx, { minutes: 600 }); // only 10 hours
    await expect(ctx.licences.connect(ctx.adminA).issueLicence(ctx.student.address))
      .to.be.revertedWithCustomError(ctx.licences, "NotEligible")
      .withArgs(ctx.student.address, 1, Ineligibility.TotalTooLow);
    await expect(
      ctx.authorities.connect(ctx.adminA).updateRules(1, { ...RULES_A, minTotalMinutes: 10 * HOUR }),
    ).to.be.revertedWithCustomError(ctx.authorities, "RulesBelowIcaoMinimum");
  });

  it("6. Authority overreach: country B cannot act on country A's people", async () => {
    const ctx = await loadFixture(deployFixture);
    const { flightLog, licences, registry, adminB, instructor, student } = ctx;
    const id = await completeFlight(ctx, { minutes: 60, result: OracleResult.Mismatch });
    await flightLog.connect(student).openDispute(id, EVIDENCE, "");

    await expect(flightLog.connect(adminB).resolveDispute(id, true)).to.be.revertedWithCustomError(
      flightLog,
      "NotAuthorityAdmin",
    );
    await expect(registry.connect(adminB).revokeInstructor(instructor.address)).to.be.revertedWithCustomError(
      registry,
      "NotAuthorityAdmin",
    );
    await expect(licences.connect(adminB).clearReview(student.address, instructor.address)).to.be.revertedWithCustomError(
      licences,
      "NotAuthorityAdmin",
    );
  });

  it("7. Unbounded-loop DoS: a student can be linked to at most 10 instructors", async () => {
    const { flightLog, registry, adminA, student, instructor, instructor2, deployer } = await loadFixture(deployFixture);
    const extra = [];
    for (let i = 0; i < 9; i++) {
      const w = ethers.Wallet.createRandom().connect(ethers.provider);
      await deployer.sendTransaction({ to: w.address, value: ethers.parseEther("1") });
      await registry.connect(adminA).registerInstructor(1, w.address);
      extra.push(w);
    }
    const signersList = [instructor, instructor2, ...extra]; // 11 instructors
    const base = Math.floor(((await time.latest()) - 20 * HOUR * 60) / 600) * 600;
    for (let i = 0; i < signersList.length; i++) {
      const { id } = await logFlight(flightLog, student, { minutes: 30, departure: base + i * 3600 });
      if (i < 10) {
        await flightLog.connect(signersList[i]).signFlight(id);
      } else {
        await expect(flightLog.connect(signersList[i]).signFlight(id))
          .to.be.revertedWithCustomError(flightLog, "TooManyInstructors")
          .withArgs(student.address);
      }
    }
  });

  it("8. Emergency pause stops licence issuance as well", async () => {
    const ctx = await loadFixture(deployFixture);
    await buildLogbookForA(ctx);
    await ctx.authorities.connect(ctx.deployer).pause();
    await expect(ctx.licences.connect(ctx.adminA).issueLicence(ctx.student.address)).to.be.revertedWithCustomError(
      ctx.licences,
      "SystemPaused",
    );
    await time.increase(DAY);
  });
});
