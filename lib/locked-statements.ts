export type StatementLine = {
  label: string;
  amount: number;
  property?: string;
};

export type StatementExpenseLine = {
  property: string;
  type: string;
  amount: number;
  notes?: string;
  vendor?: string;
};

export type StatementTotals = {
  netAccommodation: number;
  pmc: number;
  expenses: number;
  recurringCharges: number;
  ownerPayout: number;
};

export type StatementSourceKind = "saved-report" | "uploaded-pdf" | "fixture";

export type FinalStatement = {
  ownerId: string;
  year: number;
  month: number;
  shareId: string;
  periodLabel: string;
  htmlSnapshot: string;
  recurring: StatementLine[];
  expenses: StatementExpenseLine[];
  totals: StatementTotals;
  depositRecorded: boolean;
  locked: true;
  lockedAt: string;
  lockedBy?: string;
  backfilled?: boolean;
  sourceKind?: StatementSourceKind | "";
  sourceRef?: string;
};

export type StatementAuditAction = "modify" | "unlock" | "relock";

export type StatementAuditRecord = {
  ownerId: string;
  year: number;
  month: number;
  shareId: string;
  action: StatementAuditAction;
  who: string;
  when: string;
  before: {
    recurring: StatementLine[];
    expenses: StatementExpenseLine[];
    totals: StatementTotals;
    htmlSnapshot: string;
  };
  after: {
    recurring: StatementLine[];
    expenses: StatementExpenseLine[];
    totals: StatementTotals;
    htmlSnapshot: string;
  };
};

export type FinalMonthInput = {
  year: number;
  month: number;
  shareId: string;
  depositRecorded: boolean;
  totals: StatementTotals;
};

export type Final1099Row = {
  month: number;
  final: boolean;
  depositRecorded: boolean;
  shareId?: string;
  netAccommodation: number;
  pmc: number;
  expenses: number;
  netToOwner: number;
};

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function cents(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function copyLine(line: StatementLine): StatementLine {
  return {
    label: line.label,
    amount: cents(line.amount),
    property: line.property || ""
  };
}

function copyExpense(line: StatementExpenseLine): StatementExpenseLine {
  return {
    property: line.property || "",
    type: line.type || "",
    amount: cents(line.amount),
    notes: line.notes || "",
    vendor: line.vendor || ""
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function linesForMonth(baseLines: StatementLine[], finalStatement: Pick<FinalStatement, "locked" | "recurring"> | null) {
  if (finalStatement?.locked) return finalStatement.recurring.map(copyLine);
  return baseLines.map(copyLine);
}

export function lockOnEmail(existing: FinalStatement | null, draft: Omit<FinalStatement, "locked">): { record: FinalStatement; created: boolean } {
  if (existing?.locked) return { record: existing, created: false };
  return {
    record: {
      ...draft,
      recurring: draft.recurring.map(copyLine),
      expenses: draft.expenses.map(copyExpense),
      locked: true
    },
    created: true
  };
}

export function modifyLock(
  existing: FinalStatement,
  next: {
    recurring: StatementLine[];
    expenses: StatementExpenseLine[];
    totals: StatementTotals;
    htmlSnapshot: string;
    depositRecorded?: boolean;
  },
  who: string,
  when: string
): { lock: FinalStatement; audit: StatementAuditRecord } {
  const after = {
    recurring: next.recurring.map(copyLine),
    expenses: next.expenses.map(copyExpense),
    totals: { ...next.totals },
    htmlSnapshot: next.htmlSnapshot
  };
  return {
    lock: {
      ...existing,
      ...after,
      depositRecorded: next.depositRecorded ?? true,
      locked: true,
      shareId: existing.shareId,
      lockedAt: existing.lockedAt
    },
    audit: {
      ownerId: existing.ownerId,
      year: existing.year,
      month: existing.month,
      shareId: existing.shareId,
      action: "modify",
      who,
      when,
      before: {
        recurring: existing.recurring.map(copyLine),
        expenses: existing.expenses.map(copyExpense),
        totals: { ...existing.totals },
        htmlSnapshot: existing.htmlSnapshot
      },
      after
    }
  };
}

export type PreservedStatement = {
  ownerId: string;
  year: number;
  month: number;
  shareId: string;
  periodLabel: string;
  htmlSnapshot: string;
  recurring: StatementLine[];
  expenses: StatementExpenseLine[];
  totals: StatementTotals;
  depositRecorded: boolean;
  lockedAt: string;
  lockedBy: string;
};

function snapshotOf(existing: FinalStatement): PreservedStatement {
  return {
    ownerId: existing.ownerId,
    year: existing.year,
    month: existing.month,
    shareId: existing.shareId,
    periodLabel: existing.periodLabel,
    htmlSnapshot: existing.htmlSnapshot,
    recurring: existing.recurring.map(copyLine),
    expenses: existing.expenses.map(copyExpense),
    totals: { ...existing.totals },
    depositRecorded: existing.depositRecorded,
    lockedAt: existing.lockedAt,
    lockedBy: existing.lockedBy || ""
  };
}

export function unlockStatement(existing: FinalStatement, who: string, when: string) {
  const preserved = snapshotOf(existing);
  return {
    preserved,
    audit: {
      ownerId: existing.ownerId,
      year: existing.year,
      month: existing.month,
      shareId: existing.shareId,
      action: "unlock" as const,
      who,
      when,
      before: {
        recurring: preserved.recurring,
        expenses: preserved.expenses,
        totals: { ...preserved.totals },
        htmlSnapshot: preserved.htmlSnapshot
      },
      after: {
        recurring: preserved.recurring.map(copyLine),
        expenses: preserved.expenses.map(copyExpense),
        totals: { ...preserved.totals },
        htmlSnapshot: preserved.htmlSnapshot
      }
    }
  };
}

export function relockStatement(previous: PreservedStatement, next: Omit<FinalStatement, "locked">, who: string, when: string) {
  if (!next.shareId || next.shareId === previous.shareId) {
    throw new Error("A new lock needs its own link so the sent statement stays unchanged.");
  }
  const lock: FinalStatement = {
    ...next,
    recurring: next.recurring.map(copyLine),
    expenses: next.expenses.map(copyExpense),
    totals: { ...next.totals },
    locked: true,
    lockedAt: next.lockedAt || when,
    lockedBy: next.lockedBy || who
  };
  return {
    lock,
    preservedShareId: previous.shareId,
    audit: {
      ownerId: previous.ownerId,
      year: previous.year,
      month: previous.month,
      shareId: lock.shareId,
      action: "relock" as const,
      who,
      when,
      before: {
        recurring: previous.recurring.map(copyLine),
        expenses: previous.expenses.map(copyExpense),
        totals: { ...previous.totals },
        htmlSnapshot: previous.htmlSnapshot
      },
      after: {
        recurring: lock.recurring.map(copyLine),
        expenses: lock.expenses.map(copyExpense),
        totals: { ...lock.totals },
        htmlSnapshot: lock.htmlSnapshot
      }
    }
  };
}

export function buildFinal1099(year: number, finals: FinalMonthInput[]) {
  const byMonth = new Map<number, FinalMonthInput>();
  for (const item of finals) {
    if (item.year !== year || item.month < 1 || item.month > 12) continue;
    if (!byMonth.has(item.month)) byMonth.set(item.month, item);
  }

  const months: Final1099Row[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const finalMonth = byMonth.get(month);
    if (!finalMonth) {
      months.push({
        month,
        final: false,
        depositRecorded: false,
        netAccommodation: 0,
        pmc: 0,
        expenses: 0,
        netToOwner: 0
      });
      continue;
    }
    const expenses = cents(finalMonth.totals.expenses + finalMonth.totals.recurringCharges);
    months.push({
      month,
      final: true,
      depositRecorded: finalMonth.depositRecorded,
      shareId: finalMonth.shareId,
      netAccommodation: cents(finalMonth.totals.netAccommodation),
      pmc: cents(finalMonth.totals.pmc),
      expenses,
      netToOwner: finalMonth.depositRecorded ? cents(finalMonth.totals.ownerPayout) : 0
    });
  }

  const included = months.filter((row) => row.final && row.depositRecorded);
  return {
    months,
    missingMonths: months.filter((row) => !row.final).map((row) => row.month),
    incompleteMonths: months.filter((row) => row.final && !row.depositRecorded).map((row) => row.month),
    totals: {
      netAccommodation: cents(included.reduce((sum, row) => sum + row.netAccommodation, 0)),
      pmc: cents(included.reduce((sum, row) => sum + row.pmc, 0)),
      expenses: cents(included.reduce((sum, row) => sum + row.expenses, 0)),
      netToOwner: cents(included.reduce((sum, row) => sum + row.netToOwner, 0))
    }
  };
}

export type BackfillInput = {
  ownerId: string;
  ownerName: string;
  property?: string;
  year: number;
  month: number;
  shareId: string;
  recurring: StatementLine[];
  expenses?: StatementExpenseLine[];
  totals?: Partial<StatementTotals>;
  nights?: number;
  propertyPayoutBeforeRecurring?: number;
  lockedAt: string;
  lockedBy?: string;
  sourceNote?: string;
  sourceKind?: StatementSourceKind;
  sourceRef?: string;
};

export function backfillLock(input: BackfillInput): FinalStatement {
  const recurring = input.recurring.map((line) => copyLine({ ...line, property: line.property || input.property || "Recurring" }));
  const expenses = (input.expenses || []).map(copyExpense);
  const recurringCharges = cents(recurring.reduce((sum, line) => sum + line.amount, 0));
  const expenseTotal = cents(expenses.reduce((sum, line) => sum + line.amount, 0));
  const depositRecorded = typeof input.totals?.ownerPayout === "number";
  const totals: StatementTotals = {
    netAccommodation: cents(input.totals?.netAccommodation ?? 0),
    pmc: cents(input.totals?.pmc ?? 0),
    expenses: cents(input.totals?.expenses ?? expenseTotal),
    recurringCharges: cents(input.totals?.recurringCharges ?? recurringCharges),
    ownerPayout: cents(input.totals?.ownerPayout ?? 0)
  };
  return {
    ownerId: input.ownerId,
    year: input.year,
    month: input.month,
    shareId: input.shareId,
    periodLabel: `${monthNames[input.month - 1] || "Month"} ${input.year}`,
    htmlSnapshot: backfillHtml({ ...input, recurring, expenses, totals, recurringCharges, depositRecorded }),
    recurring,
    expenses,
    totals,
    depositRecorded,
    locked: true,
    lockedAt: input.lockedAt,
    lockedBy: input.lockedBy || "",
    backfilled: true,
    sourceKind: input.sourceKind || "fixture",
    sourceRef: input.sourceRef || input.sourceNote || ""
  };
}

function backfillHtml(input: BackfillInput & { recurring: StatementLine[]; expenses: StatementExpenseLine[]; totals: StatementTotals; recurringCharges: number; depositRecorded: boolean }) {
  const recurringRows = input.recurring
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.property || input.property || "Recurring")}</td><td>${escapeHtml(line.label)}</td><td>${escapeHtml(money.format(line.amount))}</td><td>Base recurring charge</td></tr>`
    )
    .join("");
  const expenseRows = input.expenses
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.property)}</td><td>${escapeHtml(line.type)}</td><td>${escapeHtml(money.format(line.amount))}</td><td>${escapeHtml(line.notes || line.vendor || "")}</td></tr>`
    )
    .join("");
  const deposit = input.depositRecorded
    ? money.format(input.totals.ownerPayout)
    : "Deposit not recorded";
  const propertyPayout = typeof input.propertyPayoutBeforeRecurring === "number"
    ? `<p>Property payout before recurring: ${escapeHtml(money.format(input.propertyPayoutBeforeRecurring))}</p>`
    : "";
  const nights = typeof input.nights === "number" ? `<p>Nights: ${input.nights}</p>` : "";
  return `
    <article class="report-sheet">
      <h1>${escapeHtml(input.ownerName)} Statement</h1>
      <p>${escapeHtml(monthNames[input.month - 1] || "")} ${input.year}</p>
      <p>${escapeHtml(input.sourceNote || "Saved from a known statement.")}</p>
      <p>Backfilled from ${escapeHtml(input.sourceKind || "fixture")}${input.sourceRef ? `: ${escapeHtml(input.sourceRef)}` : ""}.</p>
      <table>
        <thead><tr><th>Property</th><th>Description</th><th>Amount</th><th>Note</th></tr></thead>
        <tbody>
          ${recurringRows}
          ${expenseRows}
          <tr><td></td><td>Recurring total</td><td>${escapeHtml(money.format(input.recurringCharges))}</td><td></td></tr>
        </tbody>
      </table>
      <p>Net accommodation ${escapeHtml(money.format(input.totals.netAccommodation))}. PMC ${escapeHtml(money.format(input.totals.pmc))}. Expenses ${escapeHtml(money.format(input.totals.expenses))}.</p>
      ${propertyPayout}
      ${nights}
      <p>Net to owner: ${escapeHtml(deposit)}</p>
    </article>
  `;
}

export function planBackfill(existing: { shareId: string } | null, input: BackfillInput) {
  if (existing?.shareId) {
    return {
      action: "skip" as const,
      shareId: existing.shareId,
      reason: "This month is already a final statement."
    };
  }
  return {
    action: "create" as const,
    lock: backfillLock(input)
  };
}

export type SavedStatementRecord = {
  ownerId: string;
  ownerName: string;
  shareId: string;
  periodLabel: string;
  createdAt: string;
  htmlSnapshot: string;
};

export type StatementBackfillPlan =
  | { action: "skip"; ownerId: string; year: number; month: number; shareId: string; reason: string }
  | { action: "choose"; ownerId: string; ownerName: string; year: number; month: number; choices: Array<{ shareId: string; createdAt: string; ownerPayout: number; netAccommodation: number }> }
  | { action: "unreadable"; ownerId: string; ownerName: string; year: number; month: number; reason: string }
  | { action: "create"; lock: FinalStatement };

const monthIndex = new Map(monthNames.map((name, index) => [name.toLowerCase(), index + 1]));

export function periodFromStatementLabel(label: string) {
  const match = label.trim().match(/^([A-Za-z]+)\s+1\s+-\s+[A-Za-z]+\s+\d{1,2},\s+(\d{4})$/);
  if (!match) return null;
  const month = monthIndex.get(match[1].toLowerCase());
  const year = Number(match[2]);
  if (!month || !year) return null;
  return { month, year };
}

function labeledAmount(html: string, label: string) {
  const pattern = new RegExp(`<span>\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</span>\\s*<strong>\\s*([^<]+?)</strong>`, "i");
  const match = html.match(pattern);
  if (!match) return null;
  const amount = Number(match[1].replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? cents(Math.abs(amount)) : null;
}

export function totalsFromStatementHtml(html: string): { totals: StatementTotals; depositRecorded: boolean } | null {
  const netAccommodation = labeledAmount(html, "Total net accommodation");
  const pmc = labeledAmount(html, "Minus PMC");
  const expenses = labeledAmount(html, "Minus expenses");
  const recurringCharges = labeledAmount(html, "Minus recurring charges");
  const ownerPayout = labeledAmount(html, "Owner payout");
  if (netAccommodation == null || pmc == null || expenses == null || recurringCharges == null) return null;
  return {
    depositRecorded: ownerPayout != null,
    totals: {
      netAccommodation,
      pmc,
      expenses,
      recurringCharges,
      ownerPayout: ownerPayout ?? 0
    }
  };
}

function amountNearLabel(text: string, label: string) {
  const pattern = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\d$]{0,40}\\$?\\s*([0-9,]+\\.\\d{2})`, "i");
  const match = text.match(pattern);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? cents(amount) : null;
}

export function totalsFromStatementText(text: string): { totals: StatementTotals; depositRecorded: boolean } | null {
  const netAccommodation = amountNearLabel(text, "Total net accommodation");
  const pmc = amountNearLabel(text, "Minus PMC");
  const expenses = amountNearLabel(text, "Minus expenses");
  const recurringCharges = amountNearLabel(text, "Minus recurring charges");
  const ownerPayout = amountNearLabel(text, "Owner payout");
  if (netAccommodation == null || pmc == null || expenses == null || recurringCharges == null || ownerPayout == null) return null;
  return {
    depositRecorded: true,
    totals: { netAccommodation, pmc, expenses, recurringCharges, ownerPayout }
  };
}

function sameTotals(left: StatementTotals, right: StatementTotals) {
  return (Object.keys(left) as Array<keyof StatementTotals>).every((key) => Math.abs(left[key] - right[key]) < 0.001);
}

function lockFromSnapshot(
  record: SavedStatementRecord,
  period: { year: number; month: number },
  parsed: { totals: StatementTotals; depositRecorded: boolean }
): FinalStatement {
  return {
    ownerId: record.ownerId,
    year: period.year,
    month: period.month,
    shareId: record.shareId,
    periodLabel: record.periodLabel,
    htmlSnapshot: record.htmlSnapshot,
    recurring: [],
    expenses: [],
    totals: parsed.totals,
    depositRecorded: parsed.depositRecorded,
    locked: true,
    lockedAt: record.createdAt,
    lockedBy: "",
    backfilled: true,
    sourceKind: "saved-report",
    sourceRef: record.shareId
  };
}

export function planSavedStatementBackfill(
  records: SavedStatementRecord[],
  existing: Array<{ ownerId: string; year: number; month: number; shareId: string }> = []
): StatementBackfillPlan[] {
  const groups = new Map<string, SavedStatementRecord[]>();
  for (const record of records) {
    const period = periodFromStatementLabel(record.periodLabel);
    if (!period) continue;
    const key = `${record.ownerId}:${period.year}:${period.month}`;
    groups.set(key, [...(groups.get(key) || []), record]);
  }

  const plans: StatementBackfillPlan[] = [];
  for (const [key, group] of groups) {
    const [ownerId, yearText, monthText] = key.split(":");
    const year = Number(yearText);
    const month = Number(monthText);
    const already = existing.find((item) => item.ownerId === ownerId && item.year === year && item.month === month);
    if (already) {
      plans.push({ action: "skip", ownerId, year, month, shareId: already.shareId, reason: "This month is already a final statement." });
      continue;
    }
    const parsed = group.map((record) => ({ record, parsed: totalsFromStatementHtml(record.htmlSnapshot) }));
    const readable = parsed.filter((item): item is { record: SavedStatementRecord; parsed: NonNullable<typeof item.parsed> } => item.parsed != null);
    if (!readable.length) {
      plans.push({
        action: "unreadable",
        ownerId,
        ownerName: group[0]?.ownerName || "",
        year,
        month,
        reason: "The saved statement does not include the sent summary lines."
      });
      continue;
    }
    const first = readable[0].parsed.totals;
    const agreed = readable.every((item) => sameTotals(item.parsed.totals, first));
    if (!agreed) {
      plans.push({
        action: "choose",
        ownerId,
        ownerName: group[0]?.ownerName || "",
        year,
        month,
        choices: readable
          .map((item) => ({
            shareId: item.record.shareId,
            createdAt: item.record.createdAt,
            ownerPayout: item.parsed.totals.ownerPayout,
            netAccommodation: item.parsed.totals.netAccommodation
          }))
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.shareId.localeCompare(right.shareId))
      });
      continue;
    }
    const latest = readable
      .slice()
      .sort((left, right) => right.record.createdAt.localeCompare(left.record.createdAt) || right.record.shareId.localeCompare(left.record.shareId))[0];
    plans.push({ action: "create", lock: lockFromSnapshot(latest.record, { year, month }, latest.parsed) });
  }
  return plans.sort((left, right) => {
    const a = left.action === "create" ? left.lock : left;
    const b = right.action === "create" ? right.lock : right;
    return a.ownerId.localeCompare(b.ownerId) || a.year - b.year || a.month - b.month;
  });
}

export function planUploadedPdfBackfill(input: {
  ownerId: string;
  ownerName: string;
  year: number;
  month: number;
  filename: string;
  text: string;
  lockedAt?: string;
  existing?: { shareId: string } | null;
}): StatementBackfillPlan {
  if (input.existing?.shareId) {
    return { action: "skip", ownerId: input.ownerId, year: input.year, month: input.month, shareId: input.existing.shareId, reason: "This month is already a final statement." };
  }
  const parsed = totalsFromStatementText(input.text);
  if (!parsed) {
    return {
      action: "unreadable",
      ownerId: input.ownerId,
      ownerName: input.ownerName,
      year: input.year,
      month: input.month,
      reason: "The uploaded PDF does not include the sent statement totals."
    };
  }
  return {
    action: "create",
    lock: backfillLock({
      ownerId: input.ownerId,
      ownerName: input.ownerName,
      year: input.year,
      month: input.month,
      shareId: "dry-run",
      totals: parsed.totals,
      recurring: [],
      lockedAt: input.lockedAt || new Date(0).toISOString(),
      sourceNote: `Uploaded PDF ${input.filename}`,
      sourceKind: "uploaded-pdf",
      sourceRef: input.filename
    })
  };
}
