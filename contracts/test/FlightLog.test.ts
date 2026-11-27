import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import {
  deployFixture,
  logFlight,
  completeFlight,
  apt,
  icao,
  FLAG,
  Status,
  OracleResult,
  EVIDENCE,
  EVIDENCE_URI,
  DAY,
} from "./helpers";

describe("FlightLog", () => {
  describe("normal flow", () => {
    it("log -> sign -> verified, and the running totals update", async () => {
      const { flightLog, student, instructor, oracle } = await loadFixture(deployFixture);
      const { id } = await logFlight(flightLog, student, { minutes: 90, flags: FLAG.XC });
      expect((await flightLog.getFlight(id)).status).to.equal(Status.Logged);

      await expect(flightLog.connect(instructor).signFlight(id))
        .to.emit(flightLog, "FlightSigned")
        .withArgs(
          id,
          instructor.address,
          student.address,
          icao("3c6444"),
          true,
          (await flightLog.getFlight(id)).departureTime,
          90,
          apt("EDDF"),
          apt("EDDS"),
        );

      await expect(
        flightLog.connect(oracle).submitVerification(id, OracleResult.Match, EVIDENCE, EVIDENCE_URI),
      )
        .to.emit(flightLog, "FlightCounted")
        .withArgs(id, student.address, 90, true);

      const t = await flightLog.totalsOf(student.address);
      expect(t.total).to.equal(90);
      expect(t.dual).to.equal(90);
      expect(t.crossCountry).to.equal(90);
      expect(t.verified).to.equal(90);
      expect(await flightLog.minutesWith(student.address, instructor.address)).to.equal(90);
    });

    it("solo and night flags go to the right totals", async () => {
      const ctx = await loadFixture(deployFixture);
      await completeFlight(ctx, { minutes: 60, flags: FLAG.SOLO | FLAG.NIGHT });
      const t = await ctx.flightLog.totalsOf(ctx.student.address);
      expect(t.solo).to.equal(60);
      expect(t.dual).to.equal(0);
      expect(t.night).to.equal(60);
    });

    it("an instructor can sign several flights in one transaction", async () => {
      const { flightLog, student, instructor } = await loadFixture(deployFixture);
      const ids: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        const now = await time.latest();
        const { id } = await logFlight(flightLog, student, { minutes: 60, departure: now - (3 - i) * 7200 - 3600 });
        ids.push(id);
      }
      await flightLog.connect(instructor).signFlights(ids);
      for (const id of ids) expect((await flightLog.getFlight(id)).status).to.equal(Status.Signed);
      await expect(flightLog.connect(instructor).signFlights([])).to.be.revertedWithCustomError(flightLog, "EmptyBatch");
    });
  });

  describe("input checks and boundaries", () => {
    it("duration: 1 and 720 minutes are fine, 0 and 721 are rejected", async () => {
      const { flightLog, student, student2 } = await loadFixture(deployFixture);
      await logFlight(flightLog, student, { minutes: 720 });
      await logFlight(flightLog, student2, { minutes: 1, aircraftId: 2 });
      await expect(logFlight(flightLog, student, { minutes: 0, aircraftId: 2 }))
        .to.be.revertedWithCustomError(flightLog, "InvalidDuration")
        .withArgs(0);
      await expect(logFlight(flightLog, student, { minutes: 721, aircraftId: 2 }))
        .to.be.revertedWithCustomError(flightLog, "InvalidDuration")
        .withArgs(721);
    });

    it("rejects unknown flags, empty airports and fake cross-country flights", async () => {
      const { flightLog, student } = await loadFixture(deployFixture);
      await expect(logFlight(flightLog, student, { minutes: 60, flags: 8 })).to.be.revertedWithCustomError(
        flightLog,
        "InvalidFlags",
      );
      const now = await time.latest();
      await expect(
        flightLog.connect(student).logFlight(1, now - 7200, 60, "0x00000000", apt("EDDF"), 0),
      ).to.be.revertedWithCustomError(flightLog, "InvalidAirport");
      await expect(
        logFlight(flightLog, student, { minutes: 60, flags: FLAG.XC, from: "EDDF", to: "EDDF" }),
      ).to.be.revertedWithCustomError(flightLog, "CrossCountryNeedsDifferentAirports");
    });

    it("rejects a flight that has not landed yet", async () => {
      const { flightLog, student } = await loadFixture(deployFixture);
      const now = await time.latest();
      await expect(logFlight(flightLog, student, { minutes: 60, departure: now })).to.be.revertedWithCustomError(
        flightLog,
        "FlightNotFinished",
      );
    });

    it("must be logged within 3 days of landing (exactly 3 days is still fine)", async () => {
      const { flightLog, student, student2 } = await loadFixture(deployFixture);
      const now = await time.latest();
      const dep = now - 3600 - 600;
      const landing = dep + 3600;
      await time.setNextBlockTimestamp(landing + 3 * DAY);
      await logFlight(flightLog, student, { minutes: 60, departure: dep });

      const dep2 = (await time.latest()) - 3600 - 600;
      await time.setNextBlockTimestamp(dep2 + 3600 + 3 * DAY + 1);
      await expect(
        logFlight(flightLog, student2, { minutes: 60, departure: dep2, aircraftId: 2 }),
      ).to.be.revertedWithCustomError(flightLog, "LoggedTooLate");
    });

    it("rejects strangers and aircraft from another school", async () => {
      const { flightLog, student, outsider } = await loadFixture(deployFixture);
      await expect(logFlight(flightLog, outsider, { minutes: 60 }))
        .to.be.revertedWithCustomError(flightLog, "NotRegisteredStudent")
        .withArgs(outsider.address);
      await expect(logFlight(flightLog, student, { minutes: 60, aircraftId: 3 }))
        .to.be.revertedWithCustomError(flightLog, "AircraftNotInSchool")
        .withArgs(3);
    });

    it("rejects a deactivated aircraft", async () => {
      const { flightLog, registry, schoolAdmin, student } = await loadFixture(deployFixture);
      await registry.connect(schoolAdmin).setAircraftActive(1, false);
      await expect(logFlight(flightLog, student, { minutes: 60 })).to.be.revertedWithCustomError(
        flightLog,
        "AircraftUnavailable",
      );
    });
  });

  describe("time-slot protection", () => {
    it("allows back-to-back flights on the same aircraft (times rounded to 10-minute slots)", async () => {
      const { flightLog, student, student2 } = await loadFixture(deployFixture);
      const now = await time.latest();
      const dep1 = Math.floor((now - 4 * 3600) / 600) * 600; // aligned to a 10-minute slot
      await logFlight(flightLog, student, { minutes: 60, departure: dep1 });
      await logFlight(flightLog, student2, { minutes: 60, departure: dep1 + 3600 });
    });

    it("one student cannot be in two aircraft at once", async () => {
      const { flightLog, student } = await loadFixture(deployFixture);
      const now = await time.latest();
      const dep = now - 4 * 3600;
      await logFlight(flightLog, student, { minutes: 60, departure: dep, aircraftId: 1 });
      await expect(logFlight(flightLog, student, { minutes: 60, departure: dep + 1800, aircraftId: 2 }))
        .to.be.revertedWithCustomError(flightLog, "StudentBusy")
        .withArgs(student.address);
    });

    it("handles a flight that crosses midnight (UTC)", async () => {
      const { flightLog, student, student2 } = await loadFixture(deployFixture);
      const now = await time.latest();
      const midnight = Math.floor((now - 3 * 3600) / DAY) * DAY; // a UTC midnight at least 3h ago
      await logFlight(flightLog, student, { minutes: 120, departure: midnight - 3600 });
      // overlaps the part after midnight
      await expect(
        logFlight(flightLog, student2, { minutes: 30, departure: midnight + 1200 }),
      ).to.be.revertedWithCustomError(flightLog, "AircraftBusy");
      // overlaps the part before midnight
      await expect(
        logFlight(flightLog, student2, { minutes: 30, departure: midnight - 1800 }),
      ).to.be.revertedWithCustomError(flightLog, "AircraftBusy");
    });
  });

  describe("signing", () => {
    it("only an active instructor of the same school can sign", async () => {
      const { flightLog, student, instructorB, outsider, registry, adminA, instructor } =
        await loadFixture(deployFixture);
      const { id } = await logFlight(flightLog, student, { minutes: 60 });
      await expect(flightLog.connect(outsider).signFlight(id))
        .to.be.revertedWithCustomError(flightLog, "InstructorNotActive")
        .withArgs(outsider.address);
      await expect(flightLog.connect(instructorB).signFlight(id))
        .to.be.revertedWithCustomError(flightLog, "InstructorWrongSchool")
        .withArgs(instructorB.address, id);
      await registry.connect(adminA).revokeInstructor(instructor.address);
      await expect(flightLog.connect(instructor).signFlight(id)).to.be.revertedWithCustomError(
        flightLog,
        "InstructorNotActive",
      );
    });

    it("cannot sign twice, or after the 7-day window", async () => {
      const { flightLog, student, instructor } = await loadFixture(deployFixture);
      const { id, departure } = await logFlight(flightLog, student, { minutes: 60 });
      await flightLog.connect(instructor).signFlight(id);
      await expect(flightLog.connect(instructor).signFlight(id))
        .to.be.revertedWithCustomError(flightLog, "WrongStatus")
        .withArgs(id, Status.Signed);

      const { id: id2, departure: dep2 } = await logFlight(flightLog, student, {
        minutes: 60,
        departure: departure - 3 * 3600,
        aircraftId: 2,
      });
      await time.setNextBlockTimestamp(dep2 + 7 * DAY + 1);
      await expect(flightLog.connect(instructor).signFlight(id2))
        .to.be.revertedWithCustomError(flightLog, "SignWindowClosed")
        .withArgs(id2);
    });
  });

  describe("oracle", () => {
    it("only the oracle can submit results", async () => {
      const { flightLog, student, instructor, outsider } = await loadFixture(deployFixture);
      const { id } = await logFlight(flightLog, student, { minutes: 60 });
      await flightLog.connect(instructor).signFlight(id);
      await expect(
        flightLog.connect(outsider).submitVerification(id, OracleResult.Match, EVIDENCE, EVIDENCE_URI),
      ).to.be.revertedWithCustomError(flightLog, "AccessControlUnauthorizedAccount");
    });

    it("requires evidence and a signed flight", async () => {
      const { flightLog, student, instructor, oracle } = await loadFixture(deployFixture);
      const { id } = await logFlight(flightLog, student, { minutes: 60 });
      await expect(
        flightLog.connect(oracle).submitVerification(id, OracleResult.Match, EVIDENCE, EVIDENCE_URI),
      )
        .to.be.revertedWithCustomError(flightLog, "WrongStatus")
        .withArgs(id, Status.Logged);
      await flightLog.connect(instructor).signFlight(id);
      await expect(
        flightLog.connect(oracle).submitVerification(id, OracleResult.Match, ethers.ZeroHash, ""),
      ).to.be.revertedWithCustomError(flightLog, "MissingEvidence");
    });

    it("NoData on an untracked aircraft counts as Attested, not verified", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await completeFlight(ctx, { minutes: 60, aircraftId: 2, result: OracleResult.NoData });
      expect((await ctx.flightLog.getFlight(id)).status).to.equal(Status.Attested);
      const t = await ctx.flightLog.totalsOf(ctx.student.address);
      expect(t.total).to.equal(60);
      expect(t.verified).to.equal(0);
    });

    it("a mismatch does not count", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await completeFlight(ctx, { minutes: 60, result: OracleResult.Mismatch });
      expect((await ctx.flightLog.getFlight(id)).status).to.equal(Status.Mismatch);
      expect((await ctx.flightLog.totalsOf(ctx.student.address)).total).to.equal(0);
    });

    it("if the oracle is silent for 14 days the student can fall back to Attested", async () => {
      const { flightLog, student, student2, instructor } = await loadFixture(deployFixture);
      const { id, departure } = await logFlight(flightLog, student, { minutes: 60 });
      await flightLog.connect(instructor).signFlight(id);

      await time.setNextBlockTimestamp(departure + 14 * DAY);
      await expect(flightLog.connect(student).claimOracleTimeout(id))
        .to.be.revertedWithCustomError(flightLog, "OracleTimeoutNotReached")
        .withArgs(id);
      await expect(flightLog.connect(student2).claimOracleTimeout(id)).to.be.revertedWithCustomError(
        flightLog,
        "NotFlightStudent",
      );
      await flightLog.connect(student).claimOracleTimeout(id);
      expect((await flightLog.getFlight(id)).status).to.equal(Status.Attested);
    });
  });

  describe("disputes", () => {
    it("student disputes a mismatch; the home authority accepts it", async () => {
      const ctx = await loadFixture(deployFixture);
      const { flightLog, student, adminA, adminB } = ctx;
      const id = await completeFlight(ctx, { minutes: 60, result: OracleResult.Mismatch });
      const reason = ethers.keccak256(ethers.toUtf8Bytes("ATC radar printout"));

      await flightLog.connect(student).openDispute(id, reason, "ipfs://reason");
      expect((await flightLog.getFlight(id)).status).to.equal(Status.Disputed);

      await expect(flightLog.connect(adminB).resolveDispute(id, true))
        .to.be.revertedWithCustomError(flightLog, "NotAuthorityAdmin")
        .withArgs(1, adminB.address);
      await flightLog.connect(adminA).resolveDispute(id, true);
      expect((await flightLog.getFlight(id)).status).to.equal(Status.Attested);
      expect((await flightLog.totalsOf(student.address)).total).to.equal(60);
    });

    it("disputes close 30 days after departure", async () => {
      const ctx = await loadFixture(deployFixture);
      const id = await completeFlight(ctx, { minutes: 60, result: OracleResult.Mismatch });
      const dep = Number((await ctx.flightLog.getFlight(id)).departureTime);
      await time.setNextBlockTimestamp(dep + 30 * DAY + 1);
      await expect(ctx.flightLog.connect(ctx.student).openDispute(id, EVIDENCE, ""))
        .to.be.revertedWithCustomError(ctx.flightLog, "DisputeWindowClosed")
        .withArgs(id);
    });
  });

  describe("closing dead flights", () => {
    it("an unsigned flight can be closed after 7 days, which frees the aircraft slot", async () => {
      const { flightLog, student, student2, outsider } = await loadFixture(deployFixture);
      const { id, departure } = await logFlight(flightLog, student, { minutes: 60 });

      await expect(flightLog.connect(outsider).closeFlight(id))
        .to.be.revertedWithCustomError(flightLog, "NotClosable")
        .withArgs(id, Status.Logged);

      await time.setNextBlockTimestamp(departure + 7 * DAY + 1);
      await flightLog.connect(outsider).closeFlight(id);
      expect((await flightLog.getFlight(id)).status).to.equal(Status.Closed);
      await expect(flightLog.connect(outsider).closeFlight(id)).to.be.revertedWithCustomError(flightLog, "NotClosable");
      expect(await flightLog.aircraftDayBitmap(1, Math.floor(departure / DAY))).to.equal(0);
    });
  });

  describe("emergency pause", () => {
    it("pausing the AuthorityRegistry stops logging everywhere", async () => {
      const { flightLog, authorities, deployer, student, outsider } = await loadFixture(deployFixture);
      await expect(authorities.connect(outsider).pause()).to.be.revertedWithCustomError(
        authorities,
        "AccessControlUnauthorizedAccount",
      );
      await authorities.connect(deployer).pause();
      await expect(logFlight(flightLog, student, { minutes: 60 })).to.be.revertedWithCustomError(
        flightLog,
        "SystemPaused",
      );
      await authorities.connect(deployer).unpause();
      await logFlight(flightLog, student, { minutes: 60 });
    });
  });
});
