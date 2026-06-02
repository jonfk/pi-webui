declare module "../../public/file-completion-grammar.mjs" {
  export type AtFilePrefix = {
    rawPrefix: string;
    isAtPrefix: true;
    isQuotedPrefix: boolean;
  };

  export type AtFileCompletionContext = {
    prefix: string;
    startIndex: number;
    endIndex: number;
    rawPrefix: string;
    isQuoted: boolean;
    isAtPrefix: true;
  };

  export const AT_FILE_PATH_DELIMITERS: Set<string>;
  export function findLastAtFilePathDelimiter(text: string): number;
  export function isAtFileTokenStart(text: string, index: number): boolean;
  export function findUnclosedAtFileQuoteStart(text: string): number | null;
  export function parseAtFilePrefix(prefix: string): AtFilePrefix;
  export function extractQuotedAtFilePrefix(
    textBeforeCursor: string,
    absoluteBaseIndex?: number,
  ): Pick<AtFileCompletionContext, "prefix" | "startIndex" | "isQuoted"> | null;
  export function findAtFileCompletionContext(
    text: string,
    cursorIndex: number,
    selectionEnd?: number,
  ): AtFileCompletionContext | null;
}
