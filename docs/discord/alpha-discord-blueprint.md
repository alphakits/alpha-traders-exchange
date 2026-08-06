# Alpha Traders Discord Infrastructure

This package provisions a production-ready Discord ecosystem for Alpha Traders with premium black-and-gold structure, low manual setup, and website integration hooks.

## 1) Server Architecture

- Guild identity:
  - Name: Alpha Traders
  - Visual branding: black-and-gold (role colors and embed palette)
  - Security baseline:
    - Verification level: High
    - Explicit content filter: All members
    - Default notifications: Mentions only
- Community segments:
  - Onboarding and verification
  - Public community and education
  - Marketplace operations
  - Support and ticketing
  - Staff operations and logging
  - Voice lounges

## 2) Categories and Channels (Provisioned)

- 00 START HERE
  - welcome
  - rules-and-compliance
  - verify-here
  - start-here-faq (forum)
- 01 COMMUNITY
  - announcements (announcement channel, fallback to text if Community mode is disabled)
  - changelog
  - introductions
  - general-chat
  - wins-and-reviews
- 02 EDUCATION
  - market-education
  - academy-updates
  - question-lab (forum)
- 03 MARKETPLACE
  - marketplace-status
  - approved-seller-showcase
  - request-a-seller (forum)
  - completed-trades
- 04 SUPPORT
  - support-center
  - tickets (forum ticket system)
  - report-user
- 05 STAFF OPS (private)
  - mod-chat
  - incident-room
  - staff-playbooks
- 06 LOGS (private)
  - mod-log
  - security-log
  - marketplace-log
  - bot-log
- 07 VOICE LOUNGES
  - market-floor
  - seller-lounge
  - support-voice

## 3) Roles and Permissions

Provisioned roles:

- Owner
- Admin
- Head Moderator
- Moderator
- Support Team
- Approved Seller
- Buyer
- Student
- Verified
- Newcomer
- Muted
- Alpha Bot

Permission model highlights:

- Newcomer role:
  - Can read most entry channels.
  - Cannot chat broadly until verified.
- Verified role:
  - Unlocks full participation in community, education, marketplace, and support channels.
- Muted role:
  - Denied message/reaction/speaking permissions in all operational areas.
- Staff categories:
  - Hidden from everyone except staff roles.
- Logs category:
  - Readable by leadership moderation; writable by bot where needed.

## 4) Verification Flow

Recommended flow (aligned to website roles):

1. New member lands in welcome and rules-and-compliance.
2. Member completes verify-here instructions.
3. Automation (bot/mod workflow) removes Newcomer and assigns Verified.
4. Optional role sync with website account state:
   - Buyer role mirrors website buyer status.
   - Approved Seller role mirrors approved seller status.

Operational note:

- The provisioning script creates structure and permissions. Role assignment logic can be performed by moderation tools or optional bot handlers.

## 5) Ticket System

- tickets is a forum channel used as ticket intake.
- One issue per post/thread.
- Support Team can manage threads and messages.
- Suggested tags:
  - account
  - payment
  - trade-dispute
  - technical
  - fraud-report
- SLA target:
  - First response under 15 minutes during staffed hours.

## 6) Moderation System

- Role hierarchy with clear escalation path:
  - Moderator -> Head Moderator -> Admin -> Owner
- Staff workflow channels:
  - incident-room for active incidents
  - mod-chat for daily moderation
  - staff-playbooks for SOPs
- Anti-scam and anti-spam baseline via AutoMod:
  - Block known risky short links/invite drops in public flow
  - Mention-spam limits
  - Log to mod/security channels

## 7) Logging

Provisioned logging channels:

- mod-log: moderation outcomes and case references
- security-log: raid/scam indicators
- marketplace-log: website marketplace events
- bot-log: automation and command diagnostics

Data retention recommendation:

- Keep logs for 90 days in Discord.
- Mirror critical incidents to external storage (SIEM or database) if needed.

## 8) Security Baseline

- High verification level
- Mentions-only default notifications
- Explicit content filtering for all members
- Newcomer limitation before verification
- Muted enforcement role
- Private staff and log categories hidden from public
- AutoMod anti-link and anti-mention spam rules

Additional recommended controls:

- Enable 2FA requirement for moderation actions in Discord server settings.
- Restrict external bot installs and application command permissions.
- Keep invite links scoped and expiring.

## 9) Community Onboarding

- Welcome experience:
  - welcome: mission and expectations
  - rules-and-compliance: trust + trading rules
  - verify-here: first actionable step
  - start-here-faq forum for quick support
- Progression:
  - Newcomer -> Verified -> Buyer/Student/Approved Seller (website-synced)

## 10) Welcome Screen

Provisioning attempts to configure guild welcome screen with:

- welcome
- verify-here
- announcements
- tickets

Important:

- Discord only allows Welcome Screen configuration when Community mode is enabled.
- Script logs a warning if this is not available.

## 11) Announcement System

- announcements channel is configured for official updates.
- changelog captures release notes and feature changes.
- Marketplace and completed trade summaries can be sent via webhook integration.

## 12) Marketplace Integration Plan

Implemented integration utility:

- src/lib/discord/marketplace-events.ts
  - Sends structured embeds to Discord webhook.
- src/app/api/discord/marketplace-events/route.ts
  - Secure API endpoint for internal systems to push events.
  - Uses API key authentication.
  - Optional request signature validation.

Suggested event mapping:

- listing_created -> marketplace-log + marketplace-status
- listing_closed -> marketplace-log
- trade_requested -> marketplace-log
- trade_completed -> completed-trades + marketplace-log
- seller_approved -> approved-seller-showcase
- risk_alert -> security-log (warning/critical)

## 13) Deployment and Automation

Primary script:

- scripts/discord/provision-alpha-discord.mjs
  - Creates or updates roles
  - Creates or updates categories/channels
  - Applies permission overwrites
  - Applies guild hardening settings
  - Applies welcome screen (when available)
  - Applies AutoMod rules

Blueprint source:

- scripts/discord/alpha-discord-blueprint.json

Optional slash command registration:

- scripts/discord/register-alpha-slash-commands.mjs

## 14) Optional Custom Alpha Bot

This package includes command registration and webhook bridge integration points.

Optional next expansion:

- Add interaction handler to support commands:
  - /market-status
  - /open-ticket
  - /seller-apply
  - /report-scam
- Add website role-sync worker:
  - Map website roles to Discord roles by verified account linkage.
- Add anti-fraud workflow:
  - Escalate suspicious trade reports to incident-room.

## 15) Environment Variables

Required for provisioning:

- DISCORD_BOT_TOKEN
- DISCORD_GUILD_ID

Optional for scripting:

- DISCORD_APPLICATION_ID
- DISCORD_BLUEPRINT_PATH
- DISCORD_DRY_RUN=1

Required for marketplace webhook integration:

- DISCORD_MARKETPLACE_WEBHOOK_URL
- DISCORD_MARKETPLACE_API_KEY
- DISCORD_MARKETPLACE_WEBHOOK_SECRET
- DISCORD_MARKETPLACE_AVATAR_URL (optional)

## 16) Practical Discord API Constraint

Discord bots cannot directly create brand-new guilds from the Bot API in normal production flows.

Production-safe approach used here:

1. Create the guild once manually (or from an org template).
2. Run provisioning script to fully configure the server automatically and repeatedly.

This still minimizes manual setup to a one-time guild creation action.
