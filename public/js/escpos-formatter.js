import { ESCPOS_COMMANDS, concatBytes } from "./escpos-commands.js";
import { getPaperProfile } from "./paper-profile.js";
import { UTF8_ENCODING } from "./printer-encoding.js";

export class EscPosFormatter {
  constructor(options = {}) {
    this.profile = options.profile || getPaperProfile(options.paper || "58");
    this.encoding = options.encoding || UTF8_ENCODING;
    this.chunks = [];
  }
  command(name, ...args) {
    const factory = ESCPOS_COMMANDS[name];
    if (typeof factory !== "function") throw new RangeError(`Unknown ESC/POS command: ${name}`);
    this.chunks.push(factory(...args)); return this;
  }
  initialize() { return this.command("initialize"); }
  alignLeft() { return this.command("alignLeft"); }
  alignCenter() { return this.command("alignCenter"); }
  alignRight() { return this.command("alignRight"); }
  boldOn() { return this.command("boldOn"); }
  boldOff() { return this.command("boldOff"); }
  normalSize() { return this.command("normalSize"); }
  doubleWidth() { return this.command("doubleWidth"); }
  doubleHeight() { return this.command("doubleHeight"); }
  text(value) { this.chunks.push(this.encoding.encode(value)); return this; }
  line(value = "") { return this.text(value).command("lineFeed"); }
  separator(character = "-") {
    const token = String(character || "-").slice(0, 1);
    return this.line(token.repeat(this.profile.columns));
  }
  blankLine() { return this.command("lineFeed"); }
  feed(lines = 1) { return this.command("feed", lines); }
  cut() { return this.command("cut"); }
  build() { return concatBytes(this.chunks); }
}

export function formatLayout(layout, options = {}) {
  if (!layout || layout.type !== "receipt-layout" || !Array.isArray(layout.nodes)) throw new TypeError("Formatter requires a receipt layout object");
  const formatter = new EscPosFormatter(options);
  layout.nodes.forEach((item, index) => {
    if (item.type === "command") formatter.command(item.name, ...(item.args || []));
    else if (item.type === "text") formatter.text(item.value || "");
    else if (item.type === "line") formatter.line(item.value || "");
    else if (item.type === "separator") formatter.separator(item.character || "-");
    else if (item.type === "blankLine") formatter.blankLine();
    else if (item.type === "feed") formatter.feed(item.lines);
    else throw new RangeError(`Unsupported layout node ${index}: ${item.type}`);
  });
  return formatter.build();
}
