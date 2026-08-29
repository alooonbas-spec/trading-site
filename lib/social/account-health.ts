export function isAccountOperable(status: "CONNECTED" | "DISCONNECTED" | "EXPIRED" | "ERROR" | "REAUTH_REQUIRED"): boolean {
  return status === "CONNECTED";
}

export function deriveTokenStatus(input: {
  status: "CONNECTED" | "DISCONNECTED" | "EXPIRED" | "ERROR" | "REAUTH_REQUIRED";
  tokenExpiresAt: string | null;
  now?: Date;
}): "CONNECTED" | "EXPIRED" | "MISSING" | "REAUTH_REQUIRED" | "ERROR" {
  if (input.status === "DISCONNECTED") {
    return "MISSING";
  }

  if (input.status === "REAUTH_REQUIRED") {
    return "REAUTH_REQUIRED";
  }

  if (input.status === "ERROR") {
    return "ERROR";
  }

  if (input.status === "EXPIRED") {
    return "EXPIRED";
  }

  if (input.tokenExpiresAt) {
    const now = input.now ?? new Date();
    if (new Date(input.tokenExpiresAt).getTime() <= now.getTime()) {
      return "EXPIRED";
    }
  }

  return "CONNECTED";
}
