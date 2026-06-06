type RuntimeTargetChangedEffectTarget =
  | { kind: "cwd"; cwd: string }
  | { kind: "session"; sessionPath: string; cwd: string };

export type CommandEffect = {
  type: "runtime_target_changed";
  target: RuntimeTargetChangedEffectTarget;
};

const commandHandlerResult = Symbol("commandHandlerResult");

type CommandHandlerResult = {
  [commandHandlerResult]: true;
  data: unknown;
  effects: CommandEffect[];
};

export function runtimeTargetChangedEffect(
  target: RuntimeTargetChangedEffectTarget,
): CommandEffect {
  if (target.kind === "session") {
    return {
      type: "runtime_target_changed",
      target: {
        kind: "session",
        sessionPath: target.sessionPath,
        cwd: target.cwd,
      },
    };
  }
  return {
    type: "runtime_target_changed",
    target: {
      kind: "cwd",
      cwd: target.cwd,
    },
  };
}

export function withCommandEffects(data: unknown, effects: CommandEffect[]): CommandHandlerResult {
  return {
    [commandHandlerResult]: true,
    data,
    effects,
  };
}

export function commandSuccessPayload(command: string, result: unknown) {
  if (isCommandHandlerResult(result)) {
    return {
      command,
      ok: true,
      data: result.data,
      ...(result.effects.length > 0 ? { effects: result.effects } : {}),
    };
  }
  return { command, ok: true, data: result };
}

function isCommandHandlerResult(value: unknown): value is CommandHandlerResult {
  return Boolean(value && typeof value === "object" && (value as CommandHandlerResult)[commandHandlerResult]);
}
