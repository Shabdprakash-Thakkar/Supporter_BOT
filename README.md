```
Supporter_BOT/
│
├── .gitignore                                              # Git ignore rules
├── LICENSE.txt                                             # Project license
├── PerformanceReport.md                                    # Consolidated vs Separate mode analysis
├── Project.md                                              # Project documentation and configuration
├── README.md                                               # Project structure documentation
├── __init__.py                                             # Python package initializer
│
├── Consolidate/                                            # 🔧 Optimization scripts
│   ├── consolidate_css.py                                  # Merges all CSS files into one
│   ├── consolidate_html.py                                 # Merges all HTML templates
│   └── consolidate_js.py                                   # Merges all JavaScript files
│
├── Data_Files/                                             # 📦 Configuration and data storage
│   ├── .env                                                # Environment variables
│   ├── .env.example                                        # Example environment configuration
│   ├── SQL.example.txt                                     # SQL schema examples
│   ├── SQL.txt                                             # Start SQL schema
│   └── requirements.txt                                    # Python dependencies
│
├── Flask_Frontend/                                         # 🌐 Source files for web dashboard
│   ├── app.py                                              # Main Flask application
│   │
│   ├── Assets/                                             # 🖼️ Static images and icons
│   │   ├── bot-logo.png
│   │   ├── quality-16px.png
│   │   ├── quality-24px.png
│   │   ├── quality-32px.png
│   │   ├── quality-64px.png
│   │   ├── quality-128px.png
│   │   ├── quality-256px.png
│   │   ├── quality-512px.png
│   │
│   ├── CSS/                                                # 🎨 Stylesheets
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
│   │   │
│   │   ├── partials/                                       # Component styles
│   │   │   ├── navbar.css
│   │   │   ├── privacy_policy.css
│   │   │   └── terms_of_service.css
│   │   │
│   │   └── Tabs/                                           # Dashboard tab styles
│   │       ├── config_analytics.css
│   │       ├── config_general.css
│   │       ├── config_level.css
│   │       ├── config_reminder.css
│   │       ├── config_restriction.css
│   │       ├── config_time.css
│   │       ├── config_youtube.css
│   │       │
│   │       ├── SubTabsAnalytics/                           # Analytics sub-tabs
│   │       │   ├── config_analytics_guide.css
│   │       │   ├── config_analytics_history.css
│   │       │   └── config_analytics_snapshot.css
│   │       │
│   │       └── SubTabsLevel/                               # Leveling sub-tabs
│   │           ├── config_level_leaderboard.css
│   │           ├── config_level_leaderboard_full.css
│   │           ├── config_level_reward.css
│   │           └── config_level_setting.css
│   │
│   ├── HTML/                                               # 🌐 HTML Templates
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
│   │   │
│   │   ├── partials/                                       # Reusable components
│   │   │   ├── navbar.html
│   │   │   ├── privacy_policy.html
│   │   │   └── terms_of_service.html
│   │   │
│   │   └── Tabs/                                           # Dashboard configuration tabs
│   │       ├── config_analytics.html
│   │       ├── config_general.html
│   │       ├── config_level.html
│   │       ├── config_reminder.html
│   │       ├── config_restriction.html
│   │       ├── config_time.html
│   │       ├── config_youtube.html
│   │       │
│   │       ├── SubTabsAnalytics/                           # Analytics sub-tabs
│   │       │   ├── config_analytics_guide.html
│   │       │   ├── config_analytics_history.html
│   │       │   └── config_analytics_snapshot.html
│   │       │
│   │       └── SubTabsLevel/                               # Leveling sub-tabs
│   │           ├── config_level_leaderboard.html
│   │           ├── config_level_leaderboard_full.html
│   │           ├── config_level_reward.html
│   │           └── config_level_setting.html
│   │
│   └── JS/                                                 # 📜 JavaScript files
│       ├── command.js
│       ├── contact.js
│       ├── dashboard.js
│       ├── dashboard_landing.js
│       ├── feature.js
│       ├── home.js
│       ├── index.js
│       ├── profile.js
│       ├── server_config.js
│       │
│       ├── partial/                                        # Shared components
│       │   └── global_navbar.js
│       │
│       ├── Utils/                                          # 🛠️ Utility functions
│       │   └── populateChannelDropdownWithCategories.js
│       │
│       └── Tabs/                                           # Dashboard tab scripts
│           ├── config_analytics.js
│           ├── config_general.js
│           ├── config_level.js
│           ├── config_reminder.js
│           ├── config_restriction.js
│           ├── config_time.js
│           ├── config_youtube.js
│           │
│           ├── SubTabsAnalytics/                           # Analytics sub-tab scripts
│           │   ├── config_analytics_history.js
│           │   ├── config_analytics_settings.js
│           │   ├── config_analytics_snapshot.js
│           │
│           └── SubTabsLevel/                               # Leveling sub-tab scripts
│               ├── config_level_leaderboard.js
│               ├── config_level_leaderboard_full.js
│               ├── config_level_reward.js
│               └── config_level_setting.js
│
├── Flask_Frontend_Consolidated/                            # 🚀 Optimized production files
│   ├── app_hcj.css                                         # Merged CSS
│   ├── app_hcj.html                                        # Merged HTML
│   ├── app_hcj.js                                          # Merged JS
│   ├── app_hcj.py                                          # Production Flask app
│   │
│   ├── Assets/                                             # 🖼️ Static images and icons
│   │   ├── bot-logo.png
│   │   ├── quality-16px.png
│   │   ├── quality-24px.png
│   │   ├── quality-32px.png
│   │   ├── quality-64px.png
│   │   ├── quality-128px.png
│   │   ├── quality-256px.png
│   │   ├── quality-512px.png
│   │
│   ├── CSS/                                                # 🎨 Stylesheets (Copied Source)
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
│   │   │
│   │   ├── partials/                                       # Component styles
│   │   │   ├── navbar.css
│   │   │   ├── privacy_policy.css
│   │   │   └── terms_of_service.css
│   │   │
│   │   └── Tabs/                                           # Dashboard tab styles
│   │       ├── config_analytics.css
│   │       ├── config_general.css
│   │       ├── config_level.css
│   │       ├── config_reminder.css
│   │       ├── config_restriction.css
│   │       ├── config_time.css
│   │       ├── config_youtube.css
│   │       │
│   │       ├── SubTabsAnalytics/                           # Analytics sub-tabs
│   │       │   ├── config_analytics_guide.css
│   │       │   ├── config_analytics_history.css
│   │       │   └── config_analytics_snapshot.css
│   │       │
│   │       └── SubTabsLevel/                               # Leveling sub-tabs
│   │           ├── config_level_leaderboard.css
│   │           ├── config_level_leaderboard_full.css
│   │           ├── config_level_reward.css
│   │           └── config_level_setting.css
│   │
│   ├── HTML/                                               # 🌐 HTML Templates (Copied Source)
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
│   │   │
│   │   ├── partials/                                       # Reusable components
│   │   │   ├── navbar.html
│   │   │   ├── privacy_policy.html
│   │   │   └── terms_of_service.html
│   │   │
│   │   └── Tabs/                                           # Dashboard configuration tabs
│   │       ├── config_analytics.html
│   │       ├── config_general.html
│   │       ├── config_level.html
│   │       ├── config_reminder.html
│   │       ├── config_restriction.html
│   │       ├── config_time.html
│   │       ├── config_youtube.html
│   │       │
│   │       ├── SubTabsAnalytics/                           # Analytics sub-tabs
│   │       │   ├── config_analytics_guide.html
│   │       │   ├── config_analytics_history.html
│   │       │   └── config_analytics_snapshot.html
│   │       │
│   │       └── SubTabsLevel/                               # Leveling sub-tabs
│   │           ├── config_level_leaderboard.html
│   │           ├── config_level_leaderboard_full.html
│   │           ├── config_level_reward.html
│   │           └── config_level_setting.html
│   │
│   └── JS/                                                 # 📜 JavaScript files (Copied Source)
│       ├── command.js
│       ├── contact.js
│       ├── dashboard.js
│       ├── dashboard_landing.js
│       ├── feature.js
│       ├── home.js
│       ├── index.js
│       ├── profile.js
│       ├── server_config.js
│       │
│       ├── partial/                                        # Shared components
│       │   └── global_navbar.js
│       │
│       ├── Utils/                                          # 🛠️ Utility functions
│       │   └── populateChannelDropdownWithCategories.js
│       │
│       └── Tabs/                                           # Dashboard tab scripts
│           ├── config_analytics.js
│           ├── config_general.js
│           ├── config_level.js
│           ├── config_reminder.js
│           ├── config_restriction.js
│           ├── config_time.js
│           ├── config_youtube.js
│           │
│           ├── SubTabsAnalytics/                           # Analytics sub-tab scripts
│           │   ├── config_analytics_history.js
│           │   ├── config_analytics_settings.js
│           │   ├── config_analytics_snapshot.js
│           │
│           └── SubTabsLevel/                               # Leveling sub-tab scripts
│               ├── config_level_leaderboard.js
│               ├── config_level_leaderboard_full.js
│               ├── config_level_reward.js
│               └── config_level_setting.js
│
├── Python_Files/                                           # 🤖 Core Discord bot logic
│   ├── __init__.py
│   ├── analytics.py
│   ├── date_and_time.py
│   ├── help.py
│   ├── level.py
│   ├── no_text.py
│   ├── owner_actions.py
│   ├── reminder.py
│   ├── supporter.py
│   └── youtube_notification.py
│
└── Runner_Files/                                           # ▶️ Execution scripts
    ├── run_localhost.py
    ├── run_localhost_consolidated.py
    ├── run_production.py
    └── run_production_consolidated.py
```
