```
Supporter_BOT is a full-stack Discord bot with a Flask dashboard, modular frontend assets, and a production-ready consolidation pipeline — 232 files, built as a real system, not a demo.
```

---

``` TOTAL FILES
Root files:                       6
Consolidate/:                     3
Data_Files/:                      5
Flask_Frontend (dev):           100
Flask_Frontend_Consolidated:    102
Python_Files/:                  12
Runner_Files/:                   4
-----------------------------------
TOTAL FILES =                  232
```

---

``` FILE STRUCTURE
Supporter_BOT/
├── .gitignore                                   # Git ignore rules
├── LICENSE.txt                                  # License
├── PerformanceReport.md                         # Performance report
├── Project.md                                   # Project docs
├── README.md                                    # Readme
├── __init__.py                                  # Root init
│
├── Consolidate/                                 # Consolidation scripts
│   ├── consolidate_css.py                       # Merge CSS
│   ├── consolidate_html.py                      # Merge HTML
│   └── consolidate_js.py                        # Merge JS
│
├── Data_Files/                                  # Config & DB
│   ├── .env                                     # Env vars
│   ├── .env.example                             # Env template
│   ├── SQL.example.txt                          # Sample SQL
│   ├── SQL.txt                                  # SQL schema
│   └── requirements.txt                         # Python deps
│
├── Flask_Frontend/                              # Flask frontend (dev)
│   ├── app.py                                   # Flask app
│   │
│   ├── Assets/                                  # Images
│   │   ├── bot-logo.png
│   │   ├── quality-16px.png
│   │   ├── quality-24px.png
│   │   ├── quality-32px.png
│   │   ├── quality-64px.png
│   │   ├── quality-128px.png
│   │   ├── quality-256px.png
│   │   └── quality-512px.png
│   │
│   ├── CSS/                                     # Styles
│   │   ├── base.css
│   │   ├── command.css
│   │   ├── contact.css
│   │   ├── dashboard.css
│   │   ├── dashboard_landing.css
│   │   ├── feature.css
│   │   ├── home.css
│   │   ├── index.css
│   │   ├── profile.css
│   │   ├── server_config.css
│   │   ├── transcript.css
│   │   ├── voice_channels.css
│   │   ├── partials/
│   │   │   ├── navbar.css
│   │   │   ├── privacy_policy.css
│   │   │   └── terms_of_service.css
│   │   └── Tabs/
│   │       ├── config_analytics.css
│   │       ├── config_general.css
│   │       ├── config_level.css
│   │       ├── config_reminder.css
│   │       ├── config_restriction.css
│   │       ├── config_time.css
│   │       ├── config_youtube.css
│   │       ├── SubTabsAnalytics/
│   │       │   ├── config_analytics_guide.css
│   │       │   ├── config_analytics_history.css
│   │       │   └── config_analytics_snapshot.css
│   │       └── SubTabsLevel/
│   │           ├── config_level_leaderboard.css
│   │           ├── config_level_leaderboard_full.css
│   │           ├── config_level_reward.css
│   │           └── config_level_setting.css
│   │
│   ├── HTML/                                    # Templates
│   │   ├── command.html
│   │   ├── contact.html
│   │   ├── dashboard.html
│   │   ├── dashboard_landing.html
│   │   ├── feature.html
│   │   ├── home.html
│   │   ├── index.html
│   │   ├── privacy_policy.html
│   │   ├── profile.html
│   │   ├── server_config.html
│   │   ├── terms_of_service.html
│   │   ├── transcript_list.html
│   │   ├── transcript_view.html
│   │   ├── voice_channels.html
│   │   ├── partials/
│   │   │   ├── navbar.html
│   │   │   ├── privacy_policy.html
│   │   │   └── terms_of_service.html
│   │   └── Tabs/
│   │       ├── config_analytics.html
│   │       ├── config_general.html
│   │       ├── config_level.html
│   │       ├── config_reminder.html
│   │       ├── config_restriction.html
│   │       ├── config_tickets.html
│   │       ├── config_time.html
│   │       ├── config_voice_channels.html
│   │       ├── config_youtube.html
│   │       ├── SubTabsAnalytics/
│   │       │   ├── config_analytics_guide.html
│   │       │   ├── config_analytics_history.html
│   │       │   └── config_analytics_snapshot.html
│   │       └── SubTabsLevel/
│   │           ├── config_level_leaderboard.html
│   │           ├── config_level_leaderboard_full.html
│   │           ├── config_level_reward.html
│   │           └── config_level_setting.html
│   │
│   └── JS/                                      # Scripts
│       ├── command.js
│       ├── contact.js
│       ├── dashboard.js
│       ├── dashboard_landing.js
│       ├── feature.js
│       ├── home.js
│       ├── index.js
│       ├── profile.js
│       ├── server_config.js
│       ├── transcript.js
│       ├── voice_channels.js
│       ├── partial/
│       │   └── global_navbar.js
│       ├── Tabs/
│       │   ├── config_analytics.js
│       │   ├── config_general.js
│       │   ├── config_level.js
│       │   ├── config_reminder.js
│       │   ├── config_restriction.js
│       │   ├── config_tickets.js
│       │   ├── config_time.js
│       │   ├── config_youtube.js
│       │   ├── SubTabsAnalytics/
│       │   │   ├── config_analytics_history.js
│       │   │   ├── config_analytics_settings.js
│       │   │   └── config_analytics_snapshot.js
│       │   └── SubTabsLevel/
│       │       ├── config_level_leaderboard.js
│       │       ├── config_level_leaderboard_full.js
│       │       ├── config_level_reward.js
│       │       └── config_level_setting.js
│       └── Utils/
│           └── populateChannelDropdownWithCategories.js
│
├── Flask_Frontend_Consolidated/                 # Frontend (prod)
│   ├── app_hcj.css                              # Merged CSS
│   ├── app_hcj.html                             # Merged HTML
│   ├── app_hcj.js                               # Merged JS
│   ├── app_hcj.py                               # Flask prod app
│   │
│   ├── Assets/                                  # Images
│   │   ├── bot-logo.png
│   │   ├── quality-16px.png
│   │   ├── quality-24px.png
│   │   ├── quality-32px.png
│   │   ├── quality-64px.png
│   │   ├── quality-128px.png
│   │   ├── quality-256px.png
│   │   └── quality-512px.png
│   │
│   ├── CSS/
│   │   ├── base.css
│   │   ├── command.css
│   │   ├── contact.css
│   │   ├── dashboard.css
│   │   ├── dashboard_landing.css
│   │   ├── feature.css
│   │   ├── home.css
│   │   ├── index.css
│   │   ├── profile.css
│   │   ├── server_config.css
│   │   ├── transcript.css
│   │   ├── voice_channels.css
│   │   ├── partials/
│   │   │   ├── navbar.css
│   │   │   ├── privacy_policy.css
│   │   │   └── terms_of_service.css
│   │   └── Tabs/
│   │       ├── config_analytics.css
│   │       ├── config_general.css
│   │       ├── config_level.css
│   │       ├── config_reminder.css
│   │       ├── config_restriction.css
│   │       ├── config_time.css
│   │       ├── config_youtube.css
│   │       ├── SubTabsAnalytics/
│   │       │   ├── config_analytics_guide.css
│   │       │   ├── config_analytics_history.css
│   │       │   └── config_analytics_snapshot.css
│   │       └── SubTabsLevel/
│   │           ├── config_level_leaderboard.css
│   │           ├── config_level_leaderboard_full.css
│   │           ├── config_level_reward.css
│   │           └── config_level_setting.css
│   │
│   ├── HTML/
│   │   ├── command.html
│   │   ├── contact.html
│   │   ├── dashboard.html
│   │   ├── dashboard_landing.html
│   │   ├── feature.html
│   │   ├── home.html
│   │   ├── index.html
│   │   ├── privacy_policy.html
│   │   ├── profile.html
│   │   ├── server_config.html
│   │   ├── terms_of_service.html
│   │   ├── transcript_list.html
│   │   ├── transcript_view.html
│   │   ├── voice_channels.html
│   │   ├── partials/
│   │   │   ├── navbar.html
│   │   │   ├── privacy_policy.html
│   │   │   └── terms_of_service.html
│   │   └── Tabs/
│   │       ├── config_analytics.html
│   │       ├── config_general.html
│   │       ├── config_level.html
│   │       ├── config_reminder.html
│   │       ├── config_restriction.html
│   │       ├── config_tickets.html
│   │       ├── config_time.html
│   │       ├── config_voice_channels.html
│   │       ├── config_youtube.html
│   │       ├── SubTabsAnalytics/
│   │       │   ├── config_analytics_guide.html
│   │       │   ├── config_analytics_history.html
│   │       │   └── config_analytics_snapshot.html
│   │       └── SubTabsLevel/
│   │           ├── config_level_leaderboard.html
│   │           ├── config_level_leaderboard_full.html
│   │           ├── config_level_reward.html
│   │           └── config_level_setting.html
│   │
│   └── JS/
│       ├── command.js
│       ├── contact.js
│       ├── dashboard.js
│       ├── dashboard_landing.js
│       ├── feature.js
│       ├── home.js
│       ├── index.js
│       ├── profile.js
│       ├── server_config.js
│       ├── transcript.js
│       ├── voice_channels.js
│       ├── partial/
│       │   └── global_navbar.js
│       ├── Tabs/
│       │   ├── config_analytics.js
│       │   ├── config_general.js
│       │   ├── config_level.js
│       │   ├── config_reminder.js
│       │   ├── config_restriction.js
│       │   ├── config_tickets.js
│       │   ├── config_time.js
│       │   ├── config_youtube.js
│       │   ├── SubTabsAnalytics/
│       │   │   ├── config_analytics_history.js
│       │   │   ├── config_analytics_settings.js
│       │   │   └── config_analytics_snapshot.js
│       │   └── SubTabsLevel/
│       │       ├── config_level_leaderboard.js
│       │       ├── config_level_leaderboard_full.js
│       │       ├── config_level_reward.js
│       │       └── config_level_setting.js
│       └── Utils/
│           └── populateChannelDropdownWithCategories.js
│
├── Python_Files/                                # Bot backend
│   ├── __init__.py
│   ├── analytics.py
│   ├── date_and_time.py
│   ├── help.py
│   ├── join_to_create.py
│   ├── level.py
│   ├── no_text.py
│   ├── owner_actions.py
│   ├── reminder.py
│   ├── supporter.py
│   ├── ticket_system.py
│   └── youtube_notification.py
│
└── Runner_Files/                                # Run scripts
    ├── run_localhost.py
    ├── run_localhost_consolidated.py
    ├── run_production.py
    └── run_production_consolidated.py
```
