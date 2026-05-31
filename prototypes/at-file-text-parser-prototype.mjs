// PROTOTYPE - throwaway pure text parser/replacer for pi-webui @ file completion.
//
// Question: can Pi TUI's line/column @ path completion semantics be adapted to
// a textarea's full text plus cursor offset without converting the textarea
// into line/column form?

const PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "=", "\n", "\r"]);

function findLastDelimiter(text) {
	for (let i = text.length - 1; i >= 0; i -= 1) {
		if (PATH_DELIMITERS.has(text[i] ?? "")) {
			return i;
		}
	}
	return -1;
}

function isTokenStart(text, index) {
	return index === 0 || PATH_DELIMITERS.has(text[index - 1] ?? "");
}

function findUnclosedQuoteStart(text) {
	let quoteStart = -1;

	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === '"') {
			quoteStart = quoteStart === -1 ? i : -1;
		}
	}

	return quoteStart === -1 ? null : quoteStart;
}

function extractQuotedAtPrefix(textBeforeCursor, absoluteBaseIndex) {
	const quoteStart = findUnclosedQuoteStart(textBeforeCursor);
	if (quoteStart === null) {
		return null;
	}

	if (quoteStart > 0 && textBeforeCursor[quoteStart - 1] === "@") {
		const atIndex = quoteStart - 1;
		if (!isTokenStart(textBeforeCursor, atIndex)) {
			return null;
		}

		return {
			prefix: textBeforeCursor.slice(atIndex),
			startIndex: absoluteBaseIndex + atIndex,
			isQuoted: true,
		};
	}

	return null;
}

function parsePathPrefix(prefix) {
	if (prefix.startsWith('@"')) {
		return { rawPrefix: prefix.slice(2), isAtPrefix: true, isQuotedPrefix: true };
	}
	if (prefix.startsWith("@")) {
		return { rawPrefix: prefix.slice(1), isAtPrefix: true, isQuotedPrefix: false };
	}
	throw new Error(`Expected an @ prefix, got ${prefix}`);
}

export function findAtCompletionContext(text, cursorIndex, selectionEnd = cursorIndex) {
	if (cursorIndex !== selectionEnd) {
		return null;
	}
	if (cursorIndex < 0 || cursorIndex > text.length) {
		throw new Error(`cursorIndex ${cursorIndex} is outside text length ${text.length}`);
	}

	const lineStartIndex = Math.max(text.lastIndexOf("\n", cursorIndex - 1) + 1, 0);
	const textBeforeCursor = text.slice(lineStartIndex, cursorIndex);

	const quotedPrefix = extractQuotedAtPrefix(textBeforeCursor, lineStartIndex);
	if (quotedPrefix) {
		const parsed = parsePathPrefix(quotedPrefix.prefix);
		return {
			...quotedPrefix,
			endIndex: cursorIndex,
			rawPrefix: parsed.rawPrefix,
			isQuoted: parsed.isQuotedPrefix,
			isAtPrefix: parsed.isAtPrefix,
		};
	}

	const lastDelimiterIndex = findLastDelimiter(textBeforeCursor);
	const tokenStart = lastDelimiterIndex === -1 ? 0 : lastDelimiterIndex + 1;
	if (textBeforeCursor[tokenStart] !== "@") {
		return null;
	}
	if (!isTokenStart(textBeforeCursor, tokenStart)) {
		return null;
	}

	const prefix = textBeforeCursor.slice(tokenStart);
	const parsed = parsePathPrefix(prefix);
	return {
		prefix,
		startIndex: lineStartIndex + tokenStart,
		endIndex: cursorIndex,
		rawPrefix: parsed.rawPrefix,
		isQuoted: parsed.isQuotedPrefix,
		isAtPrefix: parsed.isAtPrefix,
	};
}

export function applyAtCompletion(text, cursorIndex, context, item) {
	if (!context) {
		throw new Error("Cannot apply a completion without an @ context");
	}

	const beforePrefix = text.slice(0, context.startIndex);
	const afterCursor = text.slice(cursorIndex);
	const hasLeadingQuoteAfterCursor = afterCursor.startsWith('"');
	const hasTrailingQuoteInItem = item.value.endsWith('"');
	const adjustedAfterCursor =
		context.isQuoted && hasTrailingQuoteInItem && hasLeadingQuoteAfterCursor ? afterCursor.slice(1) : afterCursor;

	const suffix = item.isDirectory ? "" : " ";
	const insertedValue = item.value + suffix;
	const nextText = beforePrefix + insertedValue + adjustedAfterCursor;
	const cursorOffset = item.isDirectory && hasTrailingQuoteInItem ? item.value.length - 1 : insertedValue.length;

	return {
		text: nextText,
		cursorIndex: beforePrefix.length + cursorOffset,
	};
}

