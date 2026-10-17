// Splits a USB-serial byte stream into text lines with a hard length limit.
// Handles chunks that split lines (and multi-byte UTF-8 sequences) at any
// point, CR/LF/CRLF terminators, and oversized lines, which are dropped whole
// and counted, never truncated into something that looks valid.

export interface SplitResult {
  lines: string[];
  overflows: number;
}

export class LineSplitter {
  private readonly decoder = new TextDecoder('utf-8', { fatal: false });
  private buffer = '';
  private overflowing = false;

  constructor(private readonly maxLineLength: number) {}

  push(chunk: Uint8Array): SplitResult {
    return this.pushText(this.decoder.decode(chunk, { stream: true }));
  }

  pushText(text: string): SplitResult {
    const lines: string[] = [];
    let overflows = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c !== 10 && c !== 13) continue;
      const piece = text.slice(start, i);
      start = i + 1;
      if (this.overflowing) {
        this.overflowing = false;
        this.buffer = '';
        overflows++;
        continue;
      }
      const line = this.buffer + piece;
      this.buffer = '';
      if (line.length > this.maxLineLength) {
        overflows++;
      } else if (line.length > 0) {
        lines.push(line);
      }
    }
    if (!this.overflowing) {
      this.buffer += text.slice(start);
      if (this.buffer.length > this.maxLineLength) {
        // Stop buffering an unterminated runaway line; drop it at its end.
        this.overflowing = true;
        this.buffer = '';
      }
    }
    return { lines, overflows };
  }

  /** Discards any partial line (e.g. after a reconnect). */
  reset(): void {
    this.buffer = '';
    this.overflowing = false;
  }
}
