# 🤖 Supporter Bot - Open Source Discord Management Solution

> **A professional, high-performance Discord bot with a robust web dashboard, built for scalablity and ease of use.**

![Version](https://img.shields.io/badge/version-4.0.0-blue.svg) ![Python](https://img.shields.io/badge/python-3.9+-yellow.svg) ![License](https://img.shields.io/badge/license-MIT-green.svg)

---

## 📖 Table of Contents

1. [Project Overview](#1-project-overview)
2. [Key Features](#2-key-features)
3. [Technology Stack](#3-technology-stack)
4. [Architecture & Design Philosophy](#4-architecture--design-philosophy)
5. [Installation & Setup](#5-installation--setup)
6. [Web Dashboard Configuration](#6-web-dashboard-configuration)
7. [Running the Application](#7-running-the-application)
8. [Contribution Guidelines](#8-contribution-guidelines)
9. [License & Credits](#9-license--credits)

---

## 1. Project Overview

**Supporter Bot** is a comprehensive solution designed to bridge the gap between complex discord bot functionality and user-friendly web management. Unlike traditional bots that rely solely on text commands, Supporter Bot offers a sleek, responsive **Flask-based Dashboard** that allows server administrators to configure every aspect of the bot visually.

### Core Philosophy

- **User-First Design**: If it takes more than 3 clicks, it's too complicated.
- **Visual Management**: Dashboard-first configuration, commands as a backup.
- **Performance**: Dual-mode architecture for rapid development and optimized production.
- **Privacy**: Full data transparency and GDPR/CCPA compliance built-in.

---

## 2. Key Features

### 🛡️ Moderation & Security

- **Channel Restrictions**: Define "Media Only" (images/videos), "Text Only", or "No Links" channels.
- **Immunity Roles**: Grant specific roles bypass permissions for restrictions.
- **Auto-Cleanup**: Automatically deletes non-compliant messages.

### 🏆 Advanced Leveling System

- **Activity Tracking**: XP earned via text messages and voice activity.
- **Role Rewards**: Automatically assign roles at dynamic level milestones.
- **Visual Rank Cards**: Beautiful, customizable rank cards.
- **Leaderboards**: Global and server-specific web leaderboards.
- **Anti-Spam**: Smart cooldowns to prevent XP farming.

### 🎫 Professional Ticket System

- **One-Click Support**: Button-based ticket creation for users.
- **Private Channels**: Secure, private channels for staff and user communication.
- **Auto-Transcripts**: Generates and stores HTML transcripts of every ticket.
- **Dashboard Archive**: Searchable history of all closed tickets on the web dashboard.
- **Inactivity Handling**: Auto-closes tickets after configurable inactivity periods.

### 🎙️ Join-to-Create (JTC) Voice System

- **Dynamic Creation**: Creates temporary voice channels instantly when a user joins a hub.
- **Smart Management**: Renames channels based on user activity or presets.
- **Auto-Deletion**: Instantly removes empty channels to keep the server clean.
- **Dashboard Control**: View active temporary channels and stats in real-time.

### 📊 Deep Analytics

- **Growth Metrics**: Track daily/weekly member joins and leaves.
- **Engagement Stats**: Monitor message volume and active voice hours.
- **Heatmaps**: Visual representation of peak server activity times.
- **Exports**: Download analytics reports for external analysis.

### 🔧 Essential Utilities

- **Smart Reminders**: Recurring or one-time reminders for users or channels.
- **Time Channels**: "Always-on" voice channels displaying current times for different global timezones.
- **YouTube Alerts**: Instant notifications when tracked creators upload new content.

---

## 3. Technology Stack

### Backend

- **Python 3.9+**: Core language.
- **discord.py**: Interaction with Discord API.
- **Flask**: Application server for the web dashboard.
- **Supabase (PostgreSQL)**: Real-time database and authentication storage.
- **APScheduler**: Handling background tasks (reminders, youtube checks).

### Frontend

- **HTML5 & Jinja2**: Templating engine.
- **Tailwind CSS**: Utility-first styling for a modern UI.
- **Vanilla JavaScript**: Lightweight interactivity without heavy framework bloat.
- **FontAwesome**: Iconography.

---

## 4. Architecture & Design Philosophy

This project uses a unique **"Dual-Mode" Architecture** to solve the common trade-off between development speed and production performance.

### 🧵 Mode 1: Development (`Flask_Frontend/`)

- **Structure**: Modular, separated files (e.g., individual CSS for each page, separate JS modules).
- **Benefit**: easier debugging, hot-reloading, and clear separation of concerns.
- **Use Case**: Active development and adding new features.

### 🚀 Mode 2: Production (`Flask_Frontend_Consolidated/`)

- **Structure**: Merged assets (`app_hcj.css`, `app_hcj.js`).
- **Benefit**: Drastic reduction in HTTP requests (from ~40 to ~5 per page load).
- **Use Case**: Deployment to hosting services (Heroku, VPS, etc.).
- **Automation**: `Consolidate/` scripts automatically build this mode from the source.

---

## 5. Installation & Setup

### Prerequisites

1. **Python 3.9+** installed.
2. **Supabase Account**: Create a new project (Free tier works perfectly).
3. **Discord Bot Token**: Get one from the [Discord Developer Portal](https://discord.com/developers/applications).
   - Enable **Server Members Intent** and **Message Content Intent**.

### Step-by-Step Guide

1. **Clone the Repository**

   ```bash
   git clone https://github.com/yourusername/supporter-bot.git
   cd supporter-bot
   ```

2. **Install Dependencies**

   ```bash
   pip install -r Data_Files/requirements.txt
   ```

3. **Database Cloud Setup**

   - Go to your Supabase project's SQL Editor.
   - Copy the contents of `Data_Files/SQL.example.txt`.
   - Run the query to initialize all tables.

4. **Environment Configuration**
   - Rename `Data_Files/.env.example` to `.env`.
   - Fill in your credentials:
     ```env
     DISCORD_TOKEN=your_bot_token_here
     SUPABASE_URL=your_supabase_project_url
     SUPABASE_KEY=your_supabase_anon_key
     CLIENT_ID=discord_client_id
     CLIENT_SECRET=discord_client_secret
     REDIRECT_URI=http://localhost:5000/dashboard/callback
     FLASK_SECRET_KEY=generate_a_random_string
     ```

---

## 6. Web Dashboard Configuration

The dashboard is the heart of Supporter Bot. Once running:

1. Navigate to `http://localhost:5000`.
2. Click **"Login with Discord"**.
3. Select a server where you have **Administrative** permissions.
4. You will see the **Overview** page. Use the sidebar to configure specific features.

### Customizing the Brand

To make the bot your own:

- **Logo**: Replace `Flask_Frontend/Assets/bot-logo.png`.
- **Colors**: Edit `Flask_Frontend/CSS/base.css` CSS variables.
- **Legal**: Update `HTML/partials/privacy_policy.html` with your specific details.

---

## 7. Running the Application

### 👨‍💻 For Developers (Localhost)

Run this command to start the bot with the source (un-consolidated) frontend. Best for coding.

```bash
python Runner_Files/run_localhost.py
```

### 🌐 For Production (Deployment)

Run this command to use the optimized, consolidated assets.

```bash
# 1. Build optimized assets
python Consolidate/consolidate_js.py
python Consolidate/consolidate_css.py
python Consolidate/consolidate_html.py

# 2. Run production server
python Runner_Files/run_production_consolidated.py
```

---

## 8. Contribution Guidelines

We welcome contributions! Please follow these steps to ensure a smooth process:

1. **Fork the Repo**: Create your own copy of the project.
2. **Branch**: Create a feature branch (`git checkout -b feature/AmazingFeature`).
3. **Code**: Implement your changes.
   - If changing frontend, work in `Flask_Frontend/`. **DO NOT** edit `Flask_Frontend_Consolidated/` directly.
4. **Test**: Verify everything works using `run_localhost.py`.
5. **Commit**: Use descriptive commit messages.
6. **Pull Request**: Open a PR to the `main` branch.

### Reporting Issues

Found a bug? Open an Issue using the template provided. Please include:

- Steps to reproduce.
- Expected vs. Actual behavior.
- Screenshots (if applicable).

---

## 9. License & Credits

**License**: This project is licensed under the MIT License - see the `LICENSE.txt` file for details.

**Credits**:

- Analytics Logic inspired by standard engagement metrics.
- UI Design based on modern glassmorphism trends.

---

> Built with ❤️ by the Open Source Community.
