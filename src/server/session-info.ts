import { SessionManager, type SessionInfo } from "@earendil-works/pi-coding-agent";

export type SerializedSessionInfo = Omit<SessionInfo, "created" | "modified"> & {
  created: string;
  modified: string;
};

export function serializeSessionInfo(info: SessionInfo): SerializedSessionInfo {
  return {
    ...info,
    created: info.created instanceof Date ? info.created.toISOString() : info.created,
    modified: info.modified instanceof Date ? info.modified.toISOString() : info.modified,
  };
}

export async function listSerializedSessions(args: {
  cwd: string;
  sessionDir?: string;
}): Promise<{
  currentProject: SerializedSessionInfo[];
  allProjects: SerializedSessionInfo[];
}> {
  const [currentProject, allProjects] = await Promise.all([
    SessionManager.list(args.cwd, args.sessionDir),
    SessionManager.listAll(),
  ]);

  return {
    currentProject: currentProject.map(serializeSessionInfo),
    allProjects: allProjects.map(serializeSessionInfo),
  };
}
