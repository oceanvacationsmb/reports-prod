import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { etInstant, isLastCalendarDay, sendWindow } from "@/lib/statements/schedule";
import {
  decideStatementDispatch,
  executeDispatch,
  planStatementVersion,
  statementEmail,
  type OwnerStatementState
} from "@/lib/statements/dispatch";
import { buildRawGmailMessage, createGmailSender } from "@/lib/statements/gmail";

const period = { year: 2026, month: 2 };

function owner(overrides: Partial<OwnerStatementState> = {}): OwnerStatementState {
  return {
    ownerId: "a",
    name: "Ada Owner",
    email: "ada@example.com",
    latest: {
      id: "v1",
      version: 1,
      status: "approved_locked",
      contentHash: "hash",
      gmailMessageId: "",
      shareId: "share-a",
      recipient: ""
    },
    ...overrides
  };
}

describe("statement schedule", () => {
  it("uses Eastern Time for the last day and the 1st-through-3rd window", () => {
    assert.equal(etInstant(2026, 3, 1, 0, 0, 0).toISOString(), "2026-03-01T05:00:00.000Z");
    assert.equal(etInstant(2026, 7, 1, 0, 0, 0).toISOString(), "2026-07-01T04:00:00.000Z");
    assert.equal(isLastCalendarDay(etInstant(2026, 2, 28, 22, 0, 0)), true);
    assert.equal(isLastCalendarDay(etInstant(2026, 3, 1, 0, 0, 0)), false);
    const window = sendWindow(2026, 2);
    assert.equal(window.start.toISOString(), "2026-03-01T05:00:00.000Z");
    assert.equal(window.end.toISOString(), "2026-03-04T04:59:59.000Z");
  });
});

describe("statement versions and sending", () => {
  it("keeps an approved link and requires a new version after the numbers change", () => {
    assert.deepEqual(planStatementVersion([], "one"), { action: "create", version: 1 });
    assert.deepEqual(
      planStatementVersion([{ version: 1, status: "approved_locked", contentHash: "one" }], "one"),
      { action: "unchanged", version: 1 }
    );
    assert.deepEqual(
      planStatementVersion([{ version: 1, status: "approved_locked", contentHash: "one" }], "two"),
      { action: "create", version: 2 }
    );
    assert.deepEqual(
      planStatementVersion([{ version: 2, status: "pending", contentHash: "two" }], "three"),
      { action: "replace_pending", version: 2 }
    );
  });

  it("sends inside the window only when every statement is approved, and never twice", async () => {
    const approved = decideStatementDispatch({
      now: etInstant(2026, 3, 2, 12, 0, 0),
      ...period,
      owners: [owner()],
      manualAuthorization: false
    });
    assert.equal(approved.action, "send");
    const pending = decideStatementDispatch({
      now: etInstant(2026, 3, 2, 12, 0, 0),
      ...period,
      owners: [owner(), owner({ ownerId: "b", name: "Bea", latest: { ...owner().latest!, id: "v2", status: "pending" } })],
      manualAuthorization: false
    });
    assert.equal(pending.action, "hold");
    const calls: string[] = [];
    const summary = await executeDispatch(approved, {
      send: async (version) => {
        calls.push(version.versionId);
        return { id: "gmail-1" };
      },
      markSent: async () => undefined,
      markFailed: async () => undefined
    });
    assert.deepEqual(calls, ["v1"]);
    assert.equal(summary.sent[0].gmailMessageId, "gmail-1");
    const again = decideStatementDispatch({
      now: etInstant(2026, 3, 2, 15, 0, 0),
      ...period,
      owners: [owner({ latest: { ...owner().latest!, status: "sent", gmailMessageId: "gmail-1" } })],
      manualAuthorization: false
    });
    assert.equal(again.action, "already_sent");
    const retry = await executeDispatch(again, {
      send: async () => {
        throw new Error("should not send");
      },
      markSent: async () => undefined,
      markFailed: async () => undefined
    });
    assert.equal(retry.sent.length, 0);
  });

  it("sends none at the deadline and waits for the manual button after a late approval", async () => {
    const missed = decideStatementDispatch({
      now: etInstant(2026, 3, 4, 0, 0, 1),
      ...period,
      owners: [owner({ latest: { ...owner().latest!, status: "pending" } })],
      manualAuthorization: false
    });
    assert.equal(missed.action, "deadline_miss");
    if (missed.action === "deadline_miss") {
      assert.equal(missed.message, "No statements were sent by the deadline.");
      assert.deepEqual(missed.waiting.map((item) => item.name), ["Ada Owner"]);
    }
    const late = decideStatementDispatch({
      now: etInstant(2026, 3, 5, 9, 0, 0),
      ...period,
      owners: [owner()],
      manualAuthorization: false
    });
    assert.equal(late.action, "hold_for_manual");
    const authorized = decideStatementDispatch({
      now: etInstant(2026, 3, 5, 9, 0, 0),
      ...period,
      owners: [owner()],
      manualAuthorization: true
    });
    assert.equal(authorized.action, "send");
    const stillWaiting = decideStatementDispatch({
      now: etInstant(2026, 3, 5, 9, 0, 0),
      ...period,
      owners: [owner({ latest: { ...owner().latest!, status: "pending" } })],
      manualAuthorization: true
    });
    assert.equal(stillWaiting.action, "hold");
  });

  it("builds one owner email and does not call Gmail when sending is disabled", async () => {
    const email = statementEmail({
      ownerName: "Ada <Owner>",
      periodLabel: "February 2026",
      shareUrl: "https://reports.oceanvacationsmb.com/share/share-a"
    });
    const raw = Buffer.from(buildRawGmailMessage({ to: "ada@example.com", ...email }), "base64url").toString("utf8");
    assert.match(raw, /To: ada@example.com/);
    assert.match(raw, /share\/share-a/);
    assert.doesNotMatch(raw, /bea@example.com/);
    let called = false;
    const sender = createGmailSender({
      env: { sendEnabled: false, clientId: "id", clientSecret: "secret" },
      refreshToken: "token",
      fetchImpl: async () => {
        called = true;
        throw new Error("network");
      }
    });
    await assert.rejects(() => sender.send({ to: "ada@example.com", ...email }), /disabled/);
    assert.equal(called, false);
  });
});
