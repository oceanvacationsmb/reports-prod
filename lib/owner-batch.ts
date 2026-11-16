export type BatchOwner = {
  _id?: string;
  id?: string;
  name: string;
  email?: string;
};

export type BatchRecipient = {
  ownerId: string;
  name: string;
  email: string;
  included: boolean;
  reason?: string;
};

export function isBatchOwner(name: string) {
  return name.trim().toLowerCase() !== "all properties";
}

export function batchRecipients(owners: BatchOwner[]): BatchRecipient[] {
  return owners
    .filter((owner) => isBatchOwner(owner.name))
    .map((owner) => {
      const email = (owner.email || "").trim();
      return {
        ownerId: String(owner._id || owner.id || ""),
        name: owner.name,
        email,
        included: Boolean(email),
        reason: email ? undefined : "No email address"
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function batchConfirmCopy(monthLabel: string, recipients: BatchRecipient[]) {
  const count = recipients.filter((recipient) => recipient.included).length;
  const statements = count === 1 ? "statement" : "statements";
  return {
    title: `${monthLabel} recipients`,
    detail: "Owners without an email address are skipped.",
    confirmTitle: `Lock ${count} ${statements} and open Gmail?`,
    confirmDetail: "Locking cannot be undone. Nothing is sent until you press Send in Gmail.",
    confirmButton: `Lock ${count} ${statements} and open Gmail`
  };
}

export function nextTransferDate(year: number, month: number) {
  return new Date(year, month, 5).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function statementEmailDraft(input: { email: string; periodLabel: string; shareUrl: string; transferDate: string }) {
  return {
    to: input.email,
    subject: "Your Ocean Vacations Statement is Ready",
    message: `Hi,\n\nHere is your statement for ${input.periodLabel}.\nThe transfer will be processed on ${input.transferDate}.\n\nThank you,\nOcean Vacations.`,
    reportLink: input.shareUrl
  };
}

export function gmailComposeUrl(draft: { to: string; subject: string; message: string; reportLink: string }) {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: draft.to,
    su: draft.subject,
    body: `${draft.message}\n\nReport link:\n${draft.reportLink}`
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function ownerBatchPrintDocument(sections: Array<{ title: string; html: string }>) {
  const pages = sections
    .map(
      (section) =>
        `<section class="batch-print-page"><h1 class="batch-print-label">${escapeHtml(section.title)}</h1>${section.html}</section>`
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Owner statements</title></head><body>${pages}</body></html>`;
}
