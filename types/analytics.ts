import type { CampaignStatus, ContactStatus, JobStatus, LeadStatus, MonitoringRuleStatus, PostStatus, SocialAccountStatus } from "@/types/status";
import type { StatusCount } from "@/lib/analytics/tally";

export type LeadAnalytics = {
  byStatus: StatusCount<LeadStatus>[];
  activeTotal: number;
  doNotContact: number;
  createdToday: number;
  createdLast7Days: number;
};

export type ContactAnalytics = {
  byStatus: StatusCount<ContactStatus>[];
  replied: number;
  successfulJobsToday: number;
  failedJobsToday: number;
};

export type CampaignAnalytics = {
  byStatus: StatusCount<CampaignStatus>[];
  running: number;
};

export type AccountAnalytics = {
  byStatus: StatusCount<SocialAccountStatus>[];
  total: number;
};

export type PostAnalytics = {
  byStatus: StatusCount<PostStatus>[];
  publishedToday: number;
};

export type MonitoringAnalytics = {
  rulesByStatus: StatusCount<MonitoringRuleStatus>[];
  eventsToday: number;
  eventsLast7Days: number;
};

export type JobFamilyAnalytics = {
  contactByStatus: StatusCount<JobStatus>[];
  publishByStatus: StatusCount<JobStatus>[];
  monitorByStatus: StatusCount<JobStatus>[];
  inboxByStatus: StatusCount<JobStatus>[];
};

export type InboxAnalytics = {
  eventsToday: number;
  matchedToday: number;
};

export type WorkspaceAnalytics = {
  generatedAt: string;
  leads: LeadAnalytics;
  contacts: ContactAnalytics;
  campaigns: CampaignAnalytics;
  accounts: AccountAnalytics;
  posts: PostAnalytics;
  monitoring: MonitoringAnalytics;
  inbox: InboxAnalytics;
  jobs: JobFamilyAnalytics;
};
