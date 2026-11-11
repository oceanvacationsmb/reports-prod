const ignoredPropertyNames = new Set(["", "owner", "recurring", "unassigned"]);

export function reportPropertyChoices(...groups: Array<Array<string | undefined | null>>) {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const value of group) {
      const name = String(value || "").trim();
      const key = name.toLowerCase();
      if (!name || ignoredPropertyNames.has(key) || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
  }
  return names.sort((left, right) => left.localeCompare(right));
}

export function reportYearChoices(today = new Date()) {
  const year = today.getFullYear();
  return {
    defaultYear: String(year),
    years: [year - 1, year, year + 1]
  };
}
