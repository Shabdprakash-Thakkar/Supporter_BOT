# Supporter Bot 🤖

[![Python Version](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/downloads/)
[![Discord.py](https://img.shields.io/badge/discord.py-2.0%2B-blue.svg)](https://github.com/Rapptz/discord.py)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

A comprehensive Discord bot with an integrated Flask web dashboard for server management, analytics, leveling, and moderation.

## ✨ Key Features

### 🎮 Core Systems
- **Leveling System** - Track XP from messages, images, and voice activity with customizable rewards
- **Analytics Dashboard** - Real-time server statistics and historical weekly reports
- **Web Dashboard** - Beautiful, responsive interface for managing all bot features
- **Moderation Tools** - Channel restrictions, role management, and content filtering

### 📊 Leveling & Progression
- Dynamic XP gain from text messages, images, and voice participation
- Customizable XP rates and cooldowns per server
- Automatic role rewards at specified levels
- Interactive leaderboards with search functionality
- Custom level-up messages (embed, simple, or minimal styles)
- Auto-reset schedules with optional role preservation
- Voice XP caps to prevent exploitation

### 📈 Analytics & Insights
- Weekly activity tracking (messages, new members, engagement)
- Historical snapshot system (up to 52 weeks)
- Server health scoring based on activity and growth
- Engagement tier analysis (Elite, Active, Casual, Inactive)
- Top contributor tracking
- Customizable timezone settings
- Automated weekly reports via DM

### 🎯 Additional Features
- **YouTube Notifications** - Auto-post new videos from tracked channels using RSS feeds
- **Time Clocks** - Dynamic timezone-based channel names with country flags
- **Reminders** - Timezone-aware reminder system with flexible intervals
- **Channel Restrictions** - Granular content filtering (text-only, media-only, no-links, etc.)
- **Owner Tools** - Server management, ban list, and force-leave capabilities

## 🚀 Performance Optimization

The bot includes two deployment modes:

### Standard Mode
- Individual CSS, JS, and HTML files
- 5-22 HTTP requests per page
- Suitable for development

### Consolidated Mode ⚡ (Recommended)
- All CSS files merged into one (167 KB)
- All JS files merged into one (232 KB)
- Only 3 HTTP requests per page
- **73-86% reduction** in page load requests
- Faster response times and better caching

## 🛠️ Technology Stack

- **Backend**: Python 3.10+
- **Discord API**: discord.py 2.0+
- **Web Framework**: Flask
- **Database**: PostgreSQL (asyncpg for async operations)
- **Authentication**: Discord OAuth2
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **API Integration**: YouTube Data API v3

## 🎯 Bot Commands

### General
- `/b1-ping` - Check bot latency and statistics
- `/h1-help` - View all available commands

### Leveling (7 commands)
- `/l1-level` - Check user level and XP
- `/l2-leaderboard` - Display top 10 users
- `/l3-setup-level-reward` - Configure role rewards
- `/l4-level-reward-show` - List all level rewards
- `/l5-notify-level-msg` - Set level-up channel
- `/l6-xp-settings` - Configure XP rates
- `/l7-level-config` - System behavior settings

### Analytics (3 commands)
- `/a1-dashboard` - View analytics dashboard
- `/a2-history` - View past weekly reports
- `/a3-generate-snapshot` - Create manual snapshot

### YouTube Notifications (5 commands)
- `/y1-find-youtube-channel-id` - Search for channel
- `/y2-setup-youtube-notifications` - Enable notifications
- `/y3-remove-youtube-notifications` - Disable notifications
- `/y4-list-youtube-notifications` - Show active feeds
- `/y5-test-rss-feed` - Preview RSS feed

### Time Clocks (3 commands)
- `/t1-setup-clock` - Create timezone clock
- `/t2-list-clocks` - View all clocks
- `/t3-remove-clock` - Delete clock

### Reminders (3 commands)
- `/r1-list` - View active reminders
- `/r2-delete` - Remove reminder
- `/r3-pause` - Pause/resume reminder

### Channel Restrictions (9 commands)
- `/n1-setup-no-text` - Media-only channel
- `/n2-remove-restriction` - Clear restrictions
- `/n3-bypass-no-text` - Add bypass role
- `/n4-show-bypass-roles` - List bypass roles
- `/n5-remove-bypass-role` - Remove bypass
- `/n6-no-discord-link` - Block invite links
- `/n7-no-links` - Block all links
- `/n8-setup-text-only` - Text-only channel
- `/n9-immune-role` - Channel-specific immunity

### Owner Only (4 commands)
- `/o1-serverlist` - List all bot servers
- `/o2-leaveserver` - Force leave server
- `/o3-banguild` - Ban and leave server
- `/o4-unbanguild` - Unban server

## 🌐 Web Dashboard

Access the dashboard at `http://localhost:5000` (development) or your production URL.

### Features
- **Server Selection** - Manage multiple servers
- **Real-time Analytics** - Live statistics and charts
- **Configuration Panels** - Visual settings management
- **Leaderboards** - Searchable user rankings
- **Historical Data** - Weekly report archives
- **Owner Panel** - Advanced server management tools

### Security
- Discord OAuth2 authentication
- Permission validation (Administrator/Manage Server)
- Bot owner bypass for all servers
- Activity logging for auditing

## 📊 Analytics System

### Metrics Tracked
- **Activity Score** (40%): Messages per member per week
- **Engagement Score** (30%): Active member percentage
- **Growth Score** (20%): New member rate
- **Feature Adoption** (10%): Bot feature usage

### Health Scores
- **80-100**: Excellent - Thriving community
- **60-79**: Good - Healthy engagement
- **40-59**: Fair - Needs attention
- **0-39**: Poor - Critical state

### Engagement Tiers
- **Elite** (~5%): Top contributors
- **Active** (~20%): Regular participants
- **Casual** (~50%): Occasional users
- **Inactive** (Remaining): Minimal activity

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 📧 Support

- **Email**: developer@supporterbot.online
- **Discord**: [Join Support Server](https://discord.gg/xEMEK9XV2V)
- **Documentation**: See `Project.md` for detailed technical documentation

## 🙏 Acknowledgments

Built with:
- [discord.py](https://github.com/Rapptz/discord.py) - Discord API wrapper
- [Flask](https://flask.palletsprojects.com/) - Web framework
- [asyncpg](https://github.com/MagicStack/asyncpg) - PostgreSQL driver
- [feedparser](https://github.com/kurtmckee/feedparser) - RSS feed parsing

---

Made with ❤️ for the Discord community
