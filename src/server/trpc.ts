import { initTRPC } from "@trpc/server";
import type { WorkspaceIndexService } from "./workspace-index.js";

export type TrpcContext = {
  workspaceIndex: WorkspaceIndexService;
};

const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
