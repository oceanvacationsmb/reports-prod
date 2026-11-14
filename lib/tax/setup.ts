export type TaxCompanyProfile = {
  legalName: string;
  dba: string;
  ownerName: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  federalId: string;
  scSalesTaxNumber: string;
  surfsideAccountNumber: string;
  georgetownCustomerNumber: string;
  signerName: string;
  signerTitle: string;
};

const companyKeys: (keyof TaxCompanyProfile)[] = [
  "legalName",
  "dba",
  "ownerName",
  "address1",
  "address2",
  "city",
  "state",
  "zip",
  "phone",
  "email",
  "federalId",
  "scSalesTaxNumber",
  "surfsideAccountNumber",
  "georgetownCustomerNumber",
  "signerName",
  "signerTitle"
];

export function emptyCompany(): TaxCompanyProfile {
  return {
    legalName: "",
    dba: "",
    ownerName: "",
    address1: "",
    address2: "",
    city: "",
    state: "SC",
    zip: "",
    phone: "",
    email: "",
    federalId: "",
    scSalesTaxNumber: "",
    surfsideAccountNumber: "",
    georgetownCustomerNumber: "",
    signerName: "",
    signerTitle: ""
  };
}

export function normalizeCompany(input: Partial<Record<string, unknown>> | null | undefined): TaxCompanyProfile {
  const company = emptyCompany();
  for (const key of companyKeys) {
    company[key] = String(input?.[key] ?? company[key]).trim();
  }
  company.state = (company.state || "SC").toUpperCase().slice(0, 2);
  return company;
}

export function companyMailingBlock(company: TaxCompanyProfile) {
  const name = company.dba || company.legalName;
  const cityLine = [company.city, [company.state, company.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [name, company.address1, company.address2, cityLine].filter(Boolean);
}

export function missingCompanyFields(company: TaxCompanyProfile) {
  const required: (keyof TaxCompanyProfile)[] = ["legalName", "address1", "city", "state", "zip", "phone", "federalId"];
  return required.filter((key) => !company[key]);
}
