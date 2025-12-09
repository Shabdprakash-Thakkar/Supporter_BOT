# SupperBOT Documentation 🤖

## Overview

SupperBOT is a comprehensive Discord bot integrated with a premium Flask-based web dashboard. It features a modern Leveling System, Analytics, Custom Branding, and robust Moderation tools.

## ✨ Key Features

- **Web Dashboard:** Manage bot settings, view analytics, and configure modules via a beautiful UI.
- **Leveling System:** XP tracking, custom level-up messages, role rewards, and voice XP.
- **Analytics:** Weekly activity tracking (Active Members, Messages, New Members) with historical data.
- **Role Management:** Auto-assign roles, level rewards, and restriction bypass roles.
- **Channel Restrictions:** Block invites, links, or enforce media-only channels.
- **YouTube Notifications:** Auto-post new videos from tracked channels.
- **Reminders:** set reminders for tasks.

## 🛠️ Technology Stack

- **Backend:** Python 3.10+
- **Bot Framework:** `discord.py`
- **Web Framework:** `Flask` (with `Quart` async capability or threaded via `app.py`)
- **Database:** PostgreSQL (Supabase recommended, uses `asyncpg`)
- **Frontend:** HTML5, CSS3 (Tailwind-inspired custom CSS), JavaScript (Vanilla)

## 📂 File Structure

```
SupperBOT/
│
├── 📄 .gitignore
├── 📄 LICENCE.txt
├── 📄 Project.md
├── 📄 PerformanceReport.md
├── 📄 README.md
│
├── 📄 run_localhost.py                      ← OLD: Individual files (5-22 per page)
├── 📄 run_production.py                     ← OLD: Individual files (5-22 per page)
├── 📄 run_localhost_consolidated.py         ← NEW: Consolidated files (3 per page) ✨
├── 📄 run_production_consolidated.py        ← NEW: Consolidated files (3 per page) ✨
├── 📄 __init__.py
│
├── 📁 Data_Files/
│   ├── 📄 .env
│   ├── 📄 .env.example
│   ├── 📄 requirements.txt
│   ├── 📄 SQL.example.txt
│   └── 📄 SQL.txt
│
├── 📁 Flask_Frontend/
│   ├── 📄 app.py                            ← OLD: Loads individual CSS/JS files
│   ├── 📄 app_hcj.py                        ← NEW: Loads consolidated files ✨
│   │
│   ├── 📄 app_hcj.css                       ← NEW: All 27 CSS files merged (167 KB) ✨
│   ├── 📄 app_hcj.js                        ← NEW: All 23 JS files merged (232 KB) ✨
│   ├── 📄 app_hcj.html                      ← NEW: All 28 HTML files merged (313 KB) ✨
│   │
│   ├── 📁 Assets/
│   │   ├── 🖼️ bot-logo.png
│   │   ├── 🖼️ quality-128px.png
│   │   ├── 🖼️ quality-16px.png
│   │   ├── 🖼️ quality-24px.png
│   │   ├── 🖼️ quality-256px.png
│   │   ├── 🖼️ quality-32px.png
│   │   ├── 🖼️ quality-512px.png
│   │   └── 🖼️ quality-64px.png
│   │
│   ├── 📁 CSS/                              ← Individual CSS files (27 files)
│   │   ├── 📄 base.css
│   │   ├── 📄 command.css
│   │   ├── 📄 contact.css
│   │   ├── 📄 dashboard.css
│   │   ├── 📄 dashboard_landing.css
│   │   ├── 📄 feature.css
│   │   ├── 📄 home.css
│   │   ├── 📄 index.css
│   │   ├── 📄 profile.css
│   │   ├── 📄 server_config.css
│   │   │
│   │   ├── 📁 partials/
│   │   │   ├── 📄 navbar.css
│   │   │   ├── 📄 privacy_policy.css
│   │   │   └── 📄 terms_of_service.css
│   │   │
│   │   └── 📁 Tabs/
│   │       ├── 📄 config_analytics.css
│   │       ├── 📄 config_general.css
│   │       ├── 📄 config_level.css
│   │       ├── 📄 config_reminder.css
│   │       ├── 📄 config_restriction.css
│   │       ├── 📄 config_time.css
│   │       ├── 📄 config_youtube.css
│   │       │
│   │       ├── 📁 SubTabsAnalytics/
│   │       │   ├── 📄 config_analytics_history.css
│   │       │   ├── 📄 config_analytics_snapshot.css
│   │       │   └── 📄 config_analytics_guide.css
│   │       │
│   │       └── 📁 SubTabsLevel/
│   │           ├── 📄 config_level_leaderboard.css
│   │           ├── 📄 config_level_leaderboard_full.css
│   │           ├── 📄 config_level_reward.css
│   │           └── 📄 config_level_setting.css
│   │
│   ├── 📁 HTML/                             ← Individual HTML files (28 files)
│   │   ├── 📄 command.html
│   │   ├── 📄 contact.html
│   │   ├── 📄 dashboard.html
│   │   ├── 📄 dashboard_landing.html
│   │   ├── 📄 feature.html
│   │   ├── 📄 home.html
│   │   ├── 📄 index.html
│   │   ├── 📄 privacy_policy.html
│   │   ├── 📄 profile.html
│   │   ├── 📄 server_config.html
│   │   ├── 📄 terms_of_service.html
│   │   │
│   │   ├── 📁 partials/
│   │   │   ├── 📄 navbar.html
│   │   │   ├── 📄 privacy_policy.html
│   │   │   └── 📄 terms_of_service.html
│   │   │
│   │   └── 📁 Tabs/
│   │       ├── 📄 config_analytics.html
│   │       ├── 📄 config_general.html
│   │       ├── 📄 config_level.html
│   │       ├── 📄 config_reminder.html
│   │       ├── 📄 config_restriction.html
│   │       ├── 📄 config_time.html
│   │       ├── 📄 config_youtube.html
│   │       │
│   │       ├── 📁 SubTabsAnalytics/
│   │       │   ├── 📄 config_analytics_history.html
│   │       │   ├── 📄 config_analytics_snapshot.html
│   │       │   └── 📄 config_analytics_guide.html
│   │       │
│   │       └── 📁 SubTabsLevel/
│   │           ├── 📄 config_level_leaderboard.html
│   │           ├── 📄 config_level_leaderboard_full.html
│   │           ├── 📄 config_level_reward.html
│   │           └── 📄 config_level_setting.html
│   │
│   ├── 📁 JS/                               ← Individual JS files (23 files)
│   │   ├── 📄 command.js
│   │   ├── 📄 contact.js
│   │   ├── 📄 dashboard.js
│   │   ├── 📄 dashboard_landing.js
│   │   ├── 📄 feature.js
│   │   ├── 📄 home.js
│   │   ├── 📄 index.js
│   │   ├── 📄 profile.js
│   │   ├── 📄 server_config.js
│   │   │
│   │   └── 📁 Tabs/
│   │       ├── 📄 config_analytics.js
│   │       ├── 📄 config_general.js
│   │       ├── 📄 config_level.js
│   │       ├── 📄 config_reminder.js
│   │       ├── 📄 config_restriction.js
│   │       ├── 📄 config_time.js
│   │       ├── 📄 config_youtube.js
│   │       │
│   │       ├── 📁 SubTabsAnalytics/
│   │       │   ├── 📄 config_analytics_history.js
│   │       │   ├── 📄 config_analytics_snapshot.js
│   │       │   └── 📄 config_analytics_settings.js
│   │       │
│   │       └── 📁 SubTabsLevel/
│   │           ├── 📄 config_level_leaderboard.js
│   │           ├── 📄 config_level_leaderboard_full.js
│   │           ├── 📄 config_level_reward.js
│   │           └── 📄 config_level_setting.js
│   │
│   └── 📁 __pycache__/
│       └── 📄 app.cpython-313.pyc
│
└── 📁 Python_Files/
    ├── 📄 analytics.py
    ├── 📄 date_and_time.py
    ├── 📄 help.py
    ├── 📄 level.py
    ├── 📄 no_text.py
    ├── 📄 owner_actions.py
    ├── 📄 reminder.py
    ├── 📄 supporter.py
    ├── 📄 youtube_notification.py
    ├── 📄 __init__.py
    │
    └── 📁 __pycache__/
        ├── 📄 analytics.cpython-313.pyc
        ├── 📄 date_and_time.cpython-313.pyc
        ├── 📄 help.cpython-313.pyc
        ├── 📄 level.cpython-313.pyc
        ├── 📄 no_text.cpython-313.pyc
        ├── 📄 owner_actions.cpython-313.pyc
        ├── 📄 reminder.cpython-313.pyc
        ├── 📄 supporter.cpython-313.pyc
        ├── 📄 youtube_notification.cpython-313.pyc
        └── 📄 __init__.cpython-313.pyc
```

### File Organization Notes

The project follows a clean separation of concerns:

- Frontend assets are organized by type (CSS, HTML, JS)
- Configuration tabs and sub-tabs have mirrored structure across HTML, CSS, and JS
- Python backend logic is modularized into separate feature files
- Environment and database configurations are isolated in Data_Files

### ✨ Performance Optimization (NEW)

**Consolidated Files System:**

- `app_hcj.py` - Optimized Flask app that loads consolidated assets
- `app_hcj.css` - All 27 CSS files merged into one (167 KB)
- `app_hcj.js` - All 23 JS files merged into one (232 KB)
- `app_hcj.html` - All 28 HTML files merged into one (313 KB) (only for reference)

**Performance Benefits:**

- 73-86% reduction in HTTP requests per page
- Server Config page: 22 files → 3 files (86% improvement)
- Faster page load times and better browser caching
- Lower server CPU usage

**Runner Scripts:**

- `run_localhost_consolidated.py` - Use consolidated files in development
- `run_production_consolidated.py` - Use consolidated files in production

See `PerformanceReport.md` for detailed analysis.

## ⚙️ Installation & Setup

### 1. Prerequisites

- Python 3.10 or higher
- PostgreSQL Database (Supabase recommended)
- Discord Bot Application (Developer Portal)

### 2. Setup

1.  **Clone the Repository**
2.  **Environment Variables**:
    - Copy `Data_Files/.env.example` to `Data_Files/.env`.
    - Fill in `DISCORD_TOKEN`, `CLIENT_SECRET`, `SUPABASE_URL`, etc.
3.  **Database**:
    - Run the SQL script from `Data_Files/SQL.txt` in your database SQL editor.
4.  **Install Dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

### 3. Running the Bot

#### Option 1: Old System (Individual Files)

- **Local Development**:

  ```bash
  python run_localhost.py
  ```

- **Production**:
  ```bash
  python run_production.py
  ```

**Loads:** 5-22 individual CSS/JS files per page

---

#### Option 2: New System (Consolidated Files) ✨ RECOMMENDED

- **Local Development**:

  ```bash
  python run_localhost_consolidated.py
  ```

- **Production**:
  ```bash
  python run_production_consolidated.py
  ```

**Loads:** Only 3 files per page (app_hcj.css, app_hcj.js, HTML)

**Performance Benefits:**

- 73-86% fewer HTTP requests
- Faster page load times
- Better browser caching
- Lower server CPU usage

See `PerformanceReport.md` for detailed analysis.

## 🤝 Contribution

Feel free to open issues or PRs. Please follow the standard code style and ensure you test changes locally.

## 📧 Contact

- **Email:** developer@supporterbot.online
- **Discord:** [Join Support Server](https://discord.gg/xEMEK9XV2V)
