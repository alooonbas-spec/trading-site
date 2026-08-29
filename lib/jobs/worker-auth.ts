import { createHmac, timingSafeEqual } from "node:crypto";
import { AuthenticationError, ValidationError } from "@/lib/errors";

export function workerSecretsEqual(left: string, right: string): boolean {
  const key = Buffer.from("social-hub-worker-auth");
  const leftDigest = createHmac("sha256", key).update(left).digest();
  const rightDigest = createHmac("sha256", key).update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function readWorkerSecrets(): string[] {
  const secrets = [process.env.CRON_SECRET, process.env.WORKER_SECRET]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0);
  return [...new Set(secrets)];
}

export function authorizeWorkerRequest(request: Request): void {
  const secrets = readWorkerSecrets();
  if (secrets.length === 0) {
    throw new ValidationError("Set CRON_SECRET or WORKER_SECRET before running the background worker");
  }

  const provided = request.headers.get("authorization") ?? "";
  const authorized = secrets.some((secret) => workerSecretsEqual(provided, `Bearer ${secret}`));
  if (!authorized) {
    throw new AuthenticationError("Invalid worker credentials");
  }
}
