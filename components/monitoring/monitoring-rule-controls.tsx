"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  deleteMonitoringRuleAction,
  disableMonitoringRuleAction,
  pauseMonitoringRuleAction,
  processMonitoringQueueAction,
  resumeMonitoringRuleAction,
  runMonitoringRuleAction,
} from "@/app/actions/monitoring";
import {
  canDisableMonitoringRule,
  canPauseMonitoringRule,
  canResumeMonitoringRule,
  canRunMonitoringRule,
} from "@/lib/monitoring/status";
import type { MonitoringRule } from "@/types/monitoring";

export function MonitoringRuleControls({
  workspaceId,
  rule,
  canMutate,
  canDelete,
}: {
  workspaceId: string;
  rule: MonitoringRule;
  canMutate: boolean;
  canDelete: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ error: string | null; success: string | null }>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage(result.success);
    });
  }

  if (!canMutate) {
    return <p className="text-sm text-muted-foreground">This role cannot run monitoring rules.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canRunMonitoringRule(rule.status) ? (
          <Button size="sm" disabled={pending} onClick={() => run(() => runMonitoringRuleAction(workspaceId, rule.id))}>
            Run
          </Button>
        ) : null}
        {canPauseMonitoringRule(rule.status) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => pauseMonitoringRuleAction(workspaceId, rule.id))}
          >
            Pause
          </Button>
        ) : null}
        {canResumeMonitoringRule(rule.status) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => resumeMonitoringRuleAction(workspaceId, rule.id))}
          >
            Resume
          </Button>
        ) : null}
        {canDisableMonitoringRule(rule.status) ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => disableMonitoringRuleAction(workspaceId, rule.id))}
          >
            Disable
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => run(() => processMonitoringQueueAction(workspaceId, rule.id))}
        >
          Process queue
        </Button>
        {canDelete ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => deleteMonitoringRuleAction(workspaceId, rule.id))}
          >
            Delete
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  );
}
