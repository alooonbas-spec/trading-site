import { createClient } from "@/lib/supabase/server";
import { errorMessage, ValidationError } from "@/lib/errors";
import { createWorkspaceSchema, updateWorkspaceSchema } from "@/lib/validation/workspace";

export async function createWorkspace(name: string): Promise<string> {
  const parsed = createWorkspaceSchema.safeParse({ name });
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid workspace name");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_workspace", {
    p_name: parsed.data.name,
  });

  if (error || !data) {
    throw new ValidationError(errorMessage(error, "Unable to create workspace"));
  }

  return data;
}

export async function updateWorkspace(workspaceId: string, name: string): Promise<void> {
  const parsed = updateWorkspaceSchema.safeParse({ workspaceId, name });
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid workspace");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_workspace", {
    p_workspace_id: parsed.data.workspaceId,
    p_name: parsed.data.name,
  });

  if (error) {
    throw new ValidationError(error.message);
  }
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_workspace", {
    p_workspace_id: workspaceId,
  });

  if (error) {
    throw new ValidationError(error.message);
  }
}
