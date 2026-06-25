export type Role = "admin" | "owner";
export type OwnerType = "draft" | "payout" | "split";
export type ReportKey = "statement" | "income" | "gri" | "1099" | "summary" | "allOwnersTax";

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  ownerId?: string | null;
  displayName?: string;
};

export type MoneyCharge = {
  label: string;
  amount: number;
};

export type MonthlyCharge = MoneyCharge & {
  month: number;
};

export type SpecificDateCharge = MoneyCharge & {
  month: number;
  day: number;
};

export type DateRangeCharge = MoneyCharge & {
  startDate: string;
  endDate: string;
};

export type CleaningCap = {
  property?: string;
  maxAmount: number;
};

export type OwnerLike = {
  _id?: string;
  id?: string;
  name: string;
  email?: string;
  type: OwnerType;
  percent?: number;
  salesFeePercent?: number;
  splitOwnerPercent?: number;
  cleaningFee?: number;
  cleaningCaps?: CleaningCap[];
  taxFlags?: Record<string, boolean>;
  guestyReportUrl?: string;
  guestyAllPropertiesUrl?: string;
  properties?: string[];
  recurringCharges?: MoneyCharge[];
  monthlyRecurringCharges?: MonthlyCharge[];
  specificDateRecurringCharges?: SpecificDateCharge[];
  dateRangeRecurringCharges?: DateRangeCharge[];
};

export type ExpenseLike = {
  _id?: string;
  ownerId: string;
  property: string;
  type: string;
  vendor?: string;
  amount: number;
  notes?: string;
  invoiceUrl?: string;
  month: number;
  year: number;
  createdAt?: string | Date;
};

export type PropertyLike = {
  _id?: string;
  id?: string;
  name: string;
  reportAddress?: string;
  municipality?: string;
  taxFlags?: Record<string, boolean>;
};

export type NormalizedReservation = {
  id: string;
  property: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  source: string;
  platform: string;
  confirmationCode: string;
  status: string;
  totalPayout: number;
  accommodationFare: number;
  cleaningFare: number;
  markup: number;
  channelCommission: number;
  preCancellationHostPayout: number;
  feeCreditCard: number;
  lengthOfStayDiscount: number;
  airbnbResolutionCenter: number;
  manualTotalPayout?: number;
  manualCleaningFare?: number;
  manualWebsiteFee?: number;
  manualAccommodation?: number;
  manualPmc?: number;
  manualOwnerPayout?: number;
  manualAmountDue?: number;
  manualExpectedPayoutDate?: string;
  taxesCombined: number;
  taxCity: number;
  taxState: number;
  taxCounty: number;
  taxOccupancy: number;
  taxGtc: number;
  invoiceItemsTaxCombined: number;
  detailedTaxesCombined: number;
  rowTaxTotal: number;
  invoiceItemsRaw: unknown[];
  raw: Record<string, unknown>;
};

export type CalculatedReservation = NormalizedReservation & {
  grossPayout: number;
  cleaning: number;
  websiteVrboFee: number;
  taxes: number;
  netAccommodation: number;
  pmcPercent: number;
  pmc: number;
  ownerPayoutBeforeExpenses: number;
  ownerPayout: number;
  expectedPayoutDate: string;
  isOwnerStay: boolean;
};

export type AppSettings = {
  guestyCacheTtlMinutes: number;
  defaultCleaningCaps: CleaningCap[];
};
