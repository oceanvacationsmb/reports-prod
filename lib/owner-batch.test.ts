import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  batchConfirmCopy,
  batchRecipients,
  gmailComposeUrl,
  ownerBatchPrintDocument,
  statementEmailDraft
} from "@/lib/owner-batch";

describe("owner batch", () => {
  const owners = [
    { _id: "all", name: "ALL PROPERTIES", email: "" },
    { _id: "nicole", name: "1463 - NICOLE", email: "nwood112@gmail.com" },
    { _id: "blank", name: "MARON INVESTMENTS LLC", email: "  " },
    { _id: "jeff", name: "827B - Jeff", email: "jeff@example.com" }
  ];

  it("previews every real owner and leaves out anyone without an email", () => {
    const recipients = batchRecipients(owners);
    assert.deepEqual(
      recipients.map((recipient) => [recipient.name, recipient.included]),
      [
        ["1463 - NICOLE", true],
        ["827B - Jeff", true],
        ["MARON INVESTMENTS LLC", false]
      ]
    );
    assert.equal(recipients.some((recipient) => recipient.name === "ALL PROPERTIES"), false);
    const copy = batchConfirmCopy("October", recipients);
    assert.equal(copy.confirmButton, "Lock 2 statements and open Gmail");
    assert.match(copy.confirmDetail, /Locking cannot be undone/);
    assert.match(copy.confirmDetail, /Nothing is sent until you press Send in Gmail/);
  });

  it("builds one Gmail draft per locked share link", () => {
    const draft = statementEmailDraft({
      email: "nwood112@gmail.com",
      periodLabel: "October 1 - October 31, 2026",
      shareUrl: "https://reports.example/share/abc",
      transferDate: "November 5, 2026"
    });
    const url = gmailComposeUrl(draft);
    assert.equal(draft.to, "nwood112@gmail.com");
    assert.ok(url.includes("nwood112%40gmail.com"));
    assert.ok(url.includes("share%2Fabc") || url.includes("share/abc"));
  });

  it("prints each statement and the summary as separate pages", () => {
    const html = ownerBatchPrintDocument([
      { title: "1463 - NICOLE", html: "<article>Nicole statement</article>" },
      { title: "Owner summary", html: "<article>Summary</article>" }
    ]);
    assert.equal(html.split("batch-print-page").length - 1, 2);
    assert.ok(html.includes("Nicole statement"));
    assert.ok(html.includes("Summary"));
  });
});
