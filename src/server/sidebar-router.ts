import { z } from "zod";
import { publicProcedure, router } from "./trpc.js";

export const appRouter = router({
  sidebar: router({
    workspaceIndex: publicProcedure.query(({ ctx }) => {
      return ctx.workspaceIndex.workspaceIndex();
    }),
    workspaceSessions: publicProcedure
      .input(z.object({
        workspacePath: z.string().min(1),
        cursor: z.string().min(1),
        limit: z.literal(10),
      }))
      .query(({ ctx, input }) => {
        return ctx.workspaceIndex.workspaceSessions(input);
      }),
  }),
});

export type AppRouter = typeof appRouter;
