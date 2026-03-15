/**
 * Unified diff parser — shared by ChangesScreen and inline diff panel.
 */

export interface DiffHunk {
  index: number;
  header: string;
  lines: string[];
  addedCount: number;
  removedCount: number;
}

export interface ParsedDiff {
  headerLines: string[];
  hunks: DiffHunk[];
}

/** Split a unified diff into its file header and individual hunks. */
export function parseDiffIntoHunks(diff: string): ParsedDiff {
  const lines = diff.split('\n');
  const headerLines: string[] = [];
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let idx = 0;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current);
      current = { index: idx++, header: line, lines: [], addedCount: 0, removedCount: 0 };
    } else if (current) {
      current.lines.push(line);
      if (line.startsWith('+') && !line.startsWith('+++')) current.addedCount++;
      else if (line.startsWith('-') && !line.startsWith('---')) current.removedCount++;
    } else {
      headerLines.push(line);
    }
  }
  if (current) hunks.push(current);

  return { headerLines, hunks };
}
