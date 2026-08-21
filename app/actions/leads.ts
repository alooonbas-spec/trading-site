"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { createLead, deleteLead, updateLead } from "@/services/leads/lead-service";
import { createSocialProfile } from "@/services/leads/profile-service";
import { createContactRelationship, updateContactRelationship } from "@/services/leads/relationship-service";
import { addLeadNote } from "@/services/leads/note-service";
import { mergeLeads } from "@/services/leads/merge-service";
import { parsePlatform } from "@/services/social-accounts/account-service";
import type { ContactStatus, LeadStatus } from "@/types/status";
import { CONTACT_STATUSES, LEAD_STATUSES } from "@/types/status";

export type ActionState = {
  error: string | null;
  success: string | null;
};

export const idleActionState: ActionState = { error: null, success: null };

function parseLeadStatus(value: string): LeadStatus | undefined {
  if (!value) {
    return undefined;
  }
  if (!(LEAD_STATUSES as readonly string[]).includes(value)) {
    return undefined;
  }
  return value as LeadStatus;
}

function parseContactStatus(value: string): ContactStatus | undefined {
  if (!(CONTACT_STATUSES as readonly string[]).includes(value)) {
    return undefined;
  }
  return value as ContactStatus;
}

export async function createLeadAction(
  workspaceId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let leadId: string;
  try {
    const lead = await createLead({
      workspaceId,
      displayName: String(formData.get("displayName") ?? ""),
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      status: parseLeadStatus(String(formData.get("status") ?? "")),
    });
    leadId = lead.id;
  } catch (error) {
    return { error: errorMessage(error, "Unable to create lead"), success: null };
  }

  revalidatePath(`/w/${workspaceId}/leads`);
  redirect(`/w/${workspaceId}/leads/${leadId}`);
}

export async function updateLeadAction(
  workspaceId: string,
  leadId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await updateLead({
      workspaceId,
      leadId,
      displayName: String(formData.get("displayName") ?? ""),
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      status: parseLeadStatus(String(formData.get("status") ?? "")),
      doNotContact: formData.get("doNotContact") === "on",
    });
    revalidatePath(`/w/${workspaceId}/leads`);
    revalidatePath(`/w/${workspaceId}/leads/${leadId}`);
    return { error: null, success: "Lead updated" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function deleteLeadAction(workspaceId: string, leadId: string): Promise<ActionState> {
  try {
    await deleteLead({ workspaceId, leadId });
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }

  revalidatePath(`/w/${workspaceId}/leads`);
  redirect(`/w/${workspaceId}/leads`);
}

export async function createProfileAction(
  workspaceId: string,
  leadId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await createSocialProfile({
      workspaceId,
      leadId,
      platform: parsePlatform(String(formData.get("platform") ?? "")),
      externalProfileId: String(formData.get("externalProfileId") ?? ""),
      username: String(formData.get("username") ?? ""),
      displayName: String(formData.get("displayName") ?? ""),
      profileUrl: String(formData.get("profileUrl") ?? ""),
    });
    revalidatePath(`/w/${workspaceId}/leads/${leadId}`);
    return { error: null, success: "Profile linked" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function createRelationshipAction(
  workspaceId: string,
  leadId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await createContactRelationship({
      workspaceId,
      leadId,
      socialProfileId: String(formData.get("socialProfileId") ?? ""),
      socialAccountId: String(formData.get("socialAccountId") ?? ""),
    });
    revalidatePath(`/w/${workspaceId}/leads/${leadId}`);
    return { error: null, success: "Contact relationship created" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function updateRelationshipAction(
  workspaceId: string,
  leadId: string,
  relationshipId: string,
  status: string,
): Promise<ActionState> {
  const parsed = parseContactStatus(status);
  if (!parsed) {
    return { error: "Invalid contact status", success: null };
  }

  try {
    await updateContactRelationship({
      workspaceId,
      relationshipId,
      status: parsed,
    });
    revalidatePath(`/w/${workspaceId}/leads/${leadId}`);
    return { error: null, success: "Contact status updated" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function addNoteAction(
  workspaceId: string,
  leadId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await addLeadNote({
      workspaceId,
      leadId,
      body: String(formData.get("body") ?? ""),
    });
    revalidatePath(`/w/${workspaceId}/leads/${leadId}`);
    return { error: null, success: "Note added" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}

export async function mergeLeadAction(
  workspaceId: string,
  targetLeadId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await mergeLeads({
      workspaceId,
      sourceLeadId: String(formData.get("sourceLeadId") ?? ""),
      targetLeadId,
    });
    revalidatePath(`/w/${workspaceId}/leads`);
    revalidatePath(`/w/${workspaceId}/leads/${targetLeadId}`);
    return { error: null, success: "Leads merged" };
  } catch (error) {
    return { error: errorMessage(error), success: null };
  }
}
