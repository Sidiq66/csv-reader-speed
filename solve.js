// csv-reader-speed: a fast, dependency-free drop-in replacement for csv-reader 1.0.0.
//
// run(input) reads one case's input {text, header} and returns exactly the answer csv-reader 1.0.0
// returns — {columns, rows, errors} — but reads it with charCodeAt scans and slice extraction
// instead of one character at a time: a clean field is found by scanning for its terminator and
// sliced out whole, and only the broken constructs (a stray CR, a doubled quote, a CR inside
// quotes) fall back to a segment-by-segment read of just that field.
//
// The reading policy, identical to csv-reader's:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled ("" inside it is
//     one quote, and each CRLF or lone CR inside it reads as LF); what follows its closing quote,
//     up to the next comma or line break, is appended as it stands (quote_junk, when anything was
//     appended); a quote that never closes is a literal character and the text after it is read
//     again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed
//     or converted;
//   - columns is the first record when header is true, else null; rows holds the records after it
//     (every record when header is false), each padded with "" (short_row) or cut (long_row) to
//     the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on (every LF, CRLF
//     and lone CR inside a quoted field counted), row its record's index in rows (null for the
//     header), in the order met.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to the next.

/** How a field ended: at a comma (the record goes on), at a line break, or at the end of the text. */
const COMMA = 0;
const BREAK = 1;
const END = 2;

/** The characters that end a plain unquoted run: comma, LF and CR. (A quote mid-field is literal.) */
const SPECIAL = new Uint8Array(65536);
SPECIAL[44] = 1;
SPECIAL[10] = 1;
SPECIAL[13] = 1;

/** Inside a quoted field only the quote, CR and LF interrupt a plain run; a comma is content. */
const QSPECIAL = new Uint8Array(65536);
QSPECIAL[10] = 1;
QSPECIAL[13] = 1;
QSPECIAL[34] = 1;

/** csv-reader's answer for one case's input, read faster. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field being read: its value, how it ended, and how many characters its last read appended
  // (the junk test after a closing quote reads that count).
  let value = '';
  let ended = END;
  let added = 0;

  // Reads unquoted characters from pos onto `prefix`, up to the next comma or line break: a CR not
  // followed by LF is dropped (stray_cr). Sets value, ended and added.
  function readUnquoted(prefix) {
    // Fast scan: a clean run up to the next comma, LF or CRLF is sliced out whole.
    let i = pos;
    while (i < n && SPECIAL[text.charCodeAt(i)] === 0) i++;
    if (i < n && text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) !== 10) {
      readUnquotedStray(prefix, i); // a stray CR: finish this read segment by segment
      return;
    }
    value = prefix + text.slice(pos, i);
    added = i - pos;
    if (i >= n) {
      pos = i;
      ended = END;
    } else if (text.charCodeAt(i) === 44) {
      pos = i + 1;
      ended = COMMA;
    } else if (text.charCodeAt(i) === 10) {
      pos = i + 1;
      line += 1;
      ended = BREAK;
    } else {
      pos = i + 2; // CRLF
      line += 1;
      ended = BREAK;
    }
  }

  // The slow finish of an unquoted read, from a stray CR at i: the clean segment before it is kept,
  // each lone CR is dropped with its error, and the plain runs between specials are sliced whole.
  function readUnquotedStray(prefix, i) {
    let v = prefix + text.slice(pos, i);
    added = i - pos;
    let p = i;
    while (p < n) {
      const c = text.charCodeAt(p);
      if (c === 44) {
        pos = p + 1;
        value = v;
        ended = COMMA;
        return;
      }
      if (c === 10) {
        pos = p + 1;
        line += 1;
        value = v;
        ended = BREAK;
        return;
      }
      if (c === 13) {
        if (text.charCodeAt(p + 1) === 10) {
          pos = p + 2;
          line += 1;
          value = v;
          ended = BREAK;
          return;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        p += 1;
        continue;
      }
      let s = p;
      while (p < n && SPECIAL[text.charCodeAt(p)] === 0) p++;
      v += text.slice(s, p);
      added += p - s;
    }
    pos = p;
    value = v;
    ended = END;
  }

  // What follows a closing quote, with pos just past it and value holding the quoted content: at a
  // comma, a line break or the end of the text the field is done; anything else is appended as it
  // stands, up to the next comma or line break (quote_junk, when it appended anything).
  function afterQuote() {
    if (pos >= n) {
      ended = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      ended = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      ended = BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      ended = BREAK;
      return;
    }
    readUnquoted(value);
    if (added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
  }

  // Reads a quoted field whose opening quote is at pos. Sets value and ended.
  function readQuoted() {
    const open = pos;
    // Fast scan: the field closes at the next quote, with no CR and no doubled quote inside, so
    // its content is one slice; the LFs inside it are counted as they pass.
    let j = open + 1;
    let lfs = 0;
    while (j < n) {
      while (j < n && QSPECIAL[text.charCodeAt(j)] === 0) j++;
      if (j >= n || text.charCodeAt(j) !== 10) break;
      lfs += 1;
      j++;
    }
    if (j < n && text.charCodeAt(j) === 34 && text.charCodeAt(j + 1) !== 34) {
      value = text.slice(open + 1, j);
      line += lfs;
      pos = j + 1;
      afterQuote();
      return;
    }
    readQuotedSlow(open);
  }

  // The slow read of a quoted field whose opening quote is at open: a doubled quote, a CR inside,
  // or no closing quote at all. Plain runs are sliced whole; "" is one quote; each CR or CRLF is
  // one LF; a quote that never closes makes the opening quote a literal character and the rest of
  // the field is read again as unquoted.
  function readQuotedSlow(open) {
    const openLine = line;
    let v = '';
    let l = openLine;
    let p = open + 1;
    let closed = false;
    while (p < n) {
      let s = p;
      while (p < n) {
        while (p < n && QSPECIAL[text.charCodeAt(p)] === 0) p++;
        if (p < n && text.charCodeAt(p) === 10) {
          l += 1;
          p++;
          continue;
        }
        break;
      }
      if (p > s) v += text.slice(s, p);
      if (p >= n) break;
      const c = text.charCodeAt(p);
      if (c === 34) {
        if (text.charCodeAt(p + 1) === 34) {
          v += '"';
          p += 2;
          continue;
        }
        p += 1;
        closed = true;
        break;
      }
      v += '\n';
      l += 1;
      p += text.charCodeAt(p + 1) === 10 ? 2 : 1;
    }
    if (!closed) {
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      readUnquoted('"');
      return;
    }
    value = v;
    line = l;
    pos = p;
    afterQuote();
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      if (pos < n && text.charCodeAt(pos) === 34) {
        quoted = true;
        readQuoted();
        fields.push(value);
      } else {
        quoted = false;
        // A plain field, read inline: a clean run up to the next comma, LF or CRLF, sliced whole;
        // only a stray CR hands the rest of the field to the slow read.
        let i = pos;
        while (i < n && SPECIAL[text.charCodeAt(i)] === 0) i++;
        if (i < n && text.charCodeAt(i) === 13 && text.charCodeAt(i + 1) !== 10) {
          readUnquotedStray('', i);
          fields.push(value);
        } else {
          fields.push(text.slice(pos, i));
          if (i >= n) {
            pos = i;
            ended = END;
          } else if (text.charCodeAt(i) === 44) {
            pos = i + 1;
            ended = COMMA;
          } else if (text.charCodeAt(i) === 10) {
            pos = i + 1;
            line += 1;
            ended = BREAK;
          } else {
            pos = i + 2; // CRLF
            line += 1;
            ended = BREAK;
          }
        }
      }
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
