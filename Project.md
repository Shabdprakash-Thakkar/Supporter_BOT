# Project Documentation

## 1. Project Overview

**Supporter Bot** is a dual-interface application combining a Python Discord Bot with a Flask-based Web Dashboard.

- **Discord Bot**: Manages server moderation, leveling, reminders, and YouTube notifications.
- **Web Dashboard**: Allows server administrators to configure bot settings (welcome messages, role rewards, restrictions) via a modern, dark-themed UI.

## 2. Implementation Details

### Architecture

The project runs two main components effectively in parallel (via threads or separate processes depending on the runner):

1.  **Backend (Python)**: Uses `discord.py` for bot interactions and `psycopg2` (or similar) for database management. Located in `Python_Files/`.
2.  **Frontend (Flask)**: Serves the web interface.
    - **Development Mode**: Served from `Flask_Frontend/`. Files are separate (HTML triggers individual JS/CSS).
    - **Production/Consolidated Mode**: Served from `Flask_Frontend_Consolidated/`. Uses merged `app_hcj.html`, `app_hcj.css`, and `app_hcj.js` for performance.

### Key Directories

- **`Python_Files/`**: Core bot logic.
- **`Flask_Frontend/`**: Source code for the web dashboard.
- **`Consolidate/`**: Python scripts (`consolidate_*.py`) that merge frontend assets into single files.
- **`Runner_Files/`**: Scripts to launch the application.

## 3. Configuration Guide

This section details where to find and update key project information.

### 📧 Contact Information

To update the email address shown on the Contact page:

- **File**: `Flask_Frontend/HTML/contact.html` (and `Flask_Frontend_Consolidated/HTML/contact.html` if consolidated)
- **Search for**: `email@example.com`
- **Action**: Replace with your actual support email.

### 💬 Discord Server Invite

To update the "Join Support Server" link:

- **File**: `Flask_Frontend/HTML/contact.html` (and `Flask_Frontend_Consolidated/HTML/contact.html` if consolidated)
- **Search for**: `https://discord.gg/`
- **Action**: Replace with your permanent Discord invite link.

### 🌐 Website URLs

Links to Terms of Service, Privacy Policy, etc., are managed via Flask route generation (`url_for`).

- **Routes**: Defined in `Flask_Frontend/app.py` (and `Flask_Frontend_Consolidated/app.py` if consolidated).
- **Templates**: `terms.html`, `privacy.html` in `Flask_Frontend/HTML/` (and `Flask_Frontend_Consolidated/HTML/` if consolidated).

### 🤖 Bot Token & Secrets

_Security Warning: Never commit secrets to version control._

- **File**: `Token.txt` (or environment variables/similar secure storage, ensure this file exists in root or `Data_Files/` but is git-ignored).

## 4. How to Run

### Option A: Local Development (Separate Files)

Useful for debugging and active development.

```bash
python Runner_Files/run_localhost.py
```

### Option B: Production (Consolidated)

Optimized for performance.

1. Run consolidation scripts:
   ```bash
   python Consolidate/consolidate_js.py
   python Consolidate/consolidate_css.py
   python Consolidate/consolidate_html.py
   ```
2. Start the application:
   ```bash
   python Runner_Files/run_production_consolidated.py
   ```
