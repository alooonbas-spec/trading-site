import { ACTIVITY_ENTITY_TYPES, type ActivityEntityType } from "@/types/activity";

export function activityEntityHref(
  workspaceId: string,
  entityType: string | null,
  entityId: string | null,
): string | null {
  if (!entityType || !(ACTIVITY_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    return null;
  }

  const type = entityType as ActivityEntityType;
  const base = `/w/${workspaceId}`;

  if (type === "lead" && entityId) {
    return `${base}/leads/${entityId}`;
  }
  if (type === "campaign" && entityId) {
    return `${base}/campaigns/${entityId}`;
  }
  if (type === "post" && entityId) {
    return `${base}/posts/${entityId}`;
  }
  if (type === "monitoring_rule" && entityId) {
    return `${base}/monitoring/${entityId}`;
  }
  if (type === "job") {
    return `${base}/jobs`;
  }
  if (type === "inbox_event") {
    return `${base}/inbox`;
  }
  if (type === "social_account") {
    return `${base}/social-accounts`;
  }
  if (type === "social_profile" || type === "contact_relationship") {
    return `${base}/leads`;
  }

  return null;
}
