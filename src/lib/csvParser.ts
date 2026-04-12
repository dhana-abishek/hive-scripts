/**
 * Parse a single CSV line, respecting quoted fields.
 * Handles commas inside double-quoted strings.
 */
export function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parse a full CSV string into a 2D array of trimmed strings.
 * First row is the header.
 */
export function parseCSVRows(text: string): string[][] {
  const lines = text.trim().split("\n");
  return lines.map((line) => parseCSVLine(line).map((f) => f.trim()));
}

/**
 * Parse CSV headers and return lowercase column names.
 */
export function parseCSVHeaders(headerLine: string): string[] {
  return parseCSVLine(headerLine).map((h) => h.trim().toLowerCase());
}
