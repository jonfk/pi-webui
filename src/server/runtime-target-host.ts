import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import type { RuntimeTarget } from "./runtime-target.js";
import { assertRuntimeMatchesTarget } from "./runtime-target.js";
import {
  TargetTransitionApplicator,
  type TargetTransition,
  shouldPersistLastCwd,
  transitionToRuntimeTarget,
} from "./target-transitions.js";

type ValidRuntimeTarget = Extract<RuntimeTarget, { kind: "cwd" | "session" }>;

type RuntimeLike = Pick<
  AgentSessionRuntime,
  "cwd" | "session" | "dispose" | "newSession" | "switchSession" | "setBeforeSessionInvalidate"
>;

export type RuntimeTargetTransitionResult =
  | { cancelled: true }
  | { cancelled: false; target: ValidRuntimeTarget };

export class RuntimeTargetHost<Runtime extends RuntimeLike = AgentSessionRuntime> {
  #runtime: Runtime | undefined;
  #selectedTarget: ValidRuntimeTarget | null = null;
  readonly #transitions = new TargetTransitionApplicator();
  readonly #createRuntimeForTarget: (target: ValidRuntimeTarget) => Promise<Runtime>;
  readonly #bindRuntime: (runtime: Runtime) => Promise<void>;
  readonly #beforeSessionInvalidate: () => void;
  readonly #persistLastCwd: (cwd: string) => void;

  constructor(args: {
    createRuntimeForTarget: (target: ValidRuntimeTarget) => Promise<Runtime>;
    bindRuntime: (runtime: Runtime) => Promise<void>;
    beforeSessionInvalidate: () => void;
    persistLastCwd: (cwd: string) => void;
  }) {
    this.#createRuntimeForTarget = args.createRuntimeForTarget;
    this.#bindRuntime = args.bindRuntime;
    this.#beforeSessionInvalidate = args.beforeSessionInvalidate;
    this.#persistLastCwd = args.persistLastCwd;
  }

  get runtime(): Runtime | undefined {
    return this.#runtime;
  }

  get selectedTarget(): ValidRuntimeTarget | null {
    return this.#selectedTarget;
  }

  requireRuntime(): Runtime {
    if (!this.#runtime) throw new Error("Pi runtime is not initialized");
    return this.#runtime;
  }

  async start(target: ValidRuntimeTarget): Promise<Runtime> {
    const runtime = await this.#createRuntimeForTarget(target);
    this.#installRuntimeHooks(runtime);
    assertRuntimeMatchesTarget({ target, runtimeCwd: runtime.cwd });
    this.#runtime = runtime;
    this.#selectedTarget = target;
    await this.#bindRuntime(runtime);
    return runtime;
  }

  async applyTransition(transition: TargetTransition): Promise<RuntimeTargetTransitionResult> {
    return this.#transitions.apply(transition, (activeTransition) => (
      this.#applyTransition(activeTransition)
    ));
  }

  async refreshCurrentSessionFromFile(args?: { persistLastCwd?: boolean }): Promise<RuntimeTargetTransitionResult> {
    const runtime = this.requireRuntime();
    const sessionPath = runtime.session.sessionFile;
    if (!sessionPath) throw new Error("Current session is missing a session file");

    const result = await runtime.switchSession(sessionPath);
    if (result?.cancelled) return { cancelled: true };

    const target = this.#targetFromCurrentRuntimeSession(runtime);
    await this.#commitRuntimeTarget({
      runtime,
      target,
      persistLastCwd: args?.persistLastCwd === true,
    });
    return { cancelled: false, target };
  }

  adoptCurrentSessionTarget(args?: { persistLastCwd?: boolean }): ValidRuntimeTarget {
    const runtime = this.requireRuntime();
    const target = this.#targetFromCurrentRuntimeSession(runtime);
    this.#selectedTarget = target;
    if (args?.persistLastCwd === true) {
      this.#persistLastCwd(target.cwd);
    }
    return target;
  }

  assertCurrentRuntimeMatchesSelectedTarget(): void {
    if (!this.#selectedTarget) throw new Error("No selected runtime target");
    assertRuntimeMatchesTarget({
      target: this.#selectedTarget,
      runtimeCwd: this.requireRuntime().cwd,
    });
  }

  async dispose(): Promise<void> {
    await this.#runtime?.dispose();
    this.#runtime = undefined;
    this.#selectedTarget = null;
  }

  async #applyTransition(transition: TargetTransition): Promise<RuntimeTargetTransitionResult> {
    const target = transitionToRuntimeTarget(transition);
    const runtime = this.#runtime;

    if (runtime && transition.kind === "session") {
      const result = await runtime.switchSession(transition.sessionPath);
      if (result?.cancelled) return { cancelled: true };
      await this.#commitExistingRuntimeTransition({ runtime, target, transition });
      return { cancelled: false, target };
    }

    if (runtime && transition.kind === "cwd" && transition.source === "new_session") {
      const result = await runtime.newSession();
      if (result?.cancelled) return { cancelled: true };
      await this.#commitExistingRuntimeTransition({ runtime, target, transition });
      return { cancelled: false, target };
    }

    const nextRuntime = await this.#replaceRuntime(target);
    await this.#commitRuntimeTarget({
      runtime: nextRuntime,
      target,
      persistLastCwd: shouldPersistLastCwd(transition),
    });
    return { cancelled: false, target };
  }

  async #commitExistingRuntimeTransition(args: {
    runtime: Runtime;
    target: ValidRuntimeTarget;
    transition: TargetTransition;
  }): Promise<void> {
    assertRuntimeMatchesTarget({ target: args.target, runtimeCwd: args.runtime.cwd });
    await this.#commitRuntimeTarget({
      runtime: args.runtime,
      target: args.target,
      persistLastCwd: shouldPersistLastCwd(args.transition),
    });
  }

  async #commitRuntimeTarget(args: {
    runtime: Runtime;
    target: ValidRuntimeTarget;
    persistLastCwd: boolean;
  }): Promise<void> {
    this.#runtime = args.runtime;
    this.#selectedTarget = args.target;
    if (args.persistLastCwd) {
      this.#persistLastCwd(args.target.cwd);
    }
    await this.#bindRuntime(args.runtime);
  }

  async #replaceRuntime(target: ValidRuntimeTarget): Promise<Runtime> {
    await this.#runtime?.dispose();
    this.#runtime = undefined;
    this.#selectedTarget = null;
    const runtime = await this.#createRuntimeForTarget(target);
    this.#installRuntimeHooks(runtime);
    assertRuntimeMatchesTarget({ target, runtimeCwd: runtime.cwd });
    return runtime;
  }

  #installRuntimeHooks(runtime: Runtime): void {
    runtime.setBeforeSessionInvalidate(this.#beforeSessionInvalidate);
  }

  #targetFromCurrentRuntimeSession(runtime: Runtime): ValidRuntimeTarget {
    const sessionPath = runtime.session.sessionFile;
    if (!sessionPath) throw new Error("Current session is missing a session file");
    const target: ValidRuntimeTarget = {
      kind: "session",
      sessionPath,
      cwd: runtime.cwd,
      source: "recovery",
    };
    assertRuntimeMatchesTarget({ target, runtimeCwd: runtime.cwd });
    return target;
  }
}
