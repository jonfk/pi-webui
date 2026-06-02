import type { FileCompletionItem } from "./file-completion.js";

export type FileCompletionRequest = {
  requestId: string;
  prefix: string;
};

type ActiveSearch<Request extends FileCompletionRequest> = Request & {
  requestId: string;
  prefix: string;
  abortController: AbortController;
};

export class FileCompletionSearchController<Request extends FileCompletionRequest = FileCompletionRequest> {
  private activeSearch: ActiveSearch<Request> | null = null;
  private closed = false;

  constructor(private readonly options: {
    search: (request: Request & { signal: AbortSignal }) => Promise<FileCompletionItem[]>;
    emit: (packet: { type: "file_completion_result"; payload: FileCompletionRequest & { items: FileCompletionItem[] } }) => void;
    isOpen: () => boolean;
    logger: { error: (message: string, fields?: Record<string, unknown>) => void };
  }) {}

  request(request: Request): void {
    if (this.closed) {
      return;
    }

    this.abortActive("replaced");

    const abortController = new AbortController();
    const activeSearch = { ...request, abortController };
    this.activeSearch = activeSearch;

    void this.options.search({ ...request, signal: abortController.signal })
      .then((items) => {
        if (this.activeSearch !== activeSearch || abortController.signal.aborted || !this.options.isOpen()) {
          return;
        }
        this.activeSearch = null;
        this.options.emit({
          type: "file_completion_result",
          payload: { requestId: request.requestId, prefix: request.prefix, items },
        });
      })
      .catch((error) => {
        if (abortController.signal.aborted || this.activeSearch !== activeSearch) {
          return;
        }
        this.activeSearch = null;
        this.options.logger.error("file completion search failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!this.options.isOpen()) {
          return;
        }
        this.options.emit({
          type: "file_completion_result",
          payload: { requestId: request.requestId, prefix: request.prefix, items: [] },
        });
      });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abortActive("socket_closed");
  }

  abortActive(reason: string): void {
    if (!this.activeSearch) return;
    this.activeSearch.abortController.abort(reason);
    this.activeSearch = null;
  }

  abortRequest(requestId: string, reason: string): void {
    if (this.activeSearch?.requestId !== requestId) return;
    this.abortActive(reason);
  }
}
