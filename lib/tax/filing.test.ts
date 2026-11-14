import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCanApprove,
  filingAfterExecutor,
  preparePortalFiling,
  stubFilingExecutor
} from "@/lib/tax/filing";

describe("filing approval gate", () => {
  it("prepares exact property amounts, including zeros, and withholds payment at zero", () => {
    const draft = preparePortalFiling({
      portalId: "myrtleBeach",
      year: 2026,
      month: 4,
      lines: [
        { property: "Open", grossReceipts: 0, taxesCollected: 0 },
        { property: "Closed", grossReceipts: 0, taxesCollected: 0 }
      ]
    });
    assert.equal(draft.paymentRequired, false);
    assert.match(draft.paymentNote, /No payment/);
    assert.equal(draft.lines.length, 2);
  });

  it("does not file when the stub executor runs after approval", async () => {
    const draft = preparePortalFiling({
      portalId: "mydorway",
      year: 2026,
      month: 4,
      lines: [{ property: "House", grossReceipts: 100, taxesCollected: 7 }]
    });
    assert.equal(draft.paymentRequired, true);
    assert.doesNotThrow(() => assertCanApprove("prepared"));
    assert.throws(() => assertCanApprove("filed"));
    const result = await stubFilingExecutor.submit(draft);
    const applied = filingAfterExecutor(result);
    assert.equal(result.submitted, false);
    assert.equal(applied.status, "approved_not_submitted");
    assert.equal(applied.confirmationId, "");
    assert.match(applied.message, /nothing was filed/i);
  });

  it("stores a confirmation only when an executor actually submits", () => {
    const applied = filingAfterExecutor({ submitted: true, confirmationId: "ABC123", message: "Filed." });
    assert.equal(applied.status, "filed");
    assert.equal(applied.confirmationId, "ABC123");
  });
});
