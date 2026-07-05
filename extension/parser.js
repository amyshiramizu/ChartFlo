// ============================================================
// CCM MINUTES PARSER
// Parses documentation patterns:
//   1a. Date-prefixed "X minutes spent": 01/19/26- 5 minutes spent...
//   1b. Date-prefixed "spent X minutes": 01/11/26 - spent 10 mins...
//   3. Date-prefixed short entries: 01-30-2026: 10 mins - ...
//   4. Undated time entries: "20 mins. -Megan H, MA"
// Excludes summary lines: "Total Time:", "Total CCM Time for the Month:"
// ============================================================

if (typeof globalThis.CCMMinuteParser !== 'undefined') {
  // Already loaded, skip
} else {

class CCMMinuteParser {

  /**
   * Main entry point - parse a full CCM note and return all time entries
   * @param {string} noteText - Full text content of the CCM note
   * @returns {object} { entries: [...], totalMinutes: number, monthYear: string }
   */
  static parseNote(noteText) {
    if (!noteText || typeof noteText !== 'string') {
      return { entries: [], totalMinutes: 0, monthYear: null, staffBreakdown: [] };
    }

    // Extract visit-level metadata from note header (Date:, CCM visit:, etc.)
    const visitInfo = this.extractVisitInfo(noteText);

    // Try to isolate the Monthly patient communication section
    const commSection = this.extractCommunicationSection(noteText);
    const textToParse = commSection || noteText;

    const entries = this.extractAllTimeEntries(textToParse);

    // Post-process: apply visit info to undated entries
    if (visitInfo.date || visitInfo.staff) {
      for (const entry of entries) {
        // For undated entries or entries whose date came from medical narrative text,
        // prefer the explicit visit date from the header
        if (visitInfo.date && (entry.source === 'undated_time' || entry.dateRaw === 'undated')) {
          entry.date = visitInfo.date;
          entry.dateRaw = this.formatDate(visitInfo.date);
        }
        // For entries with no staff or 'Unknown' staff, use visit header staff
        if (visitInfo.staff && (!entry.staff || entry.staff === 'Unknown')) {
          entry.staff = visitInfo.staff;
        }
      }
    }

    const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
    const monthYear = this.determineMonthYear(entries);
    const staffBreakdown = this.groupByStaff(entries);

    return { entries, totalMinutes, monthYear, staffBreakdown };
  }

  /**
   * Extract visit-level metadata from note headers
   * Looks for patterns like:
   *   "CCM visit: Megan H, MA"
   *   "Date: 1/31/2026"
   *   "Date of Service: 01/31/2026"
   *   "Visit Date: 1/31/2026"
   * Returns { date: {month, day, year} | null, staff: string | null }
   */
  static extractVisitInfo(text) {
    const result = { date: null, staff: null };

    // Only look in the first ~500 chars (the header area)
    const header = text.substring(0, Math.min(text.length, 500));

    // ── Extract visit date ──
    // "Date: 1/31/2026" or "Date of Service: 01/31/2026" or "Visit Date: ..."
    const datePatterns = [
      /(?:^|\n)\s*Date\s*:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/im,
      /Date\s+of\s+Service\s*:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /Visit\s+Date\s*:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
      /(?:^|\n)\s*Date\s*:\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/im,
    ];

    for (const pattern of datePatterns) {
      const match = header.match(pattern);
      if (match) {
        result.date = this.parseDate(match[1]);
        break;
      }
    }

    // ── Extract visit staff ──
    // "CCM visit: Megan H, MA" or "CCM Visit: N. Kruse, RN"
    const titles = ['CCM\\s+Coordinator', 'Coordinator', 'RN', 'LPN', 'CNA', 'MA', 'NP', 'PA', 'MD', 'DO', 'Nurse'];
    const titleGroup = '(?:' + titles.join('|') + ')\\b';

    // Try format 1: "CCM visit: FirstName LastInitial, Title" (e.g., "Megan H, MA")
    const visitStaffPattern1 = new RegExp(
      'CCM\\s+visit\\s*:\\s*([A-Z][a-z]+(?:\\s+[A-Z]\\.?)?)\\s*[,\\s]\\s*' + titleGroup,
      'i'
    );
    // Try format 2: "CCM visit: X. Lastname, Title" (e.g., "N. Kruse, RN")
    const visitStaffPattern2 = new RegExp(
      'CCM\\s+visit\\s*:\\s*([A-Z]\\.\\s*[A-Z][a-z]+)\\s*[,\\s]\\s*' + titleGroup,
      'i'
    );

    const staffMatch1 = header.match(visitStaffPattern1);
    const staffMatch2 = header.match(visitStaffPattern2);
    const staffMatch = staffMatch2 || staffMatch1; // Prefer initial.name format

    if (staffMatch) {
      result.staff = this.normalizeStaffName(staffMatch[1].trim());
    }

    return result;
  }

  /**
   * Extract the "Monthly patient communication:" section from note text
   */
  static extractCommunicationSection(text) {
    // Try multiple possible markers
    const markers = [
      'Monthly patient communication:',
      'Monthly Patient Communication:',
      'MONTHLY PATIENT COMMUNICATION:',
      'Monthly patient communication :',
    ];

    for (const marker of markers) {
      const idx = text.indexOf(marker);
      if (idx !== -1) {
        return text.substring(idx + marker.length);
      }
    }

    // Case-insensitive fallback
    const match = text.match(/monthly\s+patient\s+communication\s*:/i);
    if (match) {
      return text.substring(match.index + match[0].length);
    }

    return null;
  }

  /**
   * Extract all time entries from the communication section
   * Handles all three documentation patterns without double-counting
   * Also extracts staff initials/name for each entry
   */
  static extractAllTimeEntries(text) {
    const entries = [];
    const matchedPositions = new Set(); // Track positions to avoid double-counting

    // ── PATTERN 1a: Date-prefixed "X minutes spent" ──
    // Example: "01/19/26- 5 minutes spent opening care plan..."
    const pattern1a = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*[-–:]\s*(\d+)\s*min(?:utes?|s)?\s+spent/gi;
    let match;

    while ((match = pattern1a.exec(text)) !== null) {
      const dateStr = match[1];
      const minutes = parseInt(match[2], 10);
      const position = match.index;

      entries.push({
        date: this.parseDate(dateStr),
        dateRaw: dateStr,
        minutes: minutes,
        source: 'inline_spent',
        description: this.cleanDescription(text, match.index, match[0].length),
        position: position,
        staff: null
      });

      for (let p = position; p < position + match[0].length; p++) {
        matchedPositions.add(p);
      }
    }

    // ── PATTERN 1b: Date-prefixed "spent X minutes" (reverse order) ──
    // Example: "01/11/26 - spent 10 mins verifying..."
    const pattern1b = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*[-–:]\s*spent\s+(\d+)\s*min(?:utes?|s)?/gi;

    while ((match = pattern1b.exec(text)) !== null) {
      const position = match.index;

      // Skip if already matched by Pattern 1a
      if (matchedPositions.has(position)) continue;

      const dateStr = match[1];
      const minutes = parseInt(match[2], 10);

      entries.push({
        date: this.parseDate(dateStr),
        dateRaw: dateStr,
        minutes: minutes,
        source: 'inline_spent',
        description: this.cleanDescription(text, match.index, match[0].length),
        position: position,
        staff: null
      });

      for (let p = position; p < position + match[0].length; p++) {
        matchedPositions.add(p);
      }
    }

    // ── PATTERN 2: REMOVED ──
    // Previously matched "Total Time: X minutes" as a standalone entry.
    // However, Time Log blocks always include the individual sub-entries
    // (Discussion, Coordination, Documentation) which are caught by Pattern 4.
    // Counting "Total Time" on top of those sub-entries causes double-counting.
    // Now "Total Time:" is excluded like "Total CCM Time for the Month:".

    // ── PATTERN 3: Date-prefixed short entries ──
    // Example: "01-30-2026: 10 mins - Ordered stat X-ray..."
    // Must NOT overlap with Pattern 1 matches
    const pattern3 = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*[:\-–]\s*(\d+)\s*min/gi;

    while ((match = pattern3.exec(text)) !== null) {
      const position = match.index;

      // Skip if this position was already matched by Pattern 1
      if (matchedPositions.has(position)) continue;

      // Skip if this looks like a Time Log breakdown line
      // (e.g., "- Discussion of Chronic Conditions: 22 minutes")
      // These won't match since they don't start with a date, but double-check
      const beforeMatch = text.substring(Math.max(0, position - 5), position).trim();
      if (beforeMatch.endsWith('-') && !beforeMatch.match(/\d$/)) continue;

      const dateStr = match[1];
      const minutes = parseInt(match[2], 10);

      entries.push({
        date: this.parseDate(dateStr),
        dateRaw: dateStr,
        minutes: minutes,
        source: 'date_prefixed',
        description: this.cleanDescription(text, match.index, match[0].length),
        position: position,
        staff: null // Will be assigned below
      });

      // Mark matched positions to prevent Pattern 4 from double-counting
      for (let p = position; p < position + match[0].length; p++) {
        matchedPositions.add(p);
      }
    }

    // ── PATTERN 4: Undated time entries ──
    // Catches "X mins/minutes" NOT preceded by a date prefix
    // Example: "Total time spent with patient... 20 mins. -Megan H, MA"
    // Example: "Spent 15 minutes reviewing lab results -JF"
    // Must NOT overlap with Patterns 1-3, and must have time-related context
    const pattern4 = /(\d{1,3})\s*min(?:utes?|s)?(?:\.|,|\b)/gi;

    while ((match = pattern4.exec(text)) !== null) {
      const position = match.index;

      // Skip if any character in this match range was already matched by P1-P3
      let overlaps = false;
      for (let p = position; p < position + match[0].length; p++) {
        if (matchedPositions.has(p)) { overlaps = true; break; }
      }
      if (overlaps) continue;

      const minutes = parseInt(match[1], 10);

      // Skip unreasonable values (0 or over 500)
      if (minutes < 1 || minutes > 500) continue;

      // Skip if this is part of a summary/total line
      // Only check the text BEFORE and ON the same line as the match, not after
      const lineStart = text.lastIndexOf('\n', position);
      const currentLine = text.substring(Math.max(0, lineStart), position + match[0].length + 5).toLowerCase();
      if (currentLine.includes('total ccm time')) continue;
      if (currentLine.match(/total\s+time\s*:/)) continue;

      // Context validation: require time-related keywords within 300 chars before,
      // OR a staff attribution (dash + name/initials) within 80 chars after
      const contextStart = Math.max(0, position - 300);
      const contextBefore = text.substring(contextStart, position).toLowerCase();

      const timeKeywords = [
        'spent', 'time spent', 'communicat', 'discuss', 'review', 'called',
        'document', 'coordinate', 'assess', 'monitor', 'total time', 'phone',
        'fax', 'order', 'refill', 'medication', 'lab', 'referral', 'counsel',
        'educat', 'care plan', 'chronic'
      ];

      const hasTimeContext = timeKeywords.some(kw => contextBefore.includes(kw));

      // Check for staff attribution after the match
      const afterText = text.substring(
        position + match[0].length,
        Math.min(text.length, position + match[0].length + 80)
      );
      const hasStaffAttribution =
        /[-–]\s*[A-Z][a-z]+\s+[A-Z]/.test(afterText) ||              // "-Megan H"
        /[-–]\s*[A-Z]\.\s*[A-Z][a-z]+/.test(afterText) ||            // "-N. Kruse"
        /[-–]\s*[A-Z]{2,4}(?:\s|$|[.,])/.test(afterText);            // "-JF" or "-MA"

      if (!hasTimeContext && !hasStaffAttribution) continue;

      // Find the nearest date before this entry for dating purposes
      const nearestDate = this.findNearestDateBefore(text, position);

      // Build a description that captures context before the minutes
      const descStart = Math.max(0, position - 120);
      const descEnd = Math.min(text.length, position + match[0].length + 60);
      let desc = text.substring(descStart, descEnd).trim().replace(/\s+/g, ' ');
      if (desc.length > 120) {
        // Trim from the beginning to keep the most relevant part
        desc = '...' + desc.substring(desc.length - 117);
      }

      entries.push({
        date: nearestDate ? this.parseDate(nearestDate) : null,
        dateRaw: nearestDate || 'undated',
        minutes: minutes,
        source: 'undated_time',
        description: desc,
        position: position,
        staff: null // Will be assigned below
      });

      // Mark matched positions
      for (let p = position; p < position + match[0].length; p++) {
        matchedPositions.add(p);
      }
    }

    // ── PATTERN 5: Dash-prefixed time with staff ──
    // Catches entries like "- 30. Kaden L, MA" or "- 15 mins. -JF"
    // Often appears after a template line like "NP. ___ mins."
    // Also catches "communicating with NP.  mins. - 30. Kaden L, MA."
    const pattern5 = /[-–]\s*(\d{1,3})\s*\.?\s*(?:min(?:utes?|s)?\.?\s*)?[-–.]?\s*([A-Z][a-z]+(?:\s+[A-Z]\.?)?(?:\s*,?\s*(?:MA|RN|LPN|CNA|NP|PA|MD|DO|CCM\s*Coordinator))?)/g;

    while ((match = pattern5.exec(text)) !== null) {
      const position = match.index;

      // Skip if already matched by previous patterns
      let overlaps = false;
      for (let p = position; p < position + match[0].length; p++) {
        if (matchedPositions.has(p)) { overlaps = true; break; }
      }
      if (overlaps) continue;

      const minutes = parseInt(match[1], 10);
      if (minutes < 1 || minutes > 500) continue;

      // Skip if this is on a summary/total line (but NOT "Total time spent with patient" which is documentation)
      const lineStart = text.lastIndexOf('\n', position);
      const currentLine = text.substring(Math.max(0, lineStart), position + match[0].length + 5).toLowerCase();
      if (currentLine.includes('total ccm time')) continue;
      if (currentLine.match(/total\s+(?:monthly\s+)?(?:ccm\s+)?time\s*:/) && !currentLine.includes('spent')) continue;

      // Context: require time-related keywords within 400 chars before
      const contextStart = Math.max(0, position - 400);
      const contextBefore = text.substring(contextStart, position).toLowerCase();
      const timeKeywords5 = [
        'spent', 'time spent', 'communicat', 'discuss', 'review', 'total time',
        'mins', 'minutes', 'min.', 'chronic', 'care plan', 'ccm'
      ];
      const hasContext = timeKeywords5.some(kw => contextBefore.includes(kw));
      if (!hasContext) continue;

      const nearestDate = this.findNearestDateBefore(text, position);
      const staffName = match[2] ? match[2].trim() : null;

      const descStart = Math.max(0, position - 80);
      const descEnd = Math.min(text.length, position + match[0].length + 20);
      let desc = text.substring(descStart, descEnd).trim().replace(/\s+/g, ' ');

      entries.push({
        date: nearestDate ? this.parseDate(nearestDate) : null,
        dateRaw: nearestDate || 'undated',
        minutes: minutes,
        source: 'dash_prefixed_time',
        description: desc,
        position: position,
        staff: staffName
      });

      for (let p = position; p < position + match[0].length; p++) {
        matchedPositions.add(p);
      }
    }

    // Sort by position in text (chronological within the note)
    entries.sort((a, b) => a.position - b.position);

    // ── STAFF EXTRACTION ──
    // Now assign staff to each entry by looking at the text segment for each entry
    this.assignStaffToEntries(entries, text);

    return entries;
  }

  // ============================================================
  // STAFF / INITIALS EXTRACTION
  // ============================================================

  /**
   * Assign staff initials/name to each entry by analyzing the text
   * between each entry's position and the next entry's position
   */
  static assignStaffToEntries(entries, text) {
    // Collect all entry positions for segmenting
    const positions = entries.map(e => e.position);

    // Also add boundary positions: "Total CCM Time" and end of text
    const totalCCMPos = text.search(/Total\s+CCM\s+Time/i);
    const endPos = text.length;

    let lastFoundStaff = null;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const startPos = entry.position;

      // End of this entry's segment = start of next entry, or Total CCM, or end of text
      let segEndPos = endPos;
      if (i + 1 < entries.length) {
        segEndPos = entries[i + 1].position;
      } else if (totalCCMPos > startPos) {
        segEndPos = totalCCMPos;
      }

      const segment = text.substring(startPos, segEndPos);
      const staff = this.extractStaffFromSegment(segment);

      if (staff) {
        entry.staff = staff;
        lastFoundStaff = staff;
      } else if (lastFoundStaff) {
        // If no staff found, inherit from previous entry as last resort
        entry.staff = lastFoundStaff;
      }

      // Default to 'Unknown' if still null
      if (!entry.staff) {
        entry.staff = 'Unknown';
      }
    }
  }

  /**
   * Extract staff initials or name from a text segment (between entries)
   * Patterns recognized:
   *   1. End-of-entry initials:  ".. WM" or ". WM" or "...WM"
   *   2. Name with dash:         "-N. Kruse CCM Coordinator" or "- N. Kruse"
   *   3. Name with title:        "N. Kruse CCM Coordinator"
   *   4. Standalone initials:    "WM" at end of a phrase after punctuation
   *   5. Dash + full name + comma + title: "-Megan H, MA"
   */
  static extractStaffFromSegment(segment) {
    if (!segment) return null;

    // Clean up the segment for analysis
    const cleaned = segment.trim();

    // ── Pattern A: 2-4 uppercase initials at the END of the segment ──
    // or before a paragraph break (newline) within the segment
    // Matches: "...provider.. WM", "...provider. WM", "...notes. MA\n\n"
    // Must be preceded by punctuation, space, or line boundary (not mid-word)
    const falsePositives = ['CCM', 'HPI', 'ROS', 'HH', 'BP', 'HR', 'RPM', 'NP', 'MD', 'DO',
      'BID', 'TID', 'QD', 'PRN', 'ER', 'ED', 'PT', 'OT', 'IV', 'IM', 'PO'];

    // A1: Check end of segment
    const endInitials = cleaned.match(/[.\s,;!?]+\s*([A-Z]{2,4})\s*$/);
    if (endInitials && !falsePositives.includes(endInitials[1])) {
      return endInitials[1];
    }

    // A2: Check for initials before a newline/paragraph break (first occurrence wins)
    // This catches "...coordination notes. MA\n\nTotal time spent..."
    const newlineInitials = cleaned.match(/[.\s,;!?]+\s*([A-Z]{2,4})\s*(?:\r?\n)/);
    if (newlineInitials && !falsePositives.includes(newlineInitials[1])) {
      return newlineInitials[1];
    }

    // ── Pattern B1: Dash + initial.LastName (e.g., "-N. Kruse") ──
    const dashInitialName = cleaned.match(/[-–]\s*([A-Z]\.\s*[A-Za-z]+(?:\s+[A-Za-z]+)?)/);
    if (dashInitialName) {
      const candidate = dashInitialName[1].trim();
      if (/^[A-Z]\.\s*[A-Z][a-z]+/.test(candidate)) {
        return this.normalizeStaffName(candidate);
      }
    }

    // ── Pattern B2: Dash + full name + comma/space + title ──
    // Matches: "-Megan H, MA", "-Amy Fowers, NP", "-John Smith RN", "-Sarah K, CNA"
    // NOTE: No 'i' flag - names must start with uppercase to avoid false positives
    const titles = ['CCM\\s+Coordinator', 'CCM\\s+Coord', 'Coordinator', 'RN', 'LPN',
      'CNA', 'MA', 'NP', 'PA', 'MD', 'DO', 'Nurse'];
    const dashFullNameTitle = cleaned.match(
      new RegExp(
        '[-–]\\s*([A-Z][a-z]+(?:\\s+[A-Z]\\.?)?)\\s*[,\\s]\\s*(?:' + titles.join('|') + ')\\b'
      )
    );
    if (dashFullNameTitle) {
      return this.normalizeStaffName(dashFullNameTitle[1].trim());
    }

    // ── Pattern B3: Dash + full name (no title, but clearly a short name) ──
    // Matches: "-Megan H", "-Amy F" (first name + single letter/initial)
    const dashFullName = cleaned.match(/[-–]\s*([A-Z][a-z]+\s+[A-Z]\.?)\s*(?:[,.\s]|$)/);
    if (dashFullName) {
      return this.normalizeStaffName(dashFullName[1].trim());
    }

    // ── Pattern C: Name followed by a known title/role ──
    // Matches: "N. Kruse CCM Coordinator", "Amy Fowers NP", "Megan H, MA"
    // NOTE: No 'i' flag - name must start with uppercase to avoid false positives
    const titlePattern = new RegExp(
      '([A-Z]\\.?\\s*[A-Za-z]+(?:\\s+[A-Za-z]+)?)\\s*[,\\s]\\s*(?:' + titles.join('|') + ')\\b'
    );
    const titleMatch = cleaned.match(titlePattern);
    if (titleMatch) {
      // Extra validation: captured name should be short (real names are 1-3 words)
      const candidateName = titleMatch[1].trim();
      const wordCount = candidateName.split(/\s+/).length;
      if (wordCount <= 3) {
        return this.normalizeStaffName(candidateName);
      }
    }

    return null;
  }

  /**
   * Look backwards through text to find the nearest staff identifier
   * Used for "Total Time" entries that don't have a direct staff tag
   */
  static extractStaffLookingBack(text, position) {
    // Get text before this position (up to 2000 chars back for the assessment block)
    const lookbackSize = Math.min(position, 2000);
    const textBefore = text.substring(position - lookbackSize, position);

    // Strategy: look for the most reliable patterns first

    // ── Pattern 1: "X. Lastname Title" (e.g., "N. Kruse CCM Coordinator") ──
    // REQUIRE initial + period format to avoid matching common words
    const titles = ['CCM\\s+Coordinator', 'CCM\\s+Coord', 'Coordinator', 'RN', 'LPN',
      'CNA', 'MA', 'NP', 'PA', 'Nurse'];
    const titlePattern = new RegExp(
      '([A-Z]\\.\\s*[A-Za-z]+)\\s+(?:' + titles.join('|') + ')\\b',
      'gi'
    );

    let lastMatch = null;
    let m;
    while ((m = titlePattern.exec(textBefore)) !== null) {
      lastMatch = m[1].trim();
    }

    if (lastMatch) {
      return this.normalizeStaffName(lastMatch);
    }

    // ── Pattern 2: Dash + initial name (e.g., "-N. Kruse") ──
    const dashPattern = /[-–]\s*([A-Z]\.\s*[A-Z][a-z]+)/g;
    while ((m = dashPattern.exec(textBefore)) !== null) {
      lastMatch = m[1].trim();
    }

    if (lastMatch) {
      return this.normalizeStaffName(lastMatch);
    }

    // ── Pattern 3: End-of-line initials before dates ──
    // Look for patterns like "...provider.. WM\n01-30" in the text
    const initialsPattern = /[.\s]+([A-Z]{2,4})\s*(?:\d{1,2}[\/\-]|\n|$)/g;
    const falsePositives = ['CCM', 'HPI', 'ROS', 'HH', 'BP', 'HR', 'RPM', 'NP', 'MD', 'DO',
      'BID', 'TID', 'QD', 'PRN', 'ER', 'ED', 'PT', 'OT', 'IV', 'IM', 'PO'];

    while ((m = initialsPattern.exec(textBefore)) !== null) {
      if (!falsePositives.includes(m[1])) {
        lastMatch = m[1];
      }
    }

    if (lastMatch) {
      return lastMatch;
    }

    return null;
  }

  /**
   * Normalize a staff name for consistent grouping
   * "N. Kruse CCM Coordinator" → "N. Kruse"
   * "N.  Kruse" → "N. Kruse"
   */
  static normalizeStaffName(name) {
    if (!name) return null;

    // Remove titles
    let cleaned = name
      .replace(/\s+(CCM|RN|LPN|CNA|MA|NP|PA|MD|DO)\b/gi, '')
      .replace(/\s+Coordinator\b/gi, '')
      .replace(/\s+Nurse\b/gi, '')
      .trim();

    // Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ');

    // Normalize initial format: "N.Kruse" → "N. Kruse"
    cleaned = cleaned.replace(/^([A-Z])\.\s*/, '$1. ');

    return cleaned || name;
  }

  /**
   * Group entries by staff member
   */
  static groupByStaff(entries) {
    const groups = {};

    for (const entry of entries) {
      const key = entry.staff || 'Unknown';

      if (!groups[key]) {
        groups[key] = {
          staff: key,
          entries: [],
          totalMinutes: 0
        };
      }

      groups[key].entries.push(entry);
      groups[key].totalMinutes += entry.minutes;
    }

    // Sort by total minutes descending
    return Object.values(groups).sort((a, b) => b.totalMinutes - a.totalMinutes);
  }

  /**
   * Group entries by month AND staff for comprehensive breakdown
   */
  static groupByMonthAndStaff(entries) {
    const groups = {};

    for (const entry of entries) {
      const monthKey = entry.date
        ? `${entry.date.year}-${String(entry.date.month).padStart(2, '0')}`
        : 'unknown';
      const staffKey = entry.staff || 'Unknown';
      const key = `${monthKey}|${staffKey}`;

      if (!groups[key]) {
        groups[key] = {
          monthYear: entry.date ? this.formatMonthYear(entry.date) : 'Unknown',
          monthSortKey: monthKey,
          staff: staffKey,
          entries: [],
          totalMinutes: 0
        };
      }

      groups[key].entries.push(entry);
      groups[key].totalMinutes += entry.minutes;
    }

    return Object.values(groups).sort((a, b) => {
      const monthCmp = a.monthSortKey.localeCompare(b.monthSortKey);
      if (monthCmp !== 0) return monthCmp;
      return b.totalMinutes - a.totalMinutes; // Higher minutes first within month
    });
  }

  /**
   * Find the nearest date string before a given position in the text
   */
  static findNearestDateBefore(text, position) {
    const textBefore = text.substring(0, position);
    // Look for date patterns: MM/DD/YY, MM-DD-YYYY, MM/DD/YYYY, etc.
    const datePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/g;
    let lastDate = null;
    let match;

    while ((match = datePattern.exec(textBefore)) !== null) {
      lastDate = match[1];
    }

    // Also check for "Date of Service: YYYY-MM-DD" format
    const dosPattern = /Date\s+of\s+Service:\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/gi;
    while ((match = dosPattern.exec(textBefore)) !== null) {
      lastDate = match[1];
    }

    return lastDate;
  }

  /**
   * Parse a date string into { month, year, day } object
   * Handles: MM/DD/YY, MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD
   */
  static parseDate(dateStr) {
    if (!dateStr) return null;

    let month, day, year;
    const parts = dateStr.split(/[\/\-]/);

    if (parts.length !== 3) return null;

    const p0 = parseInt(parts[0], 10);
    const p1 = parseInt(parts[1], 10);
    const p2 = parseInt(parts[2], 10);

    if (p0 > 100) {
      // YYYY-MM-DD format
      year = p0;
      month = p1;
      day = p2;
    } else {
      // MM/DD/YY or MM/DD/YYYY
      month = p0;
      day = p1;
      year = p2;
    }

    // Handle 2-digit year
    if (year < 100) {
      year += 2000;
    }

    return { month, day, year };
  }

  /**
   * Get month/year string from entries
   */
  static determineMonthYear(entries) {
    const months = [
      '', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // Count occurrences of each month/year combo to find the most common
    const counts = {};
    for (const entry of entries) {
      if (entry.date && entry.date.month && entry.date.year) {
        const key = `${entry.date.month}-${entry.date.year}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }

    // Find the most common month/year
    let bestKey = null;
    let bestCount = 0;
    for (const [key, count] of Object.entries(counts)) {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    }

    if (bestKey) {
      const [month, year] = bestKey.split('-').map(Number);
      return `${months[month]} ${year}`;
    }
    return null;
  }

  /**
   * Get a clean description snippet from the text near a match
   */
  static cleanDescription(text, startPos, matchLength) {
    const endPos = Math.min(text.length, startPos + matchLength + 80);
    let snippet = text.substring(startPos, endPos).trim();

    // Clean up the snippet
    snippet = snippet.replace(/\s+/g, ' ');
    if (snippet.length > 100) {
      snippet = snippet.substring(0, 97) + '...';
    }
    return snippet;
  }

  /**
   * Format a date object as MM/DD/YYYY
   */
  static formatDate(dateObj) {
    if (!dateObj) return 'Unknown';
    const mm = String(dateObj.month).padStart(2, '0');
    const dd = String(dateObj.day).padStart(2, '0');
    return `${mm}/${dd}/${dateObj.year}`;
  }

  /**
   * Format a date object as "Month YYYY"
   */
  static formatMonthYear(dateObj) {
    const months = [
      '', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    if (!dateObj) return 'Unknown';
    return `${months[dateObj.month]} ${dateObj.year}`;
  }

  /**
   * Group entries by month/year for multi-month notes
   */
  static groupByMonth(entries) {
    const groups = {};

    for (const entry of entries) {
      const key = entry.date
        ? `${entry.date.year}-${String(entry.date.month).padStart(2, '0')}`
        : 'unknown';

      if (!groups[key]) {
        groups[key] = {
          monthYear: entry.date ? this.formatMonthYear(entry.date) : 'Unknown',
          sortKey: key,
          entries: [],
          totalMinutes: 0
        };
      }

      groups[key].entries.push(entry);
      groups[key].totalMinutes += entry.minutes;
    }

    // Sort by date
    return Object.values(groups).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }

  /**
   * Check if the "Total CCM Time for the month:" field is present and empty
   */
  static findTotalCCMField(text) {
    const pattern = /Total\s+CCM\s+Time\s+for\s+the\s+month\s*:\s*(.*)/i;
    const match = text.match(pattern);
    if (match) {
      return {
        found: true,
        currentValue: match[1].trim(),
        isEmpty: match[1].trim() === '' || match[1].trim() === '0',
        fullMatch: match[0],
        searchText: 'Total CCM Time for the month:'
      };
    }
    return { found: false };
  }
}
globalThis.CCMMinuteParser = CCMMinuteParser;
} // end if not already loaded

// Make available in both browser and Node.js environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.CCMMinuteParser;
}
