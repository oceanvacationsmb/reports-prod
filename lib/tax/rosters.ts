export const ROSTER_KEYS = [
  "surfside",
  "georgetown",
  "mydorway",
  "horry",
  "myrtleBeach",
  "northMyrtleBeach"
] as const;

export type RosterKey = (typeof ROSTER_KEYS)[number];

export type TaxRosters = Record<RosterKey, string[]>;

export type RosterSource = {
  key: RosterKey;
  label: string;
  flag: "SSB" | "GTC" | "SC" | "HC" | "MB" | "NMB";
  kind: "pdf" | "portal";
  url?: string;
  importHelp: string;
};

export const ROSTER_SOURCES: RosterSource[] = [
  {
    key: "surfside",
    label: "Surfside Beach",
    flag: "SSB",
    kind: "pdf",
    importHelp: "Imports properties already saved with the SSB tax flag."
  },
  {
    key: "georgetown",
    label: "Georgetown County",
    flag: "GTC",
    kind: "pdf",
    importHelp: "Imports properties already saved with the GTC tax flag."
  },
  {
    key: "mydorway",
    label: "SC MyDORWAY",
    flag: "SC",
    kind: "portal",
    url: "https://mydorway.dor.sc.gov/_/",
    importHelp: "Starts from properties already saved with the SC tax flag. Paste the property list kept in MyDORWAY to add or replace names."
  },
  {
    key: "horry",
    label: "Horry County",
    flag: "HC",
    kind: "portal",
    url: "https://www.horrycountysc.gov/business-license-online-filing/",
    importHelp: "Imports properties already saved with the HC tax flag. Paste the county portal list to add or replace names."
  },
  {
    key: "myrtleBeach",
    label: "Myrtle Beach",
    flag: "MB",
    kind: "portal",
    url: "https://portal.cityofmyrtlebeach.com/",
    importHelp: "Starts from properties already saved with the MB tax flag. Paste the property list kept in the Myrtle Beach portal to add or replace names."
  },
  {
    key: "northMyrtleBeach",
    label: "North Myrtle Beach",
    flag: "NMB",
    kind: "portal",
    url: "https://northmyrtlebeach.progressivecloud.net/webrenewals/",
    importHelp: "Imports properties already saved with the NMB tax flag. Paste the city portal list to add or replace names."
  }
];

export function emptyRosters(): TaxRosters {
  return {
    surfside: [],
    georgetown: [],
    mydorway: [],
    horry: [],
    myrtleBeach: [],
    northMyrtleBeach: []
  };
}

export function uniquePropertyNames(names: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result.sort((a, b) => a.localeCompare(b));
}

export function parsePropertyList(text: string) {
  return uniquePropertyNames(text.split(/\r?\n|,/).map((line) => line.trim()));
}

export function normalizeRosters(input: Partial<Record<string, unknown>> | null | undefined): TaxRosters {
  const rosters = emptyRosters();
  for (const key of ROSTER_KEYS) {
    const value = input?.[key];
    rosters[key] = Array.isArray(value) ? uniquePropertyNames(value.map((item) => String(item ?? ""))) : [];
  }
  return rosters;
}

export function importFlaggedProperties(
  properties: { name: string; taxFlags?: Record<string, boolean> | null }[],
  flag: string
) {
  return uniquePropertyNames(
    properties.filter((property) => Boolean(property.taxFlags?.[flag])).map((property) => property.name)
  );
}

export function mergePropertyNames(current: string[], incoming: string[]) {
  return uniquePropertyNames([...current, ...incoming]);
}

export function rosterSource(key: RosterKey) {
  const source = ROSTER_SOURCES.find((item) => item.key === key);
  if (!source) throw new Error(`Unknown property list ${key}.`);
  return source;
}
