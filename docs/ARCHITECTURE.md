# Social Hub architecture

Modular monolith + workers. One Postgres database. Platform logic lives in social adapters, not in business services.

## Domain model

```
User → Workspace → Social Accounts
                 → Leads → Social Profiles
                 → Lead Account Relationships
                 → Lead Interactions
                 → Campaigns → Campaign Leads / Campaign Accounts
                 → Posts → Post Targets
                 → Monitoring Rules → Monitoring Events
                 → Jobs
```

One workspace has many social accounts. Never assume 1 platform = 1 account.

## Independent state machines

| Machine | Owns |
| --- | --- |
| `LeadStatus` | CRM stage of a person |
| `ContactStatus` | State of one (lead, profile, our account) relationship |
| `CampaignStatus` | Campaign lifecycle |
| `JobStatus` | Queue item |
| `SocialAccountStatus` | Connected account health |

`do_not_contact` exists only on `leads`. It is not a contact status.

## Request path

UI → Route / Server Action → Domain Service → Social Adapter → Platform API or TinyFish (server-side only)

Tokens, API keys, and session cookies never go to the client.
