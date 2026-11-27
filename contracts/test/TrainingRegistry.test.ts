import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, icao, reg } from "./helpers";

describe("TrainingRegistry", () => {
  it("stores schools, aircraft and people", async () => {
    const { registry, schoolAdmin, student, instructor } = await loadFixture(deployFixture);
    expect(await registry.schoolAuthority(1)).to.equal(1);
    expect(await registry.schoolAdminOf(schoolAdmin.address)).to.equal(1);
    expect(await registry.studentSchool(student.address)).to.equal(1);
    expect(await registry.instructorSchool(instructor.address)).to.equal(1);
    const ac = await registry.aircraftInfo(1);
    expect(ac.icao24).to.equal(icao("3c6444"));
    expect(ac.adsbEquipped).to.equal(true);
    expect(await registry.aircraftByIcao24(icao("3c6444"))).to.equal(1);
  });

  describe("authority scope (one country cannot touch another's records)", () => {
    it("authority B cannot register a school under authority A", async () => {
      const { registry, adminB, outsider } = await loadFixture(deployFixture);
      await expect(registry.connect(adminB).registerSchool(1, outsider.address))
        .to.be.revertedWithCustomError(registry, "NotAuthorityAdmin")
        .withArgs(1, adminB.address);
    });

    it("authority B cannot register or revoke instructors of A's school", async () => {
      const { registry, adminB, outsider, instructor } = await loadFixture(deployFixture);
      await expect(registry.connect(adminB).registerInstructor(1, outsider.address)).to.be.revertedWithCustomError(
        registry,
        "NotAuthorityAdmin",
      );
      await expect(registry.connect(adminB).revokeInstructor(instructor.address)).to.be.revertedWithCustomError(
        registry,
        "NotAuthorityAdmin",
      );
    });

    it("a school cannot register instructors itself (separation of duties)", async () => {
      const { registry, schoolAdmin, outsider } = await loadFixture(deployFixture);
      await expect(registry.connect(schoolAdmin).registerInstructor(1, outsider.address)).to.be.revertedWithCustomError(
        registry,
        "NotAuthorityAdmin",
      );
    });
  });

  describe("one wallet, one role", () => {
    it("an instructor cannot also be registered as a student", async () => {
      const { registry, schoolAdmin, instructor } = await loadFixture(deployFixture);
      await expect(registry.connect(schoolAdmin).registerStudent(instructor.address))
        .to.be.revertedWithCustomError(registry, "AddressAlreadyRegistered")
        .withArgs(instructor.address);
    });

    it("an authority admin cannot become a student", async () => {
      const { registry, schoolAdmin, adminA } = await loadFixture(deployFixture);
      await expect(registry.connect(schoolAdmin).registerStudent(adminA.address)).to.be.revertedWithCustomError(
        registry,
        "AddressAlreadyRegistered",
      );
    });
  });

  describe("aircraft", () => {
    it("rejects a duplicate or empty ICAO24 address", async () => {
      const { registry, schoolAdmin, schoolAdminB } = await loadFixture(deployFixture);
      await expect(registry.connect(schoolAdminB).registerAircraft(icao("3c6444"), reg("X"), true))
        .to.be.revertedWithCustomError(registry, "Icao24AlreadyRegistered")
        .withArgs(icao("3c6444"));
      await expect(
        registry.connect(schoolAdmin).registerAircraft("0x000000", reg("X"), true),
      ).to.be.revertedWithCustomError(registry, "InvalidIcao24");
    });

    it("only the owning school can deactivate its aircraft", async () => {
      const { registry, schoolAdmin, schoolAdminB } = await loadFixture(deployFixture);
      await expect(registry.connect(schoolAdminB).setAircraftActive(1, false)).to.be.revertedWithCustomError(
        registry,
        "NotSchoolAdmin",
      );
      await expect(registry.connect(schoolAdmin).setAircraftActive(1, false))
        .to.emit(registry, "AircraftStatusChanged")
        .withArgs(1, false);
    });
  });

  describe("school status", () => {
    it("a deactivated school cannot register students", async () => {
      const { registry, adminA, schoolAdmin, outsider } = await loadFixture(deployFixture);
      await registry.connect(adminA).setSchoolActive(1, false);
      await expect(registry.connect(schoolAdmin).registerStudent(outsider.address))
        .to.be.revertedWithCustomError(registry, "SchoolInactive")
        .withArgs(1);
    });

    it("outsiders cannot register students", async () => {
      const { registry, outsider, student2 } = await loadFixture(deployFixture);
      await expect(registry.connect(outsider).registerStudent(student2.address)).to.be.revertedWithCustomError(
        registry,
        "NotSchoolAdmin",
      );
    });
  });

  it("revoking an instructor records the status change", async () => {
    const { registry, adminA, instructor } = await loadFixture(deployFixture);
    await expect(registry.connect(adminA).revokeInstructor(instructor.address))
      .to.emit(registry, "InstructorRevoked")
      .withArgs(instructor.address, 1, 1);
    expect(await registry.instructorStatus(instructor.address)).to.equal(2);
    await expect(registry.connect(adminA).revokeInstructor(instructor.address)).to.be.revertedWithCustomError(
      registry,
      "InstructorAlreadyRevoked",
    );
  });
});
