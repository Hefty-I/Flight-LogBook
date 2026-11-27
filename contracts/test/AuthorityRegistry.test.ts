import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, RULES_A, RULES_B, HOUR, DAY } from "./helpers";

const RULES_C = { ...RULES_A, minTotalMinutes: 50 * HOUR };

describe("AuthorityRegistry", () => {
  describe("founding authorities", () => {
    it("stores the founding authorities and their rules", async () => {
      const { authorities, adminA, adminB } = await loadFixture(deployFixture);
      expect(await authorities.authorityCount()).to.equal(2);
      expect(await authorities.activeAuthorityCount()).to.equal(2);
      const [name, admin, active, rules] = await authorities.getAuthority(1);
      expect(name).to.equal("Authority A (FAA-style rules)");
      expect(admin).to.equal(adminA.address);
      expect(active).to.equal(true);
      expect(rules.minTotalMinutes).to.equal(RULES_A.minTotalMinutes);
      expect(await authorities.adminOf(adminB.address)).to.equal(2);
    });

    it("rejects founding authorities after genesis is sealed", async () => {
      const { authorities, adminC } = await loadFixture(deployFixture);
      await expect(
        authorities.addFoundingAuthority("Late", adminC.address, RULES_C),
      ).to.be.revertedWithCustomError(authorities, "GenesisAlreadySealed");
    });

    it("only the deployer can add founding authorities", async () => {
      const { authorities, outsider, adminC } = await loadFixture(deployFixture);
      await expect(
        authorities.connect(outsider).addFoundingAuthority("X", adminC.address, RULES_C),
      ).to.be.revertedWithCustomError(authorities, "AccessControlUnauthorizedAccount");
    });

    it("after sealing, the deployer has no say in membership", async () => {
      const { authorities, deployer, adminC } = await loadFixture(deployFixture);
      await expect(
        authorities.connect(deployer).proposeAuthority("C", adminC.address, RULES_C),
      ).to.be.revertedWithCustomError(authorities, "NotActiveAuthorityAdmin");
    });
  });

  describe("rule validation", () => {
    it("accepts exactly the ICAO 40h floor and rejects 1 minute less", async () => {
      const { authorities, adminA } = await loadFixture(deployFixture);
      await expect(authorities.connect(adminA).updateRules(1, { ...RULES_A, minTotalMinutes: 40 * HOUR })).to.emit(
        authorities,
        "RulesUpdated",
      );
      await expect(authorities.connect(adminA).updateRules(1, { ...RULES_A, minTotalMinutes: 40 * HOUR - 1 }))
        .to.be.revertedWithCustomError(authorities, "RulesBelowIcaoMinimum")
        .withArgs(40 * HOUR - 1);
    });

    it("rejects self-contradicting rules", async () => {
      const { authorities, adminA } = await loadFixture(deployFixture);
      await expect(
        authorities.connect(adminA).updateRules(1, { ...RULES_A, minVerifiedBps: 10_001 }),
      ).to.be.revertedWithCustomError(authorities, "InvalidRules");
      await expect(
        authorities.connect(adminA).updateRules(1, { ...RULES_A, minDualMinutes: 35 * HOUR, minSoloMinutes: 10 * HOUR }),
      ).to.be.revertedWithCustomError(authorities, "InvalidRules");
    });

    it("an authority cannot change another authority's rules", async () => {
      const { authorities, adminB } = await loadFixture(deployFixture);
      await expect(authorities.connect(adminB).updateRules(1, RULES_B)).to.be.revertedWithCustomError(
        authorities,
        "NotActiveAuthorityAdmin",
      );
    });
  });

  describe("consortium vote to add an authority", () => {
    it("needs a strict majority: 1 of 2 is not enough, 2 of 2 executes", async () => {
      const { authorities, adminA, adminB, adminC } = await loadFixture(deployFixture);
      await expect(authorities.connect(adminA).proposeAuthority("Authority C", adminC.address, RULES_C))
        .to.emit(authorities, "VoteCast")
        .withArgs(1, 1, 1);
      expect(await authorities.authorityCount()).to.equal(2);

      await expect(authorities.connect(adminB).vote(1))
        .to.emit(authorities, "AuthorityAdded")
        .withArgs(3, "Authority C", adminC.address);
      expect(await authorities.isActiveAdmin(3, adminC.address)).to.equal(true);
      expect(await authorities.activeAuthorityCount()).to.equal(3);
    });

    it("rejects double votes, outsiders and votes after the deadline", async () => {
      const { authorities, adminA, adminB, adminC, outsider } = await loadFixture(deployFixture);
      await authorities.connect(adminA).proposeAuthority("Authority C", adminC.address, RULES_C);
      await expect(authorities.connect(adminA).vote(1))
        .to.be.revertedWithCustomError(authorities, "AlreadyVoted")
        .withArgs(1, 1);
      await expect(authorities.connect(outsider).vote(1)).to.be.revertedWithCustomError(
        authorities,
        "NotActiveAuthorityAdmin",
      );
      await time.increase(7 * DAY + 1);
      await expect(authorities.connect(adminB).vote(1))
        .to.be.revertedWithCustomError(authorities, "ProposalClosed")
        .withArgs(1);
    });

    it("rejects proposals for a wallet that already runs an authority", async () => {
      const { authorities, adminA, adminB } = await loadFixture(deployFixture);
      await expect(authorities.connect(adminA).proposeAuthority("Dup", adminB.address, RULES_C))
        .to.be.revertedWithCustomError(authorities, "AlreadyAdmin")
        .withArgs(adminB.address);
    });
  });

  describe("consortium vote to suspend a rogue authority", () => {
    it("suspends B with votes from A and C; B then loses all powers", async () => {
      const { authorities, registry, adminA, adminB, adminC, outsider } = await loadFixture(deployFixture);
      await authorities.connect(adminA).proposeAuthority("Authority C", adminC.address, RULES_C);
      await authorities.connect(adminB).vote(1);

      await authorities.connect(adminA).proposeSuspension(2);
      await expect(authorities.connect(adminC).vote(2)).to.emit(authorities, "AuthoritySuspended").withArgs(2);
      expect(await authorities.isActive(2)).to.equal(false);
      expect(await authorities.activeAuthorityCount()).to.equal(2);

      await expect(registry.connect(adminB).registerSchool(2, outsider.address))
        .to.be.revertedWithCustomError(registry, "NotAuthorityAdmin")
        .withArgs(2, adminB.address);
    });

    it("an authority cannot propose suspending itself", async () => {
      const { authorities, adminA } = await loadFixture(deployFixture);
      await expect(authorities.connect(adminA).proposeSuspension(1)).to.be.revertedWithCustomError(
        authorities,
        "CannotTargetOwnAuthority",
      );
    });
  });

  describe("admin key rotation", () => {
    it("moves the authority to a new wallet", async () => {
      const { authorities, adminA, outsider } = await loadFixture(deployFixture);
      await authorities.connect(adminA).transferAuthorityAdmin(1, outsider.address);
      expect(await authorities.isActiveAdmin(1, outsider.address)).to.equal(true);
      expect(await authorities.isActiveAdmin(1, adminA.address)).to.equal(false);
      expect(await authorities.adminOf(adminA.address)).to.equal(0);
    });
  });
});
