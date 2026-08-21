import type { WorkspaceRole } from "@/types/status";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          avatar_url?: string | null;
        };
        Update: {
          email?: string;
          display_name?: string | null;
          avatar_url?: string | null;
        };
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          name: string;
          slug: string;
          created_by?: string | null;
        };
        Update: {
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          role: WorkspaceRole;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          role: WorkspaceRole;
        };
        Update: {
          role?: WorkspaceRole;
        };
        Relationships: [];
      };
      activity_log: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string | null;
          action: string;
          platform: string | null;
          social_account_id: string | null;
          entity_type: string | null;
          entity_id: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id?: string | null;
          action: string;
          platform?: string | null;
          social_account_id?: string | null;
          entity_type?: string | null;
          entity_id?: string | null;
          metadata?: Record<string, unknown>;
        };
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_workspace: {
        Args: { p_name: string };
        Returns: string;
      };
      update_workspace: {
        Args: { p_workspace_id: string; p_name: string };
        Returns: undefined;
      };
      delete_workspace: {
        Args: { p_workspace_id: string };
        Returns: undefined;
      };
      add_workspace_member: {
        Args: {
          p_workspace_id: string;
          p_email: string;
          p_role: WorkspaceRole;
        };
        Returns: string;
      };
      update_workspace_member_role: {
        Args: {
          p_workspace_id: string;
          p_user_id: string;
          p_role: WorkspaceRole;
        };
        Returns: undefined;
      };
      remove_workspace_member: {
        Args: { p_workspace_id: string; p_user_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      workspace_role: WorkspaceRole;
    };
    CompositeTypes: Record<string, never>;
  };
};
