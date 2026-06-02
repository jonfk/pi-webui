import type { FileCompletionItem } from "./file-completion.js";
import { searchFileCompletions } from "./file-completion.js";
import {
  FileCompletionSearchController,
  type FileCompletionRequest,
} from "./file-completion-controller.js";

export type FileCompletionResultPacket = {
  type: "file_completion_result";
  payload: FileCompletionRequest & { items: FileCompletionItem[] };
};

type FileCompletionSearchContext = {
  cwd: string;
  homeDir: string;
};

type FileCompletionSearchRequest = FileCompletionRequest & FileCompletionSearchContext;

type Logger = {
  error: (message: string, fields?: Record<string, unknown>) => void;
};

export type FileCompletionEndpointOptions = {
  getSearchContext: () => FileCompletionSearchContext | null;
  send: (packet: FileCompletionResultPacket) => void;
  isOpen: () => boolean;
  logger: Logger;
  search?: (request: FileCompletionSearchRequest & { signal: AbortSignal }) => Promise<FileCompletionItem[]>;
};

type FileCompletionRequestPacket = {
  type: "file_completion_request";
  requestId: unknown;
  prefix: unknown;
};

function isFileCompletionRequestPacket(packet: unknown): packet is FileCompletionRequestPacket {
  return (
    typeof packet === "object"
    && packet !== null
    && (packet as { type?: unknown }).type === "file_completion_request"
  );
}

function parseFileCompletionRequest(packet: FileCompletionRequestPacket): FileCompletionRequest {
  if (typeof packet.requestId !== "string" || packet.requestId.length === 0) {
    throw new Error("file_completion_request.requestId must be a non-empty string");
  }
  if (typeof packet.prefix !== "string" || !packet.prefix.startsWith("@")) {
    throw new Error("file_completion_request.prefix must be an @ file completion prefix");
  }
  return { requestId: packet.requestId, prefix: packet.prefix };
}

export class FileCompletionEndpoint {
  private readonly searches: FileCompletionSearchController<FileCompletionSearchRequest>;

  constructor(private readonly options: FileCompletionEndpointOptions) {
    this.searches = new FileCompletionSearchController<FileCompletionSearchRequest>({
      search: options.search ?? ((request) => searchFileCompletions({
        cwd: request.cwd,
        homeDir: request.homeDir,
        prefix: request.prefix,
        signal: request.signal,
        logger: options.logger,
      })),
      emit: options.send,
      isOpen: options.isOpen,
      logger: options.logger,
    });
  }

  handle(packet: unknown): boolean {
    if (!isFileCompletionRequestPacket(packet)) {
      return false;
    }

    const request = parseFileCompletionRequest(packet);
    const context = this.options.getSearchContext();
    if (!context) {
      this.sendEmptyResult(request);
      return true;
    }

    this.searches.request({ ...request, ...context });
    return true;
  }

  abortRuntimeWork(): void {
    this.searches.abortActive("runtime_changed");
  }

  close(): void {
    this.searches.close();
  }

  private sendEmptyResult(request: FileCompletionRequest): void {
    this.options.send({
      type: "file_completion_result",
      payload: { ...request, items: [] },
    });
  }
}

export function createFileCompletionEndpoint(options: FileCompletionEndpointOptions): FileCompletionEndpoint {
  return new FileCompletionEndpoint(options);
}
