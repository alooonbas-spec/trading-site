import { AsyncLocalStorage } from "node:async_hooks";

const workerRuntime = new AsyncLocalStorage<true>();

export function runAsWorker<T>(fn: () => Promise<T>): Promise<T> {
  return workerRuntime.run(true, fn);
}

export function isWorkerRuntime(): boolean {
  return workerRuntime.getStore() === true;
}
