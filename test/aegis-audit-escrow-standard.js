const { expect } = require("chai");
const { ethers } = require("hardhat");

const ZERO_BYTES32 = ethers.ZeroHash;
const AUDIT_ACTION_RELEASE = 0;
const AUDIT_ACTION_BLOCK_AND_CLAIM = 1;

async function expectRevert(promise) {
  let reverted = false;
  try {
    await promise;
  } catch (error) {
    reverted = true;
  }
  expect(reverted).to.equal(true);
}

function auditDecision(escrowId, action, reason = ZERO_BYTES32, evidenceHash = ZERO_BYTES32, actionData = "0x") {
  return {
    escrowId,
    action,
    reason,
    evidenceHash,
    actionData,
  };
}

function findEvent(receipt, contract, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed && parsed.name === eventName) return parsed;
    } catch (error) {
      // Skip logs emitted by other contracts.
    }
  }

  throw new Error(`Missing ${eventName} event`);
}

describe("AEGIS audit-responsive escrow standard", function () {
  async function deployStandardFixture() {
    const [owner, auditAgent, subject, beneficiary, stranger] = await ethers.getSigners();
    const escrow = await ethers.deployContract("MockAuditEscrow", [owner.address, auditAgent.address]);
    await escrow.waitForDeployment();

    return {
      owner,
      auditAgent,
      subject,
      beneficiary,
      stranger,
      escrow,
    };
  }

  it("registers an escrow and executes an authorized audit decision with evidence metadata", async function () {
    const fixture = await deployStandardFixture();
    const escrowId = ethers.id("standard-escrow");
    const policyHash = ethers.id("policy-v1");
    const reason = ethers.encodeBytes32String("CLEAN");
    const evidenceHash = ethers.id("audit-evidence-uri");
    const actionData = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["release"]);

    await fixture.escrow.register(
      escrowId,
      fixture.subject.address,
      fixture.beneficiary.address,
      policyHash,
    );

    expect(await fixture.escrow.escrowStatus(escrowId)).to.equal(1n);

    const tx = await fixture.escrow
      .connect(fixture.auditAgent)
      .executeAuditDecision(auditDecision(escrowId, AUDIT_ACTION_RELEASE, reason, evidenceHash, actionData));
    const receipt = await tx.wait();
    const event = findEvent(receipt, fixture.escrow, "AuditDecisionExecuted");

    expect(event.args.escrowId).to.equal(escrowId);
    expect(event.args.action).to.equal(BigInt(AUDIT_ACTION_RELEASE));
    expect(event.args.reason).to.equal(reason);
    expect(event.args.evidenceHash).to.equal(evidenceHash);
    expect(event.args.auditAgent).to.equal(fixture.auditAgent.address);
    expect(await fixture.escrow.escrowStatus(escrowId)).to.equal(2n);
  });

  it("rejects unauthorized audit decisions", async function () {
    const fixture = await deployStandardFixture();
    const escrowId = ethers.id("unauthorized-standard-escrow");
    await fixture.escrow.register(escrowId, fixture.subject.address, fixture.beneficiary.address, ZERO_BYTES32);

    await expectRevert(
      fixture.escrow
        .connect(fixture.stranger)
        .executeAuditDecision(auditDecision(escrowId, AUDIT_ACTION_RELEASE)),
    );

    expect(await fixture.escrow.escrowStatus(escrowId)).to.equal(1n);
  });

  it("rejects unknown escrow ids and duplicate decisions", async function () {
    const fixture = await deployStandardFixture();
    const escrowId = ethers.id("duplicate-resolution-standard-escrow");

    await expectRevert(
      fixture.escrow
        .connect(fixture.auditAgent)
        .executeAuditDecision(auditDecision(ethers.id("unknown-escrow"), AUDIT_ACTION_BLOCK_AND_CLAIM)),
    );

    await fixture.escrow.register(escrowId, fixture.subject.address, fixture.beneficiary.address, ZERO_BYTES32);
    await fixture.escrow
      .connect(fixture.auditAgent)
      .executeAuditDecision(auditDecision(escrowId, AUDIT_ACTION_BLOCK_AND_CLAIM));

    await expectRevert(
      fixture.escrow
        .connect(fixture.auditAgent)
      .executeAuditDecision(auditDecision(escrowId, AUDIT_ACTION_RELEASE)),
    );
  });

  it("keeps EscrowVault release and payClaim helpers on the standardized resolution path", async function () {
    const [owner, auditAgent, user, beneficiary] = await ethers.getSigners();
    const inputToken = await ethers.deployContract("MockERC20", ["Mock USDT", "USDT", 18]);
    const outputToken = await ethers.deployContract("MockERC20", ["Mock AEGIS", "AEGIS", 18]);
    const insurancePool = await ethers.deployContract("InsurancePool", [owner.address]);
    const vault = await ethers.deployContract("EscrowVault", [owner.address, auditAgent.address, insurancePool.target]);
    await inputToken.waitForDeployment();
    await outputToken.waitForDeployment();
    await insurancePool.waitForDeployment();
    await vault.waitForDeployment();

    await insurancePool.setVault(vault.target);
    await vault.setHook(owner.address);

    const releaseId = ethers.id("helper-release");
    const claimId = ethers.id("helper-claim");
    const inputAmount = ethers.parseEther("100");
    const releaseOutput = ethers.parseEther("90");
    const claimOutput = ethers.parseEther("75");

    await outputToken.mint(vault.target, releaseOutput + claimOutput);
    await inputToken.mint(insurancePool.target, inputAmount);

    await vault.recordEscrow({
      tradeId: releaseId,
      user: user.address,
      inputToken: inputToken.target,
      inputAmount,
      outputToken: outputToken.target,
      outputAmount: releaseOutput,
      settlementRecipient: beneficiary.address,
      expectedOutput: releaseOutput,
    });
    await vault.recordEscrow({
      tradeId: claimId,
      user: user.address,
      inputToken: inputToken.target,
      inputAmount,
      outputToken: outputToken.target,
      outputAmount: claimOutput,
      settlementRecipient: beneficiary.address,
      expectedOutput: claimOutput,
    });

    await vault.connect(auditAgent).release(releaseId);
    const released = await vault.escrows(releaseId);
    expect(released.state).to.equal(2n);
    expect(await vault.escrowStatus(releaseId)).to.equal(2n);
    expect(await outputToken.balanceOf(beneficiary.address)).to.equal(releaseOutput);

    await vault.connect(auditAgent).payClaim(claimId, ethers.encodeBytes32String("SANDWICH"));
    const claimed = await vault.escrows(claimId);
    expect(claimed.state).to.equal(3n);
    expect(await vault.escrowStatus(claimId)).to.equal(2n);
    expect(await inputToken.balanceOf(user.address)).to.equal(inputAmount);
    expect(await outputToken.balanceOf(insurancePool.target)).to.equal(claimOutput);
  });
});
