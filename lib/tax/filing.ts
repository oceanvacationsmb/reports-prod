export const FILING_PORTALS = [
  {
    id: "mydorway",
    label: "SC MyDORWAY",
    url: "https://mydorway.dor.sc.gov/_/",
    rosterKey: "mydorway" as const,
    entryNote: "Enter each property’s gross receipts. MyDORWAY calculates the accommodations tax. A zero-gross month is a zero return with no payment."
  },
  {
    id: "horry",
    label: "Horry County",
    url: "https://service.horrycounty.org/css",
    infoUrl: "https://www.horrycountysc.gov/business-license-online-filing/",
    rosterKey: "horry" as const,
    entryNote: "Horry’s filing guide says to enter gross receipts, review them, then file. The portal calculates the fee. Pay with the e-check already saved there when the portal offers it."
  },
  {
    id: "myrtleBeach",
    label: "Myrtle Beach",
    url: "https://portal.cityofmyrtlebeach.com/",
    rosterKey: "myrtleBeach" as const,
    entryNote: "Enter each property’s gross receipts in the city hospitality account. The portal calculates the tax."
  },
  {
    id: "northMyrtleBeach",
    label: "North Myrtle Beach",
    url: "https://northmyrtlebeach.progressivecloud.net/webrenewals/",
    rosterKey: "northMyrtleBeach" as const,
    entryNote: "Enter each property’s gross receipts in the city hospitality renewal. The portal calculates the tax."
  }
];

export type FilingPortalId = (typeof FILING_PORTALS)[number]["id"];

export type FilingLine = {
  property: string;
  grossReceipts: number;
  taxesCollected: number;
};

export type FilingDraft = {
  portalId: FilingPortalId;
  year: number;
  month: number;
  lines: FilingLine[];
  totalGross: number;
  totalTaxesCollected: number;
  paymentRequired: boolean;
  paymentNote: string;
  entryNote: string;
};

export type FilingExecutorResult = {
  submitted: boolean;
  confirmationId?: string;
  message: string;
};

export type PreparedFilingStatus = "prepared" | "submitting" | "approved_not_submitted" | "filed" | "failed";

export interface FilingExecutor {
  readonly id: string;
  submit(draft: FilingDraft): Promise<FilingExecutorResult>;
}

export const stubFilingExecutor: FilingExecutor = {
  id: "stub",
  async submit() {
    return {
      submitted: false,
      message:
        "Stub executor: nothing was filed and no payment was sent. Approve and File recorded your approval only. See docs/tax-filing-agent.md before connecting a browser worker."
    };
  }
};

export function getFilingExecutor(): FilingExecutor {
  return stubFilingExecutor;
}

export function preparePortalFiling(input: {
  portalId: FilingPortalId;
  year: number;
  month: number;
  lines: FilingLine[];
}): FilingDraft {
  const portal = FILING_PORTALS.find((item) => item.id === input.portalId);
  if (!portal) throw new Error(`Unknown portal ${input.portalId}.`);
  const totalGross = round(input.lines.reduce((sum, line) => sum + line.grossReceipts, 0));
  const totalTaxesCollected = round(input.lines.reduce((sum, line) => sum + line.taxesCollected, 0));
  const paymentRequired = totalGross !== 0;
  return {
    portalId: input.portalId,
    year: input.year,
    month: input.month,
    lines: input.lines,
    totalGross,
    totalTaxesCollected,
    paymentRequired,
    paymentNote: paymentRequired
      ? "Payment uses the bank method already saved in the portal. This app does not store that account. If the portal asks for a new account number, stop."
      : "No payment. Submit the zero return without a payment.",
    entryNote: portal.entryNote
  };
}

export function assertCanApprove(status: PreparedFilingStatus) {
  if (status !== "prepared") {
    throw Object.assign(new Error("This return is not waiting for approval."), { status: 409 });
  }
}

export function filingAfterExecutor(result: FilingExecutorResult): {
  status: PreparedFilingStatus;
  confirmationId: string;
  message: string;
} {
  if (!result.submitted) {
    return {
      status: "approved_not_submitted",
      confirmationId: "",
      message: result.message
    };
  }
  return {
    status: "filed",
    confirmationId: result.confirmationId || "",
    message: result.message
  };
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
