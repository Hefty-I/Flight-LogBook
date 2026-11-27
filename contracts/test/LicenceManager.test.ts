import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployFixture,
  buildLogbookForA,
  completeFlight,
  FLAG,
  OracleResult,
  RULES_A,
  Ineligibility,
  EffectiveStatus,
  EffectiveValidation,
  HOUR,
} from "./helpers";

describe("LicenceManager", () => {
  describe("issuing a licence", () => {
    it("the same logbook meets Authority A's 40h rules but not Authority B's 45h rules", async () => {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.licences.eligibility(ctx.student.address, 1)).to.equal(Ineligibility.TotalTooLow);
      await buildLogbookForA(ctx);
      expect(await ctx.licences.eligibility(ctx.student.address, 1)).to.equal(Ineligibility.None);
      expect(await ctx.licences.eligibility(ctx.student.address, 2)).to.equal(Ineligibility.TotalTooLow);
    });

    it("the home authority issues the licence once the rules are met", async () => {
      const ctx = await loadFixture(deployFixture);
      await buildLogbookForA(ctx);
      await expect(ctx.licences.connect(ctx.adminA).issueLicence(ctx.student.address))
        .to.emit(ctx.licences, "LicenceIssued")
        .withArgs(ctx.student.address, 1);
      expect(await ctx.licences.licenceStatus(ctx.student.address)).to.equal(EffectiveStatus.Active);
      expect((await ctx.licences.getLicence(ctx.student.address)).authorityId).to.equal(1);
      await expect(ctx.licences.connect(ctx.adminA).issueLicence(ctx.student.address)).to.be.revertedWithCustomError(
        ctx.licences,
        "LicenceExists",
      );
    });

    it("a foreign authority cannot issue a licence to another country's student", async () => {
      const ctx = await loadFixture(deployFixture);
      await buildLogbookForA(ctx);
      await expect(ctx.licences.connect(ctx.adminB).issueLicence(ctx.student.address))
        .to.be.revertedWithCustomError(ctx.licences, "NotAuthorityAdmin")
        .withArgs(1, ctx.adminB.address);
    });

    it("ADS-B share: exactly 60% verified passes, 1 minute less fails", async () => {
      const ctx = await loadFixture(deployFixture);
      const { student, student2 } = ctx;
      // student: 1440 verified + 960 attested = 2400 minutes, exactly 60% verified
      await completeFlight(ctx, { minutes: 600 }, student);
      await completeFlight(ctx, { minutes: 600, flags: FLAG.SOLO | FLAG.XC }, student);
      await completeFlight(ctx, { minutes: 240 }, student);
      await completeFlight(ctx, { minutes: 600, aircraftId: 2, result: OracleResult.NoData }, student);
      await completeFlight(ctx, { minutes: 360, aircraftId: 2, result: OracleResult.NoData }, student);
      expect(await ctx.licences.eligibility(student.address, 1)).to.equal(Ineligibility.None);

      // student2: 1439 verified + 961 attested
      await completeFlight(ctx, { minutes: 600 }, student2);
      await completeFlight(ctx, { minutes: 600, flags: FLAG.SOLO | FLAG.XC }, student2);
      await completeFlight(ctx, { minutes: 239 }, student2);
      await completeFlight(ctx, { minutes: 600, aircraftId: 2, result: OracleResult.NoData }, student2);
      await completeFlight(ctx, { minutes: 361, aircraftId: 2, result: OracleResult.NoData }, student2);
      expect(await ctx.licences.eligibility(student2.address, 1)).to.equal(Ineligibility.VerifiedShareTooLow);
    });

    it("reports the first missing requirement (solo hours)", async () => {
      const ctx = await loadFixture(deployFixture);
      for (let i = 0; i < 4; i++) await completeFlight(ctx, { minutes: 600, flags: FLAG.XC });
      expect(await ctx.licences.eligibility(ctx.student.address, 1)).to.equal(Ineligibility.SoloTooLow);
    });
  });

  describe("licence status changes", () => {
    it("only the home authority can suspend; transitions are checked", async () => {
      const ctx = await loadFixture(deployFixture);
      await buildLogbookForA(ctx);
      await ctx.licences.connect(ctx.adminA).issueLicence(ctx.student.address);

      await expect(ctx.licences.connect(ctx.adminB).suspendLicence(ctx.student.address)).to.be.revertedWithCustomError(
        ctx.licences,
        "NotAuthorityAdmin",
      );
      await expect(ctx.licences.connect(ctx.adminA).reinstateLicence(ctx.student.address)).to.be.revertedWithCustomError(
        ctx.licences,
        "InvalidTransition",
      );
      await ctx.licences.connect(ctx.adminA).suspendLicence(ctx.student.address);
      expect(await ctx.licences.licenceStatus(ctx.student.address)).to.equal(EffectiveStatus.Suspended);
      await ctx.licences.connect(ctx.adminA).revokeLicence(ctx.student.address);
      expect(await ctx.licences.licenceStatus(ctx.student.address)).to.equal(EffectiveStatus.Revoked);
      await expect(ctx.licences.connect(ctx.adminA).revokeLicence(ctx.student.address)).to.be.revertedWithCustomError(
        ctx.licences,
        "InvalidTransition",
      );
    });

    it("if the consortium suspends the issuing authority, its licences show AuthoritySuspended", async () => {
      const ctx = await loadFixture(deployFixture);
      await buildLogbookForA(ctx);
      await ctx.licences.connect(ctx.adminA).issueLicence(ctx.student.address);

      await ctx.authorities
        .connect(ctx.adminB)
        .proposeAuthority("Authority C", ctx.adminC.address, { ...RULES_A, minTotalMinutes: 50 * HOUR });
      await ctx.authorities.connect(ctx.adminA).vote(1);
      await ctx.authorities.connect(ctx.adminB).proposeSuspension(1);
      await ctx.authorities.connect(ctx.adminC).vote(2);

      expect(await ctx.licences.licenceStatus(ctx.student.address)).to.equal(EffectiveStatus.AuthoritySuspended);
    });
  });

  describe("cross-border validation", () => {
    async function licensedWithValidationRequest() {
      const ctx = await deployFixture();
      await buildLogbookForA(ctx);
      await ctx.licences.connect(ctx.adminA).issueLicence(ctx.student.address);
      await ctx.licences.connect(ctx.student).requestValidation(2);
      return ctx;
    }

    it("the foreign authority can only approve when the logbook meets ITS rules", async () => {
      const ctx = await loadFixture(licensedWithValidationRequest);
      await expect(ctx.licences.connect(ctx.adminB).decideValidation(ctx.student.address, 2, true))
        .to.be.revertedWithCustomError(ctx.licences, "NotEligible")
        .withArgs(ctx.student.address, 2, Ineligibility.TotalTooLow);

      await completeFlight(ctx, { minutes: 300 }); // 5 more hours -> 45h
      await expect(ctx.licences.connect(ctx.adminB).decideValidation(ctx.student.address, 2, true))
        .to.emit(ctx.licences, "ValidationDecided")
        .withArgs(ctx.student.address, 2, true);
      expect(await ctx.licences.validationStatus(ctx.student.address, 2)).to.equal(EffectiveValidation.Valid);
    });

    it("lazy validity: suspending the home licence flags every foreign validation at no extra cost", async () => {
      const ctx = await loadFixture(licensedWithValidationRequest);
      await completeFlight(ctx, { minutes: 300 });
      await ctx.licences.connect(ctx.adminB).decideValidation(ctx.student.address, 2, true);

      await ctx.licences.connect(ctx.adminA).suspendLicence(ctx.student.address);
      expect(await ctx.licences.validationStatus(ctx.student.address, 2)).to.equal(
        EffectiveValidation.HomeLicenceInactive,
      );
      await ctx.licences.connect(ctx.adminA).reinstateLicence(ctx.student.address);
      expect(await ctx.licences.validationStatus(ctx.student.address, 2)).to.equal(EffectiveValidation.Valid);
    });

    it("rejects invalid requests and decisions", async () => {
      const ctx = await loadFixture(licensedWithValidationRequest);
      await expect(ctx.licences.connect(ctx.student).requestValidation(1)).to.be.revertedWithCustomError(
        ctx.licences,
        "SameAuthority",
      );
      await expect(ctx.licences.connect(ctx.student).requestValidation(2)).to.be.revertedWithCustomError(
        ctx.licences,
        "ValidationExists",
      );
      await expect(ctx.licences.connect(ctx.student2).requestValidation(2))
        .to.be.revertedWithCustomError(ctx.licences, "LicenceNotActive")
        .withArgs(ctx.student2.address);
      await expect(ctx.licences.connect(ctx.adminA).decideValidation(ctx.student.address, 2, true))
        .to.be.revertedWithCustomError(ctx.licences, "NotAuthorityAdmin")
        .withArgs(2, ctx.adminA.address);
    });

    it("a rejected pilot may ask again; an approval can be withdrawn", async () => {
      const ctx = await loadFixture(licensedWithValidationRequest);
      await ctx.licences.connect(ctx.adminB).decideValidation(ctx.student.address, 2, false);
      expect(await ctx.licences.validationStatus(ctx.student.address, 2)).to.equal(EffectiveValidation.Rejected);

      await completeFlight(ctx, { minutes: 300 });
      await ctx.licences.connect(ctx.student).requestValidation(2);
      await ctx.licences.connect(ctx.adminB).decideValidation(ctx.student.address, 2, true);
      await expect(ctx.licences.connect(ctx.adminB).withdrawValidation(ctx.student.address, 2))
        .to.emit(ctx.licences, "ValidationWithdrawn")
        .withArgs(ctx.student.address, 2);
      expect(await ctx.licences.validationStatus(ctx.student.address, 2)).to.equal(EffectiveValidation.Rejected);
    });
  });
});
