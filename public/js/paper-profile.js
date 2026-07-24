const PROFILES = Object.freeze({
  "58": Object.freeze({ id: "58", widthMm: 58, columns: 32, padding: 0, margin: 0, printableWidth: null, characterWidth: null, lineSpacing: null }),
  "80": Object.freeze({ id: "80", widthMm: 80, columns: 48, padding: 0, margin: 0, printableWidth: null, characterWidth: null, lineSpacing: null })
});

export function getPaperProfile(id = "58", overrides = {}) {
  const base = PROFILES[String(id)];
  if (!base) throw new RangeError(`Unsupported paper profile: ${id}`);
  const profile = Object.assign({}, base, overrides);
  for (const key of ["widthMm", "columns", "padding", "margin"]) {
    if (!Number.isFinite(Number(profile[key])) || Number(profile[key]) < 0) throw new RangeError(`Invalid paper profile ${key}`);
    profile[key] = Number(profile[key]);
  }
  if (profile.columns < 1) throw new RangeError("Paper profile columns must be positive");
  return Object.freeze(profile);
}

export const PAPER_PROFILES = PROFILES;
