export const AT_FILE_PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);

export function findLastAtFilePathDelimiter(text) {
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (AT_FILE_PATH_DELIMITERS.has(text[i] ?? "")) return i;
  }
  return -1;
}

export function isAtFileTokenStart(text, index) {
  return index === 0 || AT_FILE_PATH_DELIMITERS.has(text[index - 1] ?? "");
}

export function findUnclosedAtFileQuoteStart(text) {
  let quoteStart = -1;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '"') {
      quoteStart = quoteStart === -1 ? i : -1;
    }
  }

  return quoteStart === -1 ? null : quoteStart;
}

export function parseAtFilePrefix(prefix) {
  if (prefix.startsWith('@"')) {
    return { rawPrefix: prefix.slice(2), isAtPrefix: true, isQuotedPrefix: true };
  }
  if (prefix.startsWith("@")) {
    return { rawPrefix: prefix.slice(1), isAtPrefix: true, isQuotedPrefix: false };
  }
  throw new Error(`Expected an @ file completion prefix, got ${prefix}`);
}

export function extractQuotedAtFilePrefix(textBeforeCursor, absoluteBaseIndex = 0) {
  const quoteStart = findUnclosedAtFileQuoteStart(textBeforeCursor);
  if (quoteStart === null) return null;
  if (quoteStart === 0 || textBeforeCursor[quoteStart - 1] !== "@") return null;

  const atIndex = quoteStart - 1;
  if (!isAtFileTokenStart(textBeforeCursor, atIndex)) return null;

  return {
    prefix: textBeforeCursor.slice(atIndex),
    startIndex: absoluteBaseIndex + atIndex,
    isQuoted: true,
  };
}

export function findAtFileCompletionContext(text, cursorIndex, selectionEnd = cursorIndex) {
  if (cursorIndex !== selectionEnd) return null;
  if (cursorIndex < 0 || cursorIndex > text.length) {
    throw new Error(`cursorIndex ${cursorIndex} is outside text length ${text.length}`);
  }

  const lineStartIndex = Math.max(text.lastIndexOf("\n", cursorIndex - 1) + 1, 0);
  const textBeforeCursor = text.slice(lineStartIndex, cursorIndex);

  const quotedPrefix = extractQuotedAtFilePrefix(textBeforeCursor, lineStartIndex);
  if (quotedPrefix) {
    const parsed = parseAtFilePrefix(quotedPrefix.prefix);
    return {
      ...quotedPrefix,
      endIndex: cursorIndex,
      rawPrefix: parsed.rawPrefix,
      isQuoted: parsed.isQuotedPrefix,
      isAtPrefix: parsed.isAtPrefix,
    };
  }

  const lastDelimiterIndex = findLastAtFilePathDelimiter(textBeforeCursor);
  const tokenStart = lastDelimiterIndex === -1 ? 0 : lastDelimiterIndex + 1;
  if (textBeforeCursor[tokenStart] !== "@") return null;
  if (!isAtFileTokenStart(textBeforeCursor, tokenStart)) return null;

  const prefix = textBeforeCursor.slice(tokenStart);
  const parsed = parseAtFilePrefix(prefix);
  return {
    prefix,
    startIndex: lineStartIndex + tokenStart,
    endIndex: cursorIndex,
    rawPrefix: parsed.rawPrefix,
    isQuoted: parsed.isQuotedPrefix,
    isAtPrefix: parsed.isAtPrefix,
  };
}
