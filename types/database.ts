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
      social_accounts: {
        Row: {
          id: string;
          workspace_id: string;
          platform: import("@/types/social").SocialPlatform;
          external_account_id: string;
          username: string | null;
          display_name: string | null;
          avatar_url: string | null;
          status: import("@/types/status").SocialAccountStatus;
          access_token_encrypted: string | null;
          refresh_token_encrypted: string | null;
          token_expires_at: string | null;
          scopes: string[];
          metadata: Record<string, unknown>;
          last_sync_at: string | null;
          last_error: string | null;
          last_error_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          platform: import("@/types/social").SocialPlatform;
          external_account_id: string;
          username?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          status?: import("@/types/status").SocialAccountStatus;
          access_token_encrypted?: string | null;
          refresh_token_encrypted?: string | null;
          token_expires_at?: string | null;
          scopes?: string[];
          metadata?: Record<string, unknown>;
          last_sync_at?: string | null;
          last_error?: string | null;
          last_error_at?: string | null;
        };
        Update: {
          username?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          status?: import("@/types/status").SocialAccountStatus;
          access_token_encrypted?: string | null;
          refresh_token_encrypted?: string | null;
          token_expires_at?: string | null;
          scopes?: string[];
          metadata?: Record<string, unknown>;
          last_sync_at?: string | null;
          last_error?: string | null;
          last_error_at?: string | null;
        };
        Relationships: [];
      };
      account_groups: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          name: string;
          description?: string | null;
        };
        Update: {
          name?: string;
          description?: string | null;
        };
        Relationships: [];
      };
      account_group_members: {
        Row: {
          id: string;
          workspace_id: string;
          group_id: string;
          social_account_id: string;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          group_id: string;
          social_account_id: string;
        };
        Update: never;
        Relationships: [];
      };
      oauth_states: {
        Row: {
          state: string;
          workspace_id: string;
          user_id: string;
          platform: import("@/types/social").SocialPlatform;
          code_verifier: string;
          redirect_uri: string;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          state: string;
          workspace_id: string;
          user_id: string;
          platform: import("@/types/social").SocialPlatform;
          code_verifier: string;
          redirect_uri: string;
          expires_at: string;
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
      read_social_account_secrets: {
        Args: { p_account_id: string };
        Returns: {
          access_token_encrypted: string | null;
          refresh_token_encrypted: string | null;
          metadata: Record<string, unknown>;
          platform: import("@/types/social").SocialPlatform;
          status: import("@/types/status").SocialAccountStatus;
        }[];
      };
    };
    Enums: {
      workspace_role: WorkspaceRole;
      social_account_status: import("@/types/status").SocialAccountStatus;
      social_platform: import("@/types/social").SocialPlatform;
    };
    CompositeTypes: Record<string, never>;
  };
};
