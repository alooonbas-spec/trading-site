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
      leads: {
        Row: {
          id: string;
          workspace_id: string;
          display_name: string;
          email: string | null;
          phone: string | null;
          notes: string | null;
          status: import("@/types/status").LeadStatus;
          do_not_contact: boolean;
          merged_into_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          display_name: string;
          email?: string | null;
          phone?: string | null;
          notes?: string | null;
          status?: import("@/types/status").LeadStatus;
          do_not_contact?: boolean;
          merged_into_id?: string | null;
          created_by?: string | null;
        };
        Update: {
          display_name?: string;
          email?: string | null;
          phone?: string | null;
          notes?: string | null;
          status?: import("@/types/status").LeadStatus;
          do_not_contact?: boolean;
          merged_into_id?: string | null;
        };
        Relationships: [];
      };
      social_profiles: {
        Row: {
          id: string;
          workspace_id: string;
          lead_id: string;
          platform: import("@/types/social").SocialPlatform;
          external_profile_id: string;
          username: string | null;
          display_name: string | null;
          profile_url: string | null;
          avatar_url: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          lead_id: string;
          platform: import("@/types/social").SocialPlatform;
          external_profile_id: string;
          username?: string | null;
          display_name?: string | null;
          profile_url?: string | null;
          avatar_url?: string | null;
          metadata?: Record<string, unknown>;
        };
        Update: {
          lead_id?: string;
          username?: string | null;
          display_name?: string | null;
          profile_url?: string | null;
          avatar_url?: string | null;
          metadata?: Record<string, unknown>;
        };
        Relationships: [];
      };
      contact_relationships: {
        Row: {
          id: string;
          workspace_id: string;
          lead_id: string;
          social_profile_id: string;
          social_account_id: string;
          status: import("@/types/status").ContactStatus;
          last_interacted_at: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          lead_id: string;
          social_profile_id: string;
          social_account_id: string;
          status?: import("@/types/status").ContactStatus;
          last_interacted_at?: string | null;
          last_error?: string | null;
        };
        Update: {
          lead_id?: string;
          social_profile_id?: string;
          status?: import("@/types/status").ContactStatus;
          last_interacted_at?: string | null;
          last_error?: string | null;
        };
        Relationships: [];
      };
      lead_interactions: {
        Row: {
          id: string;
          workspace_id: string;
          lead_id: string;
          social_profile_id: string | null;
          social_account_id: string | null;
          relationship_id: string | null;
          user_id: string | null;
          type: import("@/types/crm").InteractionType;
          body: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          lead_id: string;
          social_profile_id?: string | null;
          social_account_id?: string | null;
          relationship_id?: string | null;
          user_id?: string | null;
          type: import("@/types/crm").InteractionType;
          body?: string | null;
          metadata?: Record<string, unknown>;
        };
        Update: {
          lead_id?: string;
          social_profile_id?: string | null;
          social_account_id?: string | null;
          relationship_id?: string | null;
        };
        Relationships: [];
      };
      campaigns: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          status: import("@/types/status").CampaignStatus;
          action: import("@/types/campaign").CampaignAction;
          body: string | null;
          created_by: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          name: string;
          description?: string | null;
          status?: import("@/types/status").CampaignStatus;
          action: import("@/types/campaign").CampaignAction;
          body?: string | null;
          created_by?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          name?: string;
          description?: string | null;
          status?: import("@/types/status").CampaignStatus;
          action?: import("@/types/campaign").CampaignAction;
          body?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      campaign_leads: {
        Row: {
          id: string;
          workspace_id: string;
          campaign_id: string;
          lead_id: string;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          campaign_id: string;
          lead_id: string;
        };
        Update: never;
        Relationships: [];
      };
      campaign_accounts: {
        Row: {
          id: string;
          workspace_id: string;
          campaign_id: string;
          social_account_id: string;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          campaign_id: string;
          social_account_id: string;
        };
        Update: never;
        Relationships: [];
      };
      posts: {
        Row: {
          id: string;
          workspace_id: string;
          body: string;
          media: string[];
          status: import("@/types/status").PostStatus;
          scheduled_at: string | null;
          published_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          body: string;
          media?: string[];
          status?: import("@/types/status").PostStatus;
          scheduled_at?: string | null;
          published_at?: string | null;
          created_by?: string | null;
        };
        Update: {
          body?: string;
          media?: string[];
          status?: import("@/types/status").PostStatus;
          scheduled_at?: string | null;
          published_at?: string | null;
        };
        Relationships: [];
      };
      post_targets: {
        Row: {
          id: string;
          workspace_id: string;
          post_id: string;
          social_account_id: string;
          status: import("@/types/status").PostTargetStatus;
          external_post_id: string | null;
          published_at: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          post_id: string;
          social_account_id: string;
          status?: import("@/types/status").PostTargetStatus;
          external_post_id?: string | null;
          published_at?: string | null;
          last_error?: string | null;
        };
        Update: {
          status?: import("@/types/status").PostTargetStatus;
          external_post_id?: string | null;
          published_at?: string | null;
          last_error?: string | null;
        };
        Relationships: [];
      };
      jobs: {
        Row: {
          id: string;
          workspace_id: string;
          campaign_id: string | null;
          social_account_id: string | null;
          lead_id: string | null;
          social_profile_id: string | null;
          relationship_id: string | null;
          post_id: string | null;
          post_target_id: string | null;
          monitoring_rule_id: string | null;
          type: import("@/types/campaign").JobType;
          action: import("@/types/campaign").CampaignAction | null;
          body: string | null;
          status: import("@/types/status").JobStatus;
          attempts: number;
          max_attempts: number;
          run_after: string;
          locked_at: string | null;
          locked_by: string | null;
          last_error: string | null;
          result: Record<string, unknown>;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
        Insert: {
          workspace_id: string;
          campaign_id?: string | null;
          social_account_id?: string | null;
          lead_id?: string | null;
          social_profile_id?: string | null;
          relationship_id?: string | null;
          post_id?: string | null;
          post_target_id?: string | null;
          monitoring_rule_id?: string | null;
          type?: import("@/types/campaign").JobType;
          action?: import("@/types/campaign").CampaignAction | null;
          body?: string | null;
          status?: import("@/types/status").JobStatus;
          attempts?: number;
          max_attempts?: number;
          run_after?: string;
          last_error?: string | null;
          result?: Record<string, unknown>;
        };
        Update: {
          status?: import("@/types/status").JobStatus;
          attempts?: number;
          run_after?: string;
          locked_at?: string | null;
          locked_by?: string | null;
          last_error?: string | null;
          result?: Record<string, unknown>;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      monitoring_rules: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          keywords: string[];
          sources: string[];
          social_account_id: string | null;
          platform: import("@/types/social").SocialPlatform;
          status: import("@/types/status").MonitoringRuleStatus;
          cursor: string | null;
          last_run_at: string | null;
          last_error: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          name: string;
          keywords: string[];
          sources?: string[];
          social_account_id?: string | null;
          platform: import("@/types/social").SocialPlatform;
          status?: import("@/types/status").MonitoringRuleStatus;
          cursor?: string | null;
          created_by?: string | null;
        };
        Update: {
          name?: string;
          keywords?: string[];
          sources?: string[];
          social_account_id?: string | null;
          platform?: import("@/types/social").SocialPlatform;
          status?: import("@/types/status").MonitoringRuleStatus;
          cursor?: string | null;
          last_run_at?: string | null;
          last_error?: string | null;
        };
        Relationships: [];
      };
      monitoring_events: {
        Row: {
          id: string;
          workspace_id: string;
          rule_id: string;
          social_account_id: string | null;
          external_id: string;
          author: string | null;
          content: string;
          url: string | null;
          matched_keywords: string[];
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          rule_id: string;
          social_account_id?: string | null;
          external_id: string;
          author?: string | null;
          content: string;
          url?: string | null;
          matched_keywords?: string[];
        };
        Update: {
          author?: string | null;
          content?: string;
          url?: string | null;
          matched_keywords?: string[];
        };
        Relationships: [];
      };
      inbox_events: {
        Row: {
          id: string;
          workspace_id: string;
          social_account_id: string;
          external_id: string;
          external_profile_id: string;
          username: string | null;
          body: string;
          url: string | null;
          received_at: string | null;
          lead_id: string | null;
          social_profile_id: string | null;
          relationship_id: string | null;
          matched: boolean;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          social_account_id: string;
          external_id: string;
          external_profile_id: string;
          username?: string | null;
          body: string;
          url?: string | null;
          received_at?: string | null;
          lead_id?: string | null;
          social_profile_id?: string | null;
          relationship_id?: string | null;
          matched?: boolean;
        };
        Update: {
          lead_id?: string | null;
          social_profile_id?: string | null;
          relationship_id?: string | null;
          matched?: boolean;
        };
        Relationships: [];
      };
      account_rate_buckets: {
        Row: {
          social_account_id: string;
          window_start: string;
          action_count: number;
        };
        Insert: {
          social_account_id: string;
          window_start: string;
          action_count?: number;
        };
        Update: {
          action_count?: number;
        };
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
      claim_jobs: {
        Args: { p_workspace_id: string; p_limit: number; p_worker_id: string };
        Returns: {
          id: string;
          workspace_id: string;
          campaign_id: string | null;
          social_account_id: string | null;
          lead_id: string | null;
          social_profile_id: string | null;
          relationship_id: string | null;
          post_id: string | null;
          post_target_id: string | null;
          monitoring_rule_id: string | null;
          type: import("@/types/campaign").JobType;
          action: import("@/types/campaign").CampaignAction | null;
          body: string | null;
          status: import("@/types/status").JobStatus;
          attempts: number;
          max_attempts: number;
          run_after: string;
          locked_at: string | null;
          locked_by: string | null;
          last_error: string | null;
          result: Record<string, unknown>;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        }[];
      };
      claim_due_jobs: {
        Args: { p_limit: number; p_worker_id: string };
        Returns: {
          id: string;
          workspace_id: string;
          campaign_id: string | null;
          social_account_id: string | null;
          lead_id: string | null;
          social_profile_id: string | null;
          relationship_id: string | null;
          post_id: string | null;
          post_target_id: string | null;
          monitoring_rule_id: string | null;
          type: import("@/types/campaign").JobType;
          action: import("@/types/campaign").CampaignAction | null;
          body: string | null;
          status: import("@/types/status").JobStatus;
          attempts: number;
          max_attempts: number;
          run_after: string;
          locked_at: string | null;
          locked_by: string | null;
          last_error: string | null;
          result: Record<string, unknown>;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        }[];
      };
      increment_account_rate_bucket: {
        Args: { p_account_id: string; p_window_start: string; p_max: number };
        Returns: number;
      };
    };
    Enums: {
      workspace_role: WorkspaceRole;
      social_account_status: import("@/types/status").SocialAccountStatus;
      social_platform: import("@/types/social").SocialPlatform;
      lead_status: import("@/types/status").LeadStatus;
      contact_status: import("@/types/status").ContactStatus;
      interaction_type: import("@/types/crm").InteractionType;
      campaign_status: import("@/types/status").CampaignStatus;
      job_status: import("@/types/status").JobStatus;
      campaign_action: import("@/types/campaign").CampaignAction;
      job_type: import("@/types/campaign").JobType;
      post_status: import("@/types/status").PostStatus;
      post_target_status: import("@/types/status").PostTargetStatus;
      monitoring_rule_status: import("@/types/status").MonitoringRuleStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
