export interface SubtitleTextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color?: string;
}

type SubtitleStyle = Omit<SubtitleTextRun, "text">;
type StyleTag = "b" | "i" | "u" | "s" | "font";

const DEFAULT_STYLE: SubtitleStyle = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
};

const SAFE_NAMED_COLORS = new Set([
  "aqua", "black", "blue", "cyan", "fuchsia", "gray", "green", "grey",
  "lime", "magenta", "maroon", "navy", "olive", "orange", "purple", "red",
  "silver", "teal", "white", "yellow",
]);

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
    const key = entity.slice(1, -1).toLowerCase();
    if (key === "amp") return "&";
    if (key === "lt") return "<";
    if (key === "gt") return ">";
    if (key === "quot") return '"';
    if (key === "apos") return "'";
    const radix = key.startsWith("#x") ? 16 : 10;
    const number = Number.parseInt(key.replace(/^#x?/, ""), radix);
    return Number.isFinite(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  });
}

function safeColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (/^#[\da-f]{3,8}$/i.test(normalized) || SAFE_NAMED_COLORS.has(normalized)) return normalized;
  return undefined;
}

function sameStyle(left: SubtitleStyle, right: SubtitleStyle): boolean {
  return left.bold === right.bold && left.italic === right.italic &&
    left.underline === right.underline && left.strike === right.strike &&
    left.color === right.color;
}

export function parseSubtitleMarkup(value: string): SubtitleTextRun[] {
  const tokenPattern = /<[^>]*>|\{\\[^}]*\}/g;
  const runs: SubtitleTextRun[] = [];
  const stack: Array<{ tag: StyleTag; previous: SubtitleStyle }> = [];
  let style: SubtitleStyle = { ...DEFAULT_STYLE };
  let cursor = 0;

  const append = (text: string) => {
    const decoded = decodeEntities(text);
    if (!decoded) return;
    const previous = runs.at(-1);
    if (previous && sameStyle(previous, style)) previous.text += decoded;
    else runs.push({ text: decoded, ...style });
  };

  const openTag = (tag: StyleTag, next: SubtitleStyle) => {
    stack.push({ tag, previous: style });
    style = next;
  };

  for (const match of value.matchAll(tokenPattern)) {
    const index = match.index ?? cursor;
    append(value.slice(cursor, index));
    const token = match[0];

    if (token.startsWith("{")) {
      if (/\\r(?:[^\\}]*)?(?=\\|})/i.test(token)) style = { ...DEFAULT_STYLE };
      for (const command of token.matchAll(/\\([ibus])([01])/gi)) {
        const enabled = command[2] === "1";
        const property = command[1].toLowerCase();
        if (property === "i") style = { ...style, italic: enabled };
        else if (property === "b") style = { ...style, bold: enabled };
        else if (property === "u") style = { ...style, underline: enabled };
        else if (property === "s") style = { ...style, strike: enabled };
      }
    } else if (/^<br\s*\/?>$/i.test(token)) {
      append("\n");
    } else {
      const closing = token.match(/^<\/\s*(b|i|u|s|font)\s*>$/i);
      if (closing) {
        const tag = closing[1].toLowerCase() as StyleTag;
        const stackIndex = stack.map((entry) => entry.tag).lastIndexOf(tag);
        if (stackIndex >= 0) {
          style = stack[stackIndex].previous;
          stack.splice(stackIndex);
        }
      } else {
        const opening = token.match(/^<\s*(b|i|u|s)\s*>$/i);
        const font = token.match(/^<\s*font\b([^>]*)>$/i);
        if (opening) {
          const tag = opening[1].toLowerCase() as Exclude<StyleTag, "font">;
          openTag(tag, {
            ...style,
            bold: tag === "b" || style.bold,
            italic: tag === "i" || style.italic,
            underline: tag === "u" || style.underline,
            strike: tag === "s" || style.strike,
          });
        } else if (font) {
          const colorMatch = font[1].match(/\bcolor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
          openTag("font", { ...style, color: safeColor(colorMatch?.[1] ?? colorMatch?.[2] ?? colorMatch?.[3]) ?? style.color });
        }
        // Unknown HTML tags are intentionally discarded instead of being injected.
      }
    }
    cursor = index + token.length;
  }

  append(value.slice(cursor));
  return runs;
}
