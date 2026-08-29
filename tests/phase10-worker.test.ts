import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { AuthenticationError, ValidationError } from "@/lib/errors";
import {
  authorizeWorkerRequest,
  readWorkerSecrets,
  workerSecretsEqual,
} from "@/lib/jobs/worker-auth";
import { isWorkerRuntime, runAsWorker } from "@/lib/supabase/runtime";

describe("PHASE 10 worker migration", () => {
  const sql = readFileSync("supabase/migrations/20260821240000_phase10_worker.sql", "utf8");
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("does not add do_not_contact", () => {
    expect(withoutComments).not.toMatch(/do_not_contact/);
  });

  it("claims due jobs with skip locked and restricts the RPC to service_role", () => {
    expect(sql).toContain("claim_due_jobs");
    expect(sql).toContain("for update of j skip locked");
    expect(sql).toContain("private.is_service_role()");
    expect(sql).toContain("grant execute on function public.claim_due_jobs(integer, text) to service_role");
    expect(sql).not.toContain("grant execute on function public.claim_due_jobs(integer, text) to authenticated");
  });
});

describe("worker authorization", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.WORKER_SECRET;
  });

  it("compares bearer secrets in constant time", () => {
    expect(workerSecretsEqual("Bearer abc", "Bearer abc")).toBe(true);
    expect(workerSecretsEqual("Bearer abc", "Bearer xyz")).toBe(false);
    expect(workerSecretsEqual("Bearer abc", "abc")).toBe(false);
  });

  it("accepts CRON_SECRET or WORKER_SECRET", () => {
    process.env.CRON_SECRET = "cron-secret";
    process.env.WORKER_SECRET = "worker-secret";
    expect(readWorkerSecrets()).toEqual(["cron-secret", "worker-secret"]);
    expect(() =>
      authorizeWorkerRequest(new Request("https://example.com/api/jobs/process", {
        headers: { authorization: "Bearer cron-secret" },
      })),
    ).not.toThrow();
    expect(() =>
      authorizeWorkerRequest(new Request("https://example.com/api/jobs/process", {
        headers: { authorization: "Bearer worker-secret" },
      })),
    ).not.toThrow();
    expect(() =>
      authorizeWorkerRequest(new Request("https://example.com/api/jobs/process", {
        headers: { authorization: "Bearer wrong" },
      })),
    ).toThrow(AuthenticationError);
  });

  it("fails honestly when no worker secret is configured", () => {
    expect(() =>
      authorizeWorkerRequest(new Request("https://example.com/api/jobs/process")),
    ).toThrow(ValidationError);
  });
});

describe("worker runtime isolation", () => {
  it("is off by default and on inside runAsWorker", async () => {
    expect(isWorkerRuntime()).toBe(false);
    await runAsWorker(async () => {
      expect(isWorkerRuntime()).toBe(true);
    });
    expect(isWorkerRuntime()).toBe(false);
  });
});

describe("PHASE 10 source boundaries", () => {
  it("keeps the cron route public and the worker free of platform switches", () => {
    const proxy = readFileSync("lib/supabase/proxy.ts", "utf8");
    const worker = readFileSync("services/jobs/worker-service.ts", "utf8");
    const route = readFileSync("app/api/jobs/process/route.ts", "utf8");
    expect(proxy).toContain("/api/jobs/process");
    expect(worker).toContain("claim_due_jobs");
    expect(worker).toContain("runAsWorker");
    expect(worker).not.toMatch(/if\s*\(\s*platform\s*===/);
    expect(route).toContain("authorizeWorkerRequest");
    expect(route).toContain("processDueJobs");
  });
});
