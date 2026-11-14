import { sendWindow } from "@/lib/statements/schedule";

export type StatementVersionStatus = "pending" | "approved_locked" | "sending" | "sent";

export type StatementVersionRef = {
  id: string;
  version: number;
  status: StatementVersionStatus;
  contentHash: string;
  gmailMessageId: string;
  shareId: string;
  recipient: string;
};

export type OwnerStatementState = {
  ownerId: string;
  name: string;
  email: string;
  latest: StatementVersionRef | null;
};

export type ReadySend = {
  ownerId: string;
  name: string;
  email: string;
  versionId: string;
  version: number;
  shareId: string;
};

export type DispatchDecision =
  | { action: "too_early" }
  | { action: "hold"; waiting: { ownerId: string; name: string }[]; message: string }
  | { action: "deadline_miss"; waiting: { ownerId: string; name: string }[]; message: string }
  | { action: "hold_for_manual"; message: string }
  | { action: "send"; versions: ReadySend[] }
  | { action: "already_sent" };

export function planStatementVersion(
  existing: { version: number; status: StatementVersionStatus; contentHash: string }[],
  contentHash: string
) {
  const latest = existing.slice().sort((left, right) => right.version - left.version)[0];
  if (!latest) return { action: "create" as const, version: 1 };
  if (latest.contentHash === contentHash) return { action: "unchanged" as const, version: latest.version };
  if (latest.status === "pending") return { action: "replace_pending" as const, version: latest.version };
  return { action: "create" as const, version: latest.version + 1 };
}

export function canApprove(version: { status: StatementVersionStatus }) {
  return version.status === "pending";
}

export function canClaimSend(version: { status: StatementVersionStatus; gmailMessageId?: string }) {
  return version.status === "approved_locked" && !version.gmailMessageId;
}

function waitingOwners(owners: OwnerStatementState[]) {
  return owners
    .filter((owner) => !owner.latest || owner.latest.status === "pending" || owner.latest.status === "sending")
    .map((owner) => ({ ownerId: owner.ownerId, name: owner.name }));
}

function readyOwners(owners: OwnerStatementState[]): ReadySend[] {
  return owners.flatMap((owner) => {
    const version = owner.latest;
    if (!version || !canClaimSend(version) || !version.shareId) return [];
    return [
      {
        ownerId: owner.ownerId,
        name: owner.name,
        email: owner.email.trim(),
        versionId: version.id,
        version: version.version,
        shareId: version.shareId
      }
    ];
  });
}

export function decideStatementDispatch(input: {
  now: Date;
  year: number;
  month: number;
  owners: OwnerStatementState[];
  manualAuthorization: boolean;
}): DispatchDecision {
  const window = sendWindow(input.year, input.month);
  const waiting = waitingOwners(input.owners);
  const ready = readyOwners(input.owners);
  const holdMessage = "The batch is held until every statement is Approved & Locked.";

  if (waiting.length) {
    if (!input.manualAuthorization && input.now.getTime() > window.end.getTime()) {
      return {
        action: "deadline_miss",
        waiting,
        message: "No statements were sent by the deadline."
      };
    }
    return { action: "hold", waiting, message: holdMessage };
  }

  if (!ready.length) return { action: "already_sent" };
  if (input.manualAuthorization) return { action: "send", versions: ready };
  if (input.now.getTime() < window.start.getTime()) return { action: "too_early" };
  if (input.now.getTime() > window.end.getTime()) {
    return {
      action: "hold_for_manual",
      message: "Approvals finished after the send window. Nothing is sent until you use Send Statements to All Owners."
    };
  }
  return { action: "send", versions: ready };
}

export type SendSummary = {
  sent: { ownerId: string; name: string; email: string; versionId: string; gmailMessageId: string }[];
  skipped: { ownerId: string; name: string; reason: string }[];
  failed: { ownerId: string; name: string; email: string; versionId: string; error: string }[];
};

export async function executeDispatch(
  decision: DispatchDecision,
  deps: {
    send: (version: ReadySend) => Promise<{ id: string }>;
    markSent: (version: ReadySend, gmailMessageId: string) => Promise<void>;
    markFailed: (version: ReadySend, error: string) => Promise<void>;
  }
): Promise<SendSummary> {
  const summary: SendSummary = { sent: [], skipped: [], failed: [] };
  if (decision.action !== "send") return summary;
  const seen = new Set<string>();
  for (const version of decision.versions) {
    if (seen.has(version.versionId)) {
      summary.skipped.push({ ownerId: version.ownerId, name: version.name, reason: "Duplicate send of the same version was blocked." });
      continue;
    }
    seen.add(version.versionId);
    if (!version.email) {
      const error = "No registered email address.";
      await deps.markFailed(version, error);
      summary.failed.push({ ownerId: version.ownerId, name: version.name, email: "", versionId: version.versionId, error });
      continue;
    }
    try {
      const result = await deps.send(version);
      if (!result.id) throw new Error("Gmail did not confirm a message id.");
      await deps.markSent(version, result.id);
      summary.sent.push({
        ownerId: version.ownerId,
        name: version.name,
        email: version.email,
        versionId: version.versionId,
        gmailMessageId: result.id
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Send failed.";
      await deps.markFailed(version, message);
      summary.failed.push({
        ownerId: version.ownerId,
        name: version.name,
        email: version.email,
        versionId: version.versionId,
        error: message
      });
    }
  }
  return summary;
}

export function statementEmail(input: { ownerName: string; periodLabel: string; shareUrl: string }) {
  const subject = `Ocean Vacations statement — ${input.periodLabel}`;
  const text = [
    `Hello ${input.ownerName},`,
    "",
    `Your Ocean Vacations statement for ${input.periodLabel} is ready:`,
    input.shareUrl,
    "",
    "This link opens the approved statement."
  ].join("\n");
  const html = `<p>Hello ${escapeHtml(input.ownerName)},</p><p>Your Ocean Vacations statement for ${escapeHtml(input.periodLabel)} is ready.</p><p><a href="${escapeHtml(input.shareUrl)}">Open your statement</a></p>`;
  return { subject, text, html };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
