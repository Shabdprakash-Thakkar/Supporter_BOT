"""
Flask Frontend for Supporter Discord Bot

This application powers the public marketing pages and the authenticated
Discord dashboard for the Supporter bot.

Key responsibilities:
- Serve marketing pages (home, features, commands, contact).
- Provide an authenticated dashboard for server admins/owners.
- Integrate with Discord OAuth2 for user login.
- Read/write configuration and analytics data from PostgreSQL.
- Expose JSON APIs for:
  - Bot stats and contact form.
  - Server-level configuration (XP, level rewards, clocks, YouTube, restrictions).
  - Reminders and timezones.
  - Leaderboards and analytics (current + historical).
  - Owner-only management actions (leave/ban/unban guilds).
"""

from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_cors import CORS
from flask_login import (
    LoginManager,
    UserMixin,
    login_user,
    logout_user,
    login_required,
    current_user,
)
from dotenv import load_dotenv
import os
import logging
import psycopg2
import pytz
import feedparser
from psycopg2 import pool
from datetime import datetime, timedelta
import requests
from requests_oauthlib import OAuth2Session

# ==================== LOGGING & ENVIRONMENT ====================

logging.basicConfig(
    level=logging.INFO, format="[%(asctime)s] [%(name)s] [%(levelname)s] %(message)s"
)
log = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "Data_Files")
load_dotenv(os.path.join(DATA_DIR, ".env"))

# ==================== FLASK APP & CORE CONFIG ====================

# template_folder -> HTML templates directory
# static_folder -> root of frontend (serves /CSS, /JS, etc.)
app = Flask(
    __name__,
    template_folder="HTML",
    static_folder=".",  # Serve files from Flask_Frontend/ (where this file lives)
    static_url_path="",
)
app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY", "dev-secret-key")
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)

# Enable CORS for API endpoints consumed by the frontend
CORS(app, resources={r"/api/*": {"origins": "*"}})

# ==================== DISCORD & DATABASE CONFIG ====================

DATABASE_URL = os.getenv("DATABASE_URL")
YOUR_BOT_ID = os.getenv("DISCORD_CLIENT_ID")
DISCORD_BOT_TOKEN = os.getenv("DISCORD_TOKEN")
BOT_OWNER_ID = os.getenv("DISCORD_BOT_OWNER_ID")

# Discord OAuth2 configuration (for dashboard login)
DISCORD_OAUTH2_CLIENT_ID = os.getenv("DISCORD_OAUTH2_CLIENT_ID")
DISCORD_OAUTH2_CLIENT_SECRET = os.getenv("DISCORD_OAUTH2_CLIENT_SECRET")
DISCORD_OAUTH2_REDIRECT_URI = os.getenv("DISCORD_OAUTH2_REDIRECT_URI")
DISCORD_API_BASE_URL = "https://discord.com/api/v10"
DISCORD_AUTHORIZATION_BASE_URL = "https://discord.com/api/oauth2/authorize"
DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token"

# Bot invite URL
permissions = os.getenv("DISCORD_PERMISSIONS", "8")
scopes = "bot applications.commands"
INVITE_URL = f"https://discord.com/oauth2/authorize?client_id={YOUR_BOT_ID}&permissions={permissions}&scope={scopes.replace(' ', '+')}"

# Global DB connection pool and stats cache
db_pool = None
stats_cache = {"data": None, "timestamp": None}
CACHE_DURATION = timedelta(minutes=1)


# ==================== DATABASE HELPERS ====================


def init_db_pool():
    """
    Initialize and return a global PostgreSQL connection pool.

    Returns
    -------
    psycopg2.pool.SimpleConnectionPool | None
        The global connection pool instance, or None if initialization fails.
    """
    global db_pool
    if db_pool is None:
        try:
            db_pool = psycopg2.pool.SimpleConnectionPool(
                minconn=1, maxconn=10, dsn=DATABASE_URL
            )
            log.info("✅ Database connection pool initialized.")
        except Exception as e:
            log.critical(f"❌ Database connection failed: {e}")
            db_pool = None
    return db_pool


def increment_command_counter():
    """
    Increment the global bot 'commands_used' metric for dashboard actions.

    This is used to treat dashboard actions similarly to commands for
    showcasing usage statistics.
    """
    pool = init_db_pool()
    if not pool:
        return
    conn = pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE public.bot_stats 
            SET commands_used = commands_used + 1, last_updated = NOW() 
            WHERE bot_id = %s
        """,
            (YOUR_BOT_ID,),
        )
        conn.commit()
    except Exception as e:
        log.error(f"Stats Increment Error: {e}")
    finally:
        if conn:
            pool.putconn(conn)


# ==================== FLASK-LOGIN SETUP ====================

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "dashboard_login"


class User(UserMixin):
    """
    Flask-Login user representation for dashboard users.

    Attributes
    ----------
    id : str
        Discord user ID.
    username : str
        Discord username.
    avatar : str | None
        Discord avatar hash.
    """

    def __init__(self, user_id, username, avatar):
        self.id = user_id
        self.username = username
        self.avatar = avatar

    def get_avatar_url(self):
        """
        Return the Discord avatar URL or a default avatar if unset.
        """
        if self.avatar:
            return f"https://cdn.discordapp.com/avatars/{self.id}/{self.avatar}.png"
        return "https://cdn.discordapp.com/embed/avatars/0.png"


@login_manager.user_loader
def load_user(user_id):
    """
    Load a User instance from the database for Flask-Login.

    Parameters
    ----------
    user_id : str
        Discord user ID.

    Returns
    -------
    User | None
        Loaded User object or None if not found.
    """
    pool = init_db_pool()
    if not pool:
        return None
    conn = None
    try:
        conn = pool.getconn()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT user_id, username, avatar FROM public.dashboard_users WHERE user_id = %s",
            (user_id,),
        )
        row = cursor.fetchone()
        cursor.close()
        if row:
            return User(row[0], row[1], row[2])
        return None
    except Exception as e:
        log.error(f"Error loading user: {e}")
        return None
    finally:
        if conn and pool:
            pool.putconn(conn)


def get_discord_oauth_session(token=None, state=None):
    """
    Create an OAuth2Session configured for Discord OAuth.

    Parameters
    ----------
    token : dict | None
        Existing OAuth token, if any.
    state : str | None
        OAuth state value to validate CSRF.

    Returns
    -------
    OAuth2Session
        Configured OAuth2Session instance.
    """
    return OAuth2Session(
        client_id=DISCORD_OAUTH2_CLIENT_ID,
        redirect_uri=DISCORD_OAUTH2_REDIRECT_URI,
        scope=["identify", "guilds"],
        token=token,
        state=state,
    )


@app.context_processor
def inject_globals():
    """
    Inject global template variables.

    Returns
    -------
    dict
        Dictionary of global template context values.
    """
    return {"current_year": datetime.now().year}


# ==================== ACCESS CACHE (DISCORD PERMISSIONS) ====================

_access_cache = {}  # (user_id, guild_id) -> (has_access, timestamp)
_CACHE_TTL = 300  # seconds


def _get_cached_access(user_id, guild_id):
    """
    Get a cached access decision for a user/guild combination.

    Parameters
    ----------
    user_id : str | int
        Discord user ID.
    guild_id : str | int
        Discord guild ID.

    Returns
    -------
    bool | None
        Cached has_access value or None if not cached/expired.
    """
    key = (str(user_id), str(guild_id))
    if key in _access_cache:
        has_access, timestamp = _access_cache[key]
        if (datetime.now() - timestamp).total_seconds() < _CACHE_TTL:
            log.info(
                f"🔄 Using cached access result for user {user_id}, guild {guild_id}: {has_access}"
            )
            return has_access
        else:
            # Cache expired
            del _access_cache[key]
    return None


def _cache_access(user_id, guild_id, has_access):
    """
    Cache an access decision for a user/guild combination.

    Parameters
    ----------
    user_id : str | int
        Discord user ID.
    guild_id : str | int
        Discord guild ID.
    has_access : bool
        Access decision to cache.
    """
    key = (str(user_id), str(guild_id))
    _access_cache[key] = (has_access, datetime.now())
    log.info(
        f"💾 Cached access result for user {user_id}, guild {guild_id}: {has_access}"
    )


# ==================== HELPER: ACCESS CHECKING ====================


def user_has_access(user_id, guild_id):
    """
    Check whether a user has access to manage a given guild.

    Rules:
    - Bot owner (BOT_OWNER_ID) always has access.
    - For regular users, checks membership and permissions via Discord API.
    - Requires Administrator (0x8), Manage Guild (0x20) or owner flag in the guild.
    - Uses a cache to avoid hitting the Discord API too frequently.

    Parameters
    ----------
    user_id : str | int
        Discord user ID.
    guild_id : str | int
        Discord guild ID.

    Returns
    -------
    bool
        True if the user has required permissions for the guild, False otherwise.
    """
    log.info(
        f"🔍 Access Check: user_id={user_id}, guild_id={guild_id}, bot_owner={BOT_OWNER_ID}"
    )

    # Check cache first
    cached_result = _get_cached_access(user_id, guild_id)
    if cached_result is not None:
        return cached_result

    try:
        if str(user_id) == str(BOT_OWNER_ID):
            log.info(f"✅ Bot owner bypass granted for user {user_id}")
            _cache_access(user_id, guild_id, True)
            return True

        pool = init_db_pool()
        if not pool:
            log.error("❌ DB pool not available")
            return False
        conn = pool.getconn()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT access_token FROM public.dashboard_users WHERE user_id = %s",
                (user_id,),
            )
            row = cursor.fetchone()
            if not row:
                log.warning(f"❌ No access token found for user {user_id}")
                return False
            access_token = row[0]
            log.info(f"✅ Access token retrieved for user {user_id}")
        finally:
            pool.putconn(conn)
    except Exception as e:
        log.error(f"❌ user_has_access DB error: {e}")
        return False

    # Validate with Discord API
    try:
        headers = {"Authorization": f"Bearer {access_token}"}
        resp = requests.get(
            f"{DISCORD_API_BASE_URL}/users/@me/guilds", headers=headers, timeout=10
        )
        log.info(f"Discord API Response Status: {resp.status_code}")

        # Handle rate limiting
        if resp.status_code == 429:
            log.warning(
                f"⚠️ Discord API rate limited. Retry after: {resp.json().get('retry_after', 'unknown')}"
            )
            return False

        if resp.status_code != 200:
            log.error(f"❌ Discord API returned {resp.status_code}: {resp.text}")
            return False

        guilds = resp.json()
        log.info(f"User is in {len(guilds)} guilds")

        target = next((g for g in guilds if g["id"] == guild_id), None)
        if not target:
            log.warning(f"❌ User {user_id} is not a member of guild {guild_id}")
            log.debug(f"Available guilds: {[g['id'] for g in guilds]}")
            _cache_access(user_id, guild_id, False)
            return False

        log.info(f"✅ User found in guild: {target.get('name', 'Unknown')}")

        perms = int(target.get("permissions", 0))
        is_admin = (perms & 0x8) == 0x8
        is_manager = (perms & 0x20) == 0x20
        is_owner = target.get("owner", False)

        log.info(
            f"Permissions - Admin: {is_admin}, Manager: {is_manager}, Owner: {is_owner}, Raw: {perms}"
        )

        has_access = is_admin or is_manager or is_owner
        if has_access:
            log.info(f"✅ Access granted to user {user_id} for guild {guild_id}")
        else:
            log.warning(
                f"❌ User {user_id} lacks required permissions for guild {guild_id}"
            )

        _cache_access(user_id, guild_id, has_access)
        return has_access
    except Exception as e:
        log.error(f"❌ user_has_access API error: {e}")
        return False


def log_dashboard_activity(guild_id, action_type, action_description, ip_address=None):
    """
    Persist a dashboard activity entry for auditing and analytics.

    Parameters
    ----------
    guild_id : str | int
        Discord guild ID.
    action_type : str
        Short action identifier (e.g., 'RESET_XP', 'analytics_settings_update').
    action_description : str
        Human-readable description of the action performed.
    ip_address : str | None
        IP address of the request source. If None, taken from request context.
    """
    try:
        user_id = current_user.id if current_user.is_authenticated else "anonymous"

        # Derive IP if not explicitly provided
        if not ip_address:
            if request.headers.getlist("X-Forwarded-For"):
                ip_address = request.headers.getlist("X-Forwarded-For")[0]
            else:
                ip_address = request.remote_addr

        pool = init_db_pool()
        if not pool:
            return

        conn = pool.getconn()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO public.dashboard_activity_log 
                (user_id, guild_id, action_type, action_description, ip_address, created_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                """,
                (user_id, guild_id, action_type, action_description, ip_address),
            )
            conn.commit()
        finally:
            pool.putconn(conn)
    except Exception as e:
        log.error(f"Failed to log dashboard activity: {e}")


# ==================== PUBLIC PAGE ROUTES ====================


@app.route("/")
def index():
    """Home page: high-level marketing overview for the Supporter bot."""
    return render_template("home.html", invite_url=INVITE_URL)


@app.route("/contact")
def contact():
    """Contact page: allows users to submit questions and feedback."""
    return render_template("contact.html", invite_url=INVITE_URL)


@app.route("/features")
def features():
    """Features page: showcases core capabilities of the bot."""
    return render_template("feature.html", invite_url=INVITE_URL)


@app.route("/commands")
def commands():
    """Commands page: lists available bot commands."""
    return render_template("command.html", invite_url=INVITE_URL)


# ==================== ANALYTICS PAGE ROUTES ====================


@app.route("/analytics/history/<guild_id>")
@login_required
def analytics_history(guild_id):
    """
    Analytics history timeline page.

    Displays the list of weekly analytics snapshots for the given guild.
    """
    if not user_has_access(current_user.id, guild_id):
        return "Unauthorized", 403

    pool = init_db_pool()
    if not pool:
        return "Database error", 500

    conn = None
    try:
        conn = pool.getconn()
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT guild_name FROM public.users 
            WHERE guild_id = %s 
            LIMIT 1
        """,
            (guild_id,),
        )
        result = cursor.fetchone()
        guild_name = result[0] if result else "Unknown Server"
    except Exception as e:
        log.error(f"Error fetching guild name: {e}")
        guild_name = "Unknown Server"
    finally:
        if conn and pool:
            cursor.close()
            pool.putconn(conn)

    return render_template(
        "Tabs/SubTabsAnalytics/config_analytics_history.html",
        guild_id=guild_id,
        guild_name=guild_name,
    )


@app.route("/analytics/snapshot/<guild_id>/<int:snapshot_id>")
@login_required
def analytics_snapshot(guild_id, snapshot_id):
    """
    Analytics snapshot detail page.

    Renders a detailed view of a specific weekly snapshot.
    """
    if not user_has_access(current_user.id, guild_id):
        return "Unauthorized", 403

    pool = init_db_pool()
    if not pool:
        return "Database error", 500

    conn = None
    try:
        conn = pool.getconn()
        cursor = conn.cursor()

        # Get guild name
        cursor.execute(
            """
            SELECT guild_name FROM public.users 
            WHERE guild_id = %s 
            LIMIT 1
        """,
            (guild_id,),
        )
        result = cursor.fetchone()
        guild_name = result[0] if result else "Unknown Server"

        # Get snapshot week/year
        cursor.execute(
            """
            SELECT week_number, year 
            FROM public.analytics_snapshots 
            WHERE id = %s AND guild_id = %s
        """,
            (snapshot_id, guild_id),
        )
        snapshot_result = cursor.fetchone()

        if not snapshot_result:
            return "Snapshot not found", 404

        week_number = snapshot_result[0]
        year = snapshot_result[1]

    except Exception as e:
        log.error(f"Error fetching snapshot info: {e}")
        return "Error loading snapshot", 500
    finally:
        if conn and pool:
            cursor.close()
            pool.putconn(conn)

    return render_template(
        "Tabs/SubTabsAnalytics/config_analytics_snapshot.html",
        guild_id=guild_id,
        guild_name=guild_name,
        snapshot_id=snapshot_id,
        week_number=week_number,
        year=year,
    )


# ==================== DASHBOARD CORE PAGES ====================


@app.route("/dashboard")
def dashboard():
    """
    Dashboard entry point.

    If authenticated, redirects to the profile hub.
    Otherwise, shows the dashboard landing/marketing page.
    """
    if current_user.is_authenticated:
        return redirect(url_for("profile"))
    else:
        return render_template("dashboard_landing.html", invite_url=INVITE_URL)


@app.route("/terms-of-service")
def terms():
    """Terms of Service page."""
    return render_template("terms_of_service.html", invite_url=INVITE_URL)


@app.route("/privacy-policy")
def privacy():
    """Privacy Policy page."""
    return render_template("privacy_policy.html", invite_url=INVITE_URL)


# ==================== AUTH ROUTES (DISCORD OAUTH2) ====================


@app.route("/dashboard/login")
def dashboard_login():
    """
    Start the Discord OAuth2 login flow for dashboard authentication.
    """
    discord = get_discord_oauth_session()
    auth_url, state = discord.authorization_url(DISCORD_AUTHORIZATION_BASE_URL)
    session["oauth_state"] = state
    return redirect(auth_url)


@app.route("/dashboard/callback")
def dashboard_callback():
    """
    OAuth2 callback endpoint for Discord.

    Exchanges the authorization code for a token, stores user info in the DB,
    and logs the user into the dashboard.
    """
    if "oauth_state" not in session:
        return redirect(url_for("index"))

    discord = get_discord_oauth_session(state=session.pop("oauth_state"))
    try:
        token = discord.fetch_token(
            DISCORD_TOKEN_URL,
            client_secret=DISCORD_OAUTH2_CLIENT_SECRET,
            authorization_response=request.url,
        )

        # Get User Info
        user_resp = requests.get(
            f"{DISCORD_API_BASE_URL}/users/@me",
            headers={"Authorization": f"Bearer {token['access_token']}"},
        )
        user_data = user_resp.json()

        # Save to DB
        pool = init_db_pool()
        if pool:
            conn = pool.getconn()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    """INSERT INTO public.dashboard_users (user_id, username, avatar, access_token, last_login) 
                       VALUES (%s, %s, %s, %s, NOW()) 
                       ON CONFLICT (user_id) DO UPDATE SET 
                       username=EXCLUDED.username, avatar=EXCLUDED.avatar, access_token=EXCLUDED.access_token, last_login=NOW()""",
                    (
                        str(user_data["id"]),
                        user_data["username"],
                        user_data.get("avatar"),
                        token["access_token"],
                    ),
                )
                conn.commit()
                cursor.close()
            finally:
                pool.putconn(conn)

        # Login User Session
        user = User(
            str(user_data["id"]), user_data["username"], user_data.get("avatar")
        )
        login_user(user, remember=True)

        # Redirect back to home (logged in state will show)
        return redirect(url_for("index"))

    except Exception as e:
        log.error(f"OAuth Error: {e}")
        return redirect(url_for("index"))


@app.route("/dashboard/logout")
@login_required
def logout():
    """Log out the currently authenticated dashboard user."""
    logout_user()
    return redirect(url_for("index"))


# ==================== PUBLIC API ENDPOINTS ====================


@app.route("/api/stats")
def get_stats():
    """
    Bot stats API used on home page.

    Returns key metrics:
    - total_servers
    - total_users
    - commands_used
    - total_members
    - total_messages
    - growth_percentage
    """
    global stats_cache
    now = datetime.now()

    # Serve cached data if fresh
    if stats_cache["data"] and stats_cache["timestamp"]:
        if now - stats_cache["timestamp"] < CACHE_DURATION:
            return jsonify(stats_cache["data"])

    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "DB Error"}), 500

    conn = None
    try:
        conn = pool.getconn()
        cursor = conn.cursor()

        # Fetch basic stats
        cursor.execute(
            "SELECT server_count, user_count, commands_used FROM public.bot_stats WHERE bot_id = %s",
            (YOUR_BOT_ID,),
        )
        row = cursor.fetchone()

        # Total messages from guild_stats
        cursor.execute("SELECT SUM(messages_this_week) FROM public.guild_stats")
        msg_row = cursor.fetchone()

        # Growth: sum of new members vs total users
        cursor.execute("SELECT SUM(new_members_this_week) FROM public.guild_stats")
        growth_row = cursor.fetchone()

        total_users = row[1] if row else 0
        total_messages = (
            msg_row[0] if msg_row and msg_row[0] else (row[2] * 5 if row else 0)
        )  # Fallback approximation
        new_members = growth_row[0] if growth_row and growth_row[0] else 0

        growth_percentage = "+0%"
        if total_users > 0:
            growth_val = (new_members / total_users) * 100
            growth_percentage = f"+{growth_val:.1f}%"
            if growth_val == 0:
                # Slightly positive default for demo appeal
                growth_percentage = "+1.2%"

        stats = {
            "total_servers": row[0] if row else 0,
            "total_users": total_users,
            "commands_used": row[2] if row else 0,
            "total_members": total_users,
            "total_messages": total_messages,
            "growth_percentage": growth_percentage,
        }

        stats_cache["data"] = stats
        stats_cache["timestamp"] = now

        return jsonify(stats)
    except Exception as e:
        log.error(f"Stats API Error: {e}")
        return jsonify({"total_servers": 0, "total_users": 0, "commands_used": 0})
    finally:
        if conn and pool:
            pool.putconn(conn)


@app.route("/api/contact", methods=["POST"])
def handle_contact():
    """
    Contact form submission endpoint.

    Persists messages into `public.contact_messages`.
    """
    data = request.get_json()
    name = data.get("name")
    email = data.get("email")
    subject = data.get("subject")
    message = data.get("message")

    if not all([name, email, subject, message]):
        return jsonify({"error": "All fields are required"}), 400

    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "DB Error"}), 500

    conn = None
    try:
        conn = pool.getconn()
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO public.contact_messages (username, email, subject, message, created_at) 
               VALUES (%s, %s, %s, %s, NOW())""",
            (name, email, subject, message),
        )
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        log.error(f"Contact Form Error: {e}")
        return jsonify({"error": "Failed to save message"}), 500
    finally:
        if conn and pool:
            pool.putconn(conn)


# ==================== DASHBOARD SERVER SELECTION ====================


@app.route("/dashboard/servers")
@login_required
def dashboard_servers():
    """
    Server picker for the dashboard.

    Steps:
    1. Fetch user's guilds from Discord API.
    2. Fetch guilds with bot configuration from `guild_settings`.
    3. Split into:
       - active_servers: user can manage & bot is already in.
       - invite_servers: user can manage but bot is not in.
    """
    pool = init_db_pool()
    if not pool:
        return "DB Error", 500

    conn = None
    try:
        conn = pool.getconn()
        cursor = conn.cursor()

        # 1. Get User's Access Token from DB
        cursor.execute(
            "SELECT access_token FROM public.dashboard_users WHERE user_id = %s",
            (current_user.id,),
        )
        token_row = cursor.fetchone()

        if not token_row:
            logout_user()
            return redirect(url_for("dashboard_login"))

        access_token = token_row[0]

        # 2. Get User's Guilds from Discord
        headers = {"Authorization": f"Bearer {access_token}"}
        response = requests.get(
            f"{DISCORD_API_BASE_URL}/users/@me/guilds", headers=headers
        )

        if response.status_code == 401:
            # Token expired -> force logout to re-auth
            logout_user()
            return redirect(url_for("dashboard_login"))

        user_guilds = response.json()

        # 3. Get Bot's Guilds from DB
        cursor.execute("SELECT guild_id FROM public.guild_settings")
        bot_guild_ids = {row[0] for row in cursor.fetchall()}

        active_servers = []
        invite_servers = []

        for guild in user_guilds:
            # Check permissions (Admin / Manage Guild / Owner)
            perms = int(guild.get("permissions", 0))
            is_admin = (perms & 0x8) == 0x8
            is_manager = (perms & 0x20) == 0x20
            is_owner = guild.get("owner", False)

            if is_admin or is_manager or is_owner:
                server_obj = {
                    "id": guild["id"],
                    "name": guild["name"],
                    "icon": guild["icon"],
                }

                if guild["id"] in bot_guild_ids:
                    active_servers.append(server_obj)
                else:
                    invite_servers.append(server_obj)

        return render_template(
            "dashboard.html",
            active_servers=active_servers,
            invite_servers=invite_servers,
            bot_id=YOUR_BOT_ID,
            permissions=permissions,
        )

    except Exception as e:
        log.error(f"Dashboard Error: {e}")
        return "An error occurred loading the dashboard", 500
    finally:
        if conn and pool:
            cursor.close()
            pool.putconn(conn)


@app.route("/dashboard/profile")
@login_required
def profile():
    """
    Main user profile hub.

    Functions:
    - Validates Discord token.
    - Fetches accessible servers, split into active/invite lists.
    - If the logged-in user is the bot owner, shows global statistics and
      an extended view of all bot servers and banned guilds.
    """
    pool = init_db_pool()
    if not pool:
        return "DB Error", 500

    conn = None
    try:
        conn = pool.getconn()
        cursor = conn.cursor()

        # 1. Get Access Token
        cursor.execute(
            "SELECT access_token FROM public.dashboard_users WHERE user_id = %s",
            (current_user.id,),
        )
        token_row = cursor.fetchone()

        if not token_row:
            logout_user()
            return redirect(url_for("dashboard_login"))

        # 2. Fetch User Guilds from Discord
        headers = {"Authorization": f"Bearer {token_row[0]}"}
        response = requests.get(
            f"{DISCORD_API_BASE_URL}/users/@me/guilds", headers=headers
        )

        if response.status_code == 401:
            logout_user()
            return redirect(url_for("dashboard_login"))

        user_guilds = response.json()

        # 3. Fetch Bot Guilds from DB
        cursor.execute("SELECT guild_id FROM public.guild_settings")
        bot_guild_ids = {row[0] for row in cursor.fetchall()}

        active_servers = []
        invite_servers = []

        # 4. Filter Logic
        for guild in user_guilds:
            perms = int(guild.get("permissions", 0))
            is_admin = (perms & 0x8) == 0x8
            is_manager = (perms & 0x20) == 0x20
            is_owner = guild.get("owner", False)

            if is_admin or is_manager or is_owner:
                server_obj = {
                    "id": guild["id"],
                    "name": guild["name"],
                    "icon": guild["icon"],
                }

                if guild["id"] in bot_guild_ids:
                    active_servers.append(server_obj)
                else:
                    invite_servers.append(server_obj)

        # 5. Check Bot Owner Status
        is_owner = str(current_user.id) == str(BOT_OWNER_ID)

        # 6. Owner-only statistics
        owner_stats = {}
        all_bot_servers = []
        if is_owner:
            cursor.execute("SELECT COUNT(*) FROM public.guild_settings")
            owner_stats["total_servers"] = cursor.fetchone()[0]
            cursor.execute("SELECT COUNT(*) FROM public.users")
            owner_stats["total_tracked_users"] = cursor.fetchone()[0]

            # Fetch detailed server info from Discord API using bot token
            try:
                bot_headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}

                cursor.execute("SELECT guild_id FROM public.guild_settings")
                bot_guild_ids_list = [row[0] for row in cursor.fetchall()]

                for guild_id in bot_guild_ids_list:
                    try:
                        guild_resp = requests.get(
                            f"{DISCORD_API_BASE_URL}/guilds/{guild_id}?with_counts=true",
                            headers=bot_headers,
                            timeout=5,
                        )
                        if guild_resp.status_code == 200:
                            guild_data = guild_resp.json()
                            all_bot_servers.append(
                                {
                                    "id": guild_data["id"],
                                    "name": guild_data["name"],
                                    "icon": guild_data.get("icon"),
                                    "member_count": guild_data.get(
                                        "approximate_member_count", 0
                                    ),
                                    "owner_id": guild_data.get("owner_id"),
                                }
                            )
                        else:
                            log.warning(
                                f"Failed to fetch guild {guild_id}: {guild_resp.status_code}"
                            )
                            all_bot_servers.append(
                                {
                                    "id": guild_id,
                                    "name": "Unknown Server",
                                    "icon": None,
                                    "member_count": 0,
                                    "owner_id": None,
                                }
                            )
                    except Exception as e:
                        log.error(f"Error fetching guild {guild_id}: {e}")
                        all_bot_servers.append(
                            {
                                "id": guild_id,
                                "name": "Unknown Server",
                                "icon": None,
                                "member_count": 0,
                                "owner_id": None,
                            }
                        )

                # Sort servers by member count descending
                all_bot_servers.sort(
                    key=lambda x: (
                        x["member_count"] if isinstance(x["member_count"], int) else 0
                    ),
                    reverse=True,
                )

            except Exception as e:
                log.error(f"Error fetching bot servers: {e}")

        # 7. Owner-only banned guild overview
        banned_guilds = []
        if is_owner:
            try:
                cursor.execute(
                    """
                    SELECT guild_id, guild_name, member_count, banned_at, banned_by 
                    FROM public.banned_guilds 
                    ORDER BY banned_at DESC
                """
                )
                banned_rows = cursor.fetchall()
                for row in banned_rows:
                    banned_guilds.append(
                        {
                            "id": row[0],
                            "name": row[1] or "Unknown Server",
                            "member_count": row[2] or 0,
                            "banned_at": row[3],
                            "banned_by": row[4],
                        }
                    )
            except Exception as e:
                log.error(f"Error fetching banned guilds: {e}")

        return render_template(
            "profile.html",
            active_servers=active_servers,
            invite_servers=invite_servers,
            is_owner=is_owner,
            owner_stats=owner_stats,
            all_bot_servers=all_bot_servers,
            banned_guilds=banned_guilds,
            bot_id=YOUR_BOT_ID,
            permissions=permissions,
        )

    except Exception as e:
        log.error(f"Profile Error: {e}")
        return "An error occurred", 500
    finally:
        if conn and pool:
            cursor.close()
            pool.putconn(conn)


# ==================== OWNER API ENDPOINTS ====================


@app.route("/api/owner/leave", methods=["POST"])
@login_required
def owner_leave_guild():
    """
    Owner-only endpoint to force the bot to leave a guild
    and remove its configuration from the database.
    """
    if str(current_user.id) != str(BOT_OWNER_ID):
        return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json()
    guild_id = data.get("guild_id")

    if not guild_id:
        return jsonify({"error": "Guild ID is required"}), 400

    pool = init_db_pool()
    conn = pool.getconn()
    try:
        cursor = conn.cursor()

        # Remove from database
        cursor.execute(
            "DELETE FROM public.guild_settings WHERE guild_id = %s", (guild_id,)
        )
        conn.commit()

        # Make the bot leave the Discord server using Discord API
        try:
            bot_headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
            leave_resp = requests.delete(
                f"{DISCORD_API_BASE_URL}/users/@me/guilds/{guild_id}",
                headers=bot_headers,
                timeout=5,
            )
            if leave_resp.status_code == 204:
                log.info(f"✅ Bot successfully left guild {guild_id}")
            else:
                log.warning(
                    f"Failed to leave guild {guild_id}: {leave_resp.status_code}"
                )
        except Exception as e:
            log.error(f"Error making bot leave guild: {e}")

        return jsonify(
            {
                "success": True,
                "message": "Server configuration removed and bot left the server.",
            }
        )
    finally:
        pool.putconn(conn)


@app.route("/api/owner/ban", methods=["POST"])
@login_required
def owner_ban_guild():
    """
    Owner-only endpoint to ban a guild from using the bot.

    Inserts into `banned_guilds`, cleans up configuration,
    and forces the bot to leave the guild.
    """
    if str(current_user.id) != str(BOT_OWNER_ID):
        return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json()
    guild_id = data.get("guild_id")
    guild_name = data.get("guild_name", "Unknown Server")
    member_count = data.get("member_count", 0)

    if not guild_id:
        return jsonify({"error": "Guild ID is required"}), 400

    pool = init_db_pool()
    conn = pool.getconn()
    try:
        cursor = conn.cursor()

        # Insert into banned_guilds table
        cursor.execute(
            """
            INSERT INTO public.banned_guilds (guild_id, guild_name, member_count, banned_by)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (guild_id) DO UPDATE 
            SET guild_name = EXCLUDED.guild_name,
                member_count = EXCLUDED.member_count,
                banned_at = NOW(),
                banned_by = EXCLUDED.banned_by
        """,
            (guild_id, guild_name, member_count, current_user.id),
        )

        # Remove from guild_settings
        cursor.execute(
            "DELETE FROM public.guild_settings WHERE guild_id = %s", (guild_id,)
        )

        conn.commit()
        increment_command_counter()

        # Make the bot leave the Discord server
        try:
            bot_headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
            leave_resp = requests.delete(
                f"{DISCORD_API_BASE_URL}/users/@me/guilds/{guild_id}",
                headers=bot_headers,
                timeout=5,
            )
            if leave_resp.status_code == 204:
                log.info(f"✅ Bot successfully left and banned guild {guild_id}")
            else:
                log.warning(
                    f"Failed to leave guild {guild_id}: {leave_resp.status_code}"
                )
        except Exception as e:
            log.error(f"Error making bot leave guild during ban: {e}")

        return jsonify(
            {
                "success": True,
                "message": f"Successfully banned {guild_name} and bot left the server",
            }
        )
    except Exception as e:
        log.error(f"Ban error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        pool.putconn(conn)


@app.route("/api/owner/unban", methods=["POST"])
@login_required
def owner_unban_guild():
    """
    Owner-only endpoint to unban a previously banned guild.

    Removes the entry from `banned_guilds`.
    """
    if str(current_user.id) != str(BOT_OWNER_ID):
        return jsonify({"error": "Unauthorized"}), 403

    data = request.get_json()
    guild_id = data.get("guild_id")

    if not guild_id:
        return jsonify({"error": "Guild ID is required"}), 400

    pool = init_db_pool()
    conn = pool.getconn()
    try:
        cursor = conn.cursor()

        # Check if guild is banned
        cursor.execute(
            "SELECT guild_name FROM public.banned_guilds WHERE guild_id = %s",
            (guild_id,),
        )
        result = cursor.fetchone()

        if not result:
            return jsonify({"error": "Guild is not banned"}), 404

        guild_name = result[0] or "Unknown Server"

        # Remove from banned_guilds
        cursor.execute(
            "DELETE FROM public.banned_guilds WHERE guild_id = %s", (guild_id,)
        )
        conn.commit()
        increment_command_counter()

        return jsonify(
            {
                "success": True,
                "message": f"Successfully unbanned {guild_name}",
            }
        )
    except Exception as e:
        log.error(f"Unban error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        pool.putconn(conn)


# ==================== SERVER CONFIG ROUTES ====================


@app.route("/dashboard/server/<guild_id>")
@login_required
def server_config(guild_id):
    """
    Server configuration page.

    Performs permission checks, loads core XP/level configuration,
    guild stats, and approximate member counts for the UI.
    """
    pool = init_db_pool()
    if not pool:
        return "DB Error", 500

    conn = None
    try:
        conn = pool.getconn()
        cursor = conn.cursor()

        # 1. Auth Check (Standard)
        cursor.execute(
            "SELECT access_token FROM public.dashboard_users WHERE user_id = %s",
            (current_user.id,),
        )
        token_row = cursor.fetchone()
        if not token_row:
            return redirect(url_for("dashboard_login"))

        headers = {"Authorization": f"Bearer {token_row[0]}"}
        response = requests.get(
            f"{DISCORD_API_BASE_URL}/users/@me/guilds", headers=headers
        )
        if response.status_code != 200:
            return redirect(url_for("dashboard_login"))

        guilds = response.json()
        target_guild = next((g for g in guilds if g["id"] == guild_id), None)
        if not target_guild:
            return "Access Denied", 403

        perms = int(target_guild.get("permissions", 0))
        if not ((perms & 0x8) == 0x8 or target_guild.get("owner", False)):
            return "Admin permissions required.", 403

        # --- FETCH DATA FOR TABS ---

        # A. General Settings
        cursor.execute(
            """SELECT xp_per_message, xp_per_image, xp_per_minute_in_voice, 
                      voice_xp_limit, xp_cooldown 
               FROM public.guild_settings WHERE guild_id = %s""",
            (guild_id,),
        )
        row = cursor.fetchone()
        settings = {
            "xp_per_message": row[0] if row else 5,
            "xp_per_image": row[1] if row else 10,
            "xp_per_minute_in_voice": row[2] if row else 15,
            "voice_xp_limit": row[3] if row else 1500,
            "xp_cooldown": row[4] if row else 60,
        }

        # B. Level Rewards
        cursor.execute(
            "SELECT level, role_id, role_name FROM public.level_roles WHERE guild_id = %s ORDER BY level ASC",
            (guild_id,),
        )
        level_rewards = [
            {"level": r[0], "role_id": r[1], "role_name": r[2]}
            for r in cursor.fetchall()
        ]

        # C. Notification Channel
        cursor.execute(
            "SELECT channel_id FROM public.level_notify_channel WHERE guild_id = %s",
            (guild_id,),
        )
        notify_res = cursor.fetchone()
        level_notify_id = notify_res[0] if notify_res else None

        # D. Auto Reset Config
        cursor.execute(
            "SELECT days, last_reset FROM public.auto_reset WHERE guild_id = %s",
            (guild_id,),
        )
        reset_res = cursor.fetchone()
        auto_reset = (
            {"days": reset_res[0], "last_reset": reset_res[1]} if reset_res else None
        )

        # E. Guild Stats (weekly counters)
        cursor.execute(
            "SELECT messages_this_week, new_members_this_week, last_reset FROM public.guild_stats WHERE guild_id = %s",
            (guild_id,),
        )
        stats_res = cursor.fetchone()
        guild_stats = {
            "messages_this_week": stats_res[0] if stats_res else 0,
            "new_members_this_week": stats_res[1] if stats_res else 0,
            "last_reset": stats_res[2] if stats_res else None,
        }

        # F. Total member count (approximate from Discord API)
        total_members = 0
        try:
            bot_headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
            guild_resp = requests.get(
                f"{DISCORD_API_BASE_URL}/guilds/{guild_id}?with_counts=true",
                headers=bot_headers,
                timeout=5,
            )
            if guild_resp.status_code == 200:
                guild_data = guild_resp.json()
                total_members = guild_data.get("approximate_member_count", 0)
        except Exception as e:
            log.error(f"Error fetching member count: {e}")

        return render_template(
            "server_config.html",
            server=target_guild,
            settings=settings,
            level_rewards=level_rewards,
            level_notify_id=level_notify_id,
            auto_reset=auto_reset,
            guild_stats=guild_stats,
            total_members=total_members,
        )

    except Exception as e:
        log.error(f"Config Error: {e}")
        return "Error", 500
    finally:
        if conn and pool:
            cursor.close()
            pool.putconn(conn)


# ==================== SERVER DATA REFRESH API ====================


@app.route("/api/server/<guild_id>/refresh", methods=["GET"])
@login_required
def refresh_server_data(guild_id):
    """
    Return up-to-date server configuration and stats without reloading the page.

    Response includes:
    - guild_stats (weekly counters)
    - total_members (approximate)
    - settings (XP configuration)
    """
    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "DB Error"}), 500

    conn = None
    try:
        conn = pool.getconn()
        cursor = conn.cursor()

        # Auth check: ensure token is present (simple access validation)
        cursor.execute(
            "SELECT access_token FROM public.dashboard_users WHERE user_id = %s",
            (current_user.id,),
        )
        token_row = cursor.fetchone()
        if not token_row:
            return jsonify({"error": "Unauthorized"}), 401

        # Fetch guild stats
        cursor.execute(
            "SELECT messages_this_week, new_members_this_week, last_reset FROM public.guild_stats WHERE guild_id = %s",
            (guild_id,),
        )
        stats_res = cursor.fetchone()
        guild_stats = {
            "messages_this_week": stats_res[0] if stats_res else 0,
            "new_members_this_week": stats_res[1] if stats_res else 0,
            "last_reset": (
                stats_res[2].isoformat() if stats_res and stats_res[2] else None
            ),
        }

        # Fetch general settings
        cursor.execute(
            """SELECT xp_per_message, xp_per_image, xp_per_minute_in_voice, 
                      voice_xp_limit, xp_cooldown 
               FROM public.guild_settings WHERE guild_id = %s""",
            (guild_id,),
        )
        row = cursor.fetchone()
        settings = {
            "xp_per_message": row[0] if row else 5,
            "xp_per_image": row[1] if row else 10,
            "xp_per_minute_in_voice": row[2] if row else 15,
            "voice_xp_limit": row[3] if row else 1500,
            "xp_cooldown": row[4] if row else 60,
        }

        # Total member count (approximate)
        total_members = 0
        try:
            bot_headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
            guild_resp = requests.get(
                f"{DISCORD_API_BASE_URL}/guilds/{guild_id}?with_counts=true",
                headers=bot_headers,
                timeout=5,
            )
            if guild_resp.status_code == 200:
                guild_data = guild_resp.json()
                total_members = guild_data.get("approximate_member_count", 0)
        except Exception as e:
            log.error(f"Error fetching member count: {e}")

        return jsonify(
            {
                "success": True,
                "guild_stats": guild_stats,
                "total_members": total_members,
                "settings": settings,
            }
        )

    except Exception as e:
        log.error(f"Refresh Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn and pool:
            cursor.close()
            pool.putconn(conn)


# ==================== LEVEL REWARD & GUILD DATA API ====================


@app.route("/api/server/<guild_id>/discord-data", methods=["GET"])
@login_required
def get_discord_data(guild_id):
    """
    Fetch roles and channels for a guild via the Discord API.

    Used to populate dropdowns for configuration UI.
    """
    pool = init_db_pool()
    conn = pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT access_token FROM public.dashboard_users WHERE user_id = %s",
            (current_user.id,),
        )
        token = cursor.fetchone()[0]

        headers = {
            "Authorization": f"Bot {DISCORD_BOT_TOKEN}"
        }  # Use Bot Token for Guild Data

        roles_resp = requests.get(
            f"{DISCORD_API_BASE_URL}/guilds/{guild_id}/roles", headers=headers
        )
        roles = roles_resp.json() if roles_resp.status_code == 200 else []

        channels_resp = requests.get(
            f"{DISCORD_API_BASE_URL}/guilds/{guild_id}/channels", headers=headers
        )
        channels = channels_resp.json() if channels_resp.status_code == 200 else []

        # Filter out @everyone
        roles = [r for r in roles if r.get("name") != "@everyone"]

        return jsonify({"roles": roles, "channels": channels})
    except Exception as e:
        log.error(f"Data Fetch Error: {e}")
        return jsonify({"roles": [], "channels": []})
    finally:
        if conn:
            pool.putconn(conn)


@app.route("/api/server/<guild_id>/level-reward", methods=["POST", "DELETE"])
@login_required
def manage_level_reward(guild_id):
    """
    Create, update, or delete level reward mappings.

    POST
        Creates or updates a level -> role mapping.
    DELETE
        Deletes the mapping for a specific level.
    """
    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "DB Error"}), 500
    conn = pool.getconn()
    try:
        cursor = conn.cursor()

        if request.method == "POST":
            data = request.get_json()
            level = int(data.get("level"))
            role_id = data.get("role_id")
            role_name = data.get("role_name")

            cursor.execute(
                """INSERT INTO public.level_roles (guild_id, level, role_id, role_name) 
                   VALUES (%s, %s, %s, %s) 
                   ON CONFLICT (guild_id, level) DO UPDATE SET role_id=EXCLUDED.role_id, role_name=EXCLUDED.role_name""",
                (guild_id, level, role_id, role_name),
            )
            conn.commit()
            return jsonify({"success": True})

        elif request.method == "DELETE":
            level = request.args.get("level")
            cursor.execute(
                "DELETE FROM public.level_roles WHERE guild_id = %s AND level = %s",
                (guild_id, level),
            )
            conn.commit()
            return jsonify({"success": True})

    except Exception as e:
        log.error(f"Reward API Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            pool.putconn(conn)


@app.route("/api/server/<guild_id>/level-settings", methods=["POST"])
@login_required
def save_level_settings(guild_id):
    """
    Save level system settings for a guild.

    This includes:
    - Level up notification channel.
    - Auto-reset schedule (with or without role removal).
    - Message templates and formatting.
    - Role stacking and announcement behavior.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403

    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "DB Error"}), 500

    conn = pool.getconn()
    try:
        cursor = conn.cursor()
        data = request.get_json()

        # Extract settings from request
        notify_channel_id = data.get("notify_channel_id")
        auto_reset_days = data.get("auto_reset_days", 0)
        auto_reset_enabled = data.get("auto_reset_enabled", False)
        auto_reset_remove_roles_days = data.get("auto_reset_remove_roles_days", 0)
        auto_reset_remove_roles_enabled = data.get(
            "auto_reset_remove_roles_enabled", False
        )

        # Notification channel
        if notify_channel_id:
            cursor.execute(
                """
                INSERT INTO public.level_notify_channel (guild_id, channel_id)
                VALUES (%s, %s)
                ON CONFLICT (guild_id) DO UPDATE SET channel_id = EXCLUDED.channel_id
                """,
                (guild_id, notify_channel_id),
            )
        else:
            cursor.execute(
                "DELETE FROM public.level_notify_channel WHERE guild_id = %s",
                (guild_id,),
            )

        # Auto-reset settings
        if auto_reset_remove_roles_enabled and auto_reset_remove_roles_days > 0:
            cursor.execute(
                """
                INSERT INTO public.auto_reset (guild_id, days, last_reset, remove_roles)
                VALUES (%s, %s, NOW(), TRUE)
                ON CONFLICT (guild_id) DO UPDATE SET 
                    days = EXCLUDED.days,
                    remove_roles = TRUE,
                    last_reset = NOW()
                """,
                (guild_id, auto_reset_remove_roles_days),
            )
        elif auto_reset_enabled and auto_reset_days > 0:
            cursor.execute(
                """
                INSERT INTO public.auto_reset (guild_id, days, last_reset, remove_roles)
                VALUES (%s, %s, NOW(), FALSE)
                ON CONFLICT (guild_id) DO UPDATE SET 
                    days = EXCLUDED.days,
                    remove_roles = FALSE,
                    last_reset = NOW()
                """,
                (guild_id, auto_reset_days),
            )
        else:
            cursor.execute(
                "DELETE FROM public.auto_reset WHERE guild_id = %s",
                (guild_id,),
            )

        # Level system configuration
        message_style = data.get("message_style", "embed")
        custom_message = data.get(
            "custom_message",
            "{user} just leveled up to **Level {level}**!",
        )
        custom_message_role_reward = data.get(
            "custom_message_role_reward",
            "{user} just leveled up to **Level {level}** and earned the **{role}** role!",
        )
        stack_roles = data.get("stack_roles", True)
        announce_roles = data.get("announce_roles", True)

        cursor.execute(
            """
            INSERT INTO public.level_system_config 
            (guild_id, message_style, custom_message, custom_message_role_reward, stack_role_rewards, announce_role_rewards)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (guild_id) DO UPDATE SET
                message_style = EXCLUDED.message_style,
                custom_message = EXCLUDED.custom_message,
                custom_message_role_reward = EXCLUDED.custom_message_role_reward,
                stack_role_rewards = EXCLUDED.stack_role_rewards,
                announce_role_rewards = EXCLUDED.announce_role_rewards,
                updated_at = NOW()
            """,
            (
                guild_id,
                message_style,
                custom_message,
                custom_message_role_reward,
                stack_roles,
                announce_roles,
            ),
        )

        conn.commit()
        increment_command_counter()
        return jsonify({"success": True})

    except Exception as e:
        log.error(f"Level Settings API Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            pool.putconn(conn)


@app.route("/api/server/<guild_id>/level-settings-get", methods=["GET"])
@login_required
def get_level_settings(guild_id):
    """
    Retrieve level system settings for a guild.

    Returns notification channel, message templates, announcement behavior,
    and auto-reset configuration.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403

    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "DB Error"}), 500

    conn = pool.getconn()
    try:
        cursor = conn.cursor()
        result = {}

        # Notification channel
        cursor.execute(
            "SELECT channel_id FROM public.level_notify_channel WHERE guild_id = %s",
            (guild_id,),
        )
        row = cursor.fetchone()
        if row:
            result["notify_channel_id"] = row[0]

        # Additional system configuration
        cursor.execute(
            """
            SELECT message_style, custom_message, custom_message_role_reward, stack_role_rewards, announce_role_rewards 
            FROM public.level_system_config WHERE guild_id = %s
            """,
            (guild_id,),
        )
        row = cursor.fetchone()
        if row:
            result.update(
                {
                    "message_style": row[0],
                    "custom_message": row[1],
                    "custom_message_role_reward": row[2],
                    "stack_role_rewards": row[3],
                    "announce_role_rewards": row[4],
                }
            )

        # Auto-reset config
        cursor.execute(
            "SELECT days, last_reset, remove_roles FROM public.auto_reset WHERE guild_id = %s",
            (guild_id,),
        )
        row = cursor.fetchone()
        if row:
            result["auto_reset"] = {
                "days": row[0],
                "last_reset": row[1].isoformat() if row[1] else None,
                "remove_roles": row[2],
            }

        return jsonify(result)

    except Exception as e:
        log.error(f"Get Level Settings Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            pool.putconn(conn)


@app.route("/api/server/<guild_id>/reset-xp", methods=["POST"])
@login_required
def manual_reset_xp(guild_id):
    """
    Manually reset all XP for a guild, with optional role cleanup.

    Request JSON:
    - keep_roles (bool): if False, attempts to remove reward roles via Discord API.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403

    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "DB Error"}), 500

    conn = pool.getconn()
    try:
        cursor = conn.cursor()
        data = request.get_json() or {}
        keep_roles = data.get("keep_roles", False)

        roles_removed_count = 0

        # Remove reward roles from members if not keeping roles
        if not keep_roles:
            cursor.execute(
                "SELECT role_id FROM public.level_roles WHERE guild_id = %s",
                (guild_id,),
            )
            reward_roles = [str(r[0]) for r in cursor.fetchall()]

            if reward_roles:
                headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}

                members_resp = requests.get(
                    f"{DISCORD_API_BASE_URL}/guilds/{guild_id}/members?limit=1000",
                    headers=headers,
                )

                if members_resp.status_code == 200:
                    members = members_resp.json()

                    for member in members:
                        user_id = member["user"]["id"]
                        user_role_ids = member.get("roles", [])

                        roles_to_remove = set(user_role_ids).intersection(reward_roles)

                        for role_id in roles_to_remove:
                            del_resp = requests.delete(
                                f"{DISCORD_API_BASE_URL}/guilds/{guild_id}/members/{user_id}/roles/{role_id}",
                                headers=headers,
                            )
                            if del_resp.status_code == 204:
                                roles_removed_count += 1
                else:
                    log.warning(
                        f"Could not fetch members for XP reset role cleanup: {members_resp.status_code}"
                    )

        # Reset user XP and levels
        cursor.execute(
            "UPDATE public.users SET xp = 0, level = 0, voice_xp_earned = 0 WHERE guild_id = %s",
            (guild_id,),
        )
        cursor.execute(
            "UPDATE public.last_notified_level SET level = 0 WHERE guild_id = %s",
            (guild_id,),
        )

        conn.commit()

        action = (
            "Reset XP & Removed Roles" if not keep_roles else "Reset XP (Kept Roles)"
        )
        log_dashboard_activity(
            guild_id,
            "RESET_XP",
            f"{action}. Roles Removed: {roles_removed_count}",
        )

        return jsonify(
            {
                "status": "success",
                "message": "XP Reset Complete",
                "roles_removed": roles_removed_count,
            }
        )

    except Exception as e:
        if conn:
            conn.rollback()
        log.error(f"Reset XP Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            pool.putconn(conn)


# ==================== TIMEZONE & CLOCK MANAGEMENT ====================


@app.route("/api/timezones", methods=["GET"])
def get_all_timezones():
    """
    Return a list of all common pytz timezones for frontend dropdowns.
    """
    return jsonify({"timezones": pytz.common_timezones})


@app.route("/api/server/<guild_id>/clocks", methods=["GET", "POST", "DELETE"])
@login_required
def manage_clocks(guild_id):
    """
    Manage server clock configurations for a guild.

    GET
        List all clock configurations.
    POST
        Create or update a clock configuration for a given time channel.
    DELETE
        Delete a clock configuration by Discord channel ID.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403

    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "DB Error"}), 500
    conn = pool.getconn()

    try:
        cursor = conn.cursor()

        if request.method == "GET":
            cursor.execute(
                """
                SELECT id, time_channel_id, timezone, date_channel_id 
                FROM public.server_time_configs 
                WHERE guild_id = %s
            """,
                (guild_id,),
            )

            clocks = []
            for row in cursor.fetchall():
                clocks.append(
                    {
                        "id": row[0],
                        "channel_id": row[1],
                        "timezone": row[2],
                        "date_channel_id": row[3],
                    }
                )
            return jsonify({"clocks": clocks})

        elif request.method == "POST":
            data = request.get_json()
            timezone = data.get("timezone")
            channel_id = data.get("channel_id")
            date_channel_id = data.get("date_channel_id")

            if not timezone or not channel_id:
                return jsonify({"error": "Missing fields"}), 400

            if not date_channel_id:
                date_channel_id = None

            cursor.execute(
                """
                INSERT INTO public.server_time_configs 
                (guild_id, timezone, time_channel_id, date_channel_id, needs_update)
                VALUES (%s, %s, %s, %s, TRUE)
                ON CONFLICT (time_channel_id) DO UPDATE SET 
                    timezone = EXCLUDED.timezone,
                    date_channel_id = EXCLUDED.date_channel_id,
                    needs_update = TRUE
                """,
                (guild_id, timezone, channel_id, date_channel_id),
            )
            conn.commit()
            increment_command_counter()
            return jsonify({"success": True})

        elif request.method == "DELETE":
            channel_id = request.args.get("channel_id")
            cursor.execute(
                "DELETE FROM public.server_time_configs WHERE guild_id = %s AND time_channel_id = %s",
                (guild_id, channel_id),
            )
            conn.commit()
            return jsonify({"success": True})

    except Exception as e:
        log.error(f"Clock API Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            pool.putconn(conn)


@app.route("/api/server/<guild_id>/clocks/<int:clock_id>", methods=["PUT"])
@login_required
def update_clock(guild_id, clock_id):
    """
    Update an existing clock configuration by its database ID.

    Request JSON:
    - timezone
    - channel_id
    - date_channel_id (optional)
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403

    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "DB Error"}), 500
    conn = pool.getconn()

    try:
        cursor = conn.cursor()
        data = request.get_json()

        new_timezone = data.get("timezone")
        new_channel_id = data.get("channel_id")
        new_date_channel_id = data.get("date_channel_id")

        if not new_timezone or not new_channel_id:
            return jsonify({"error": "Missing required fields"}), 400

        if not new_date_channel_id:
            new_date_channel_id = None

        cursor.execute(
            """
            UPDATE public.server_time_configs 
            SET timezone = %s, 
                time_channel_id = %s,
                date_channel_id = %s,
                needs_update = TRUE
            WHERE guild_id = %s AND id = %s
            """,
            (new_timezone, new_channel_id, new_date_channel_id, guild_id, clock_id),
        )

        if cursor.rowcount == 0:
            log.warning(
                f"Clock update failed for guild {guild_id}, clock ID {clock_id}. Rowcount 0."
            )
            return jsonify({"error": "Clock not found"}), 404

        conn.commit()
        increment_command_counter()
        return jsonify({"success": True})

    except Exception as e:
        log.error(f"Clock Update Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            pool.putconn(conn)


# ==================== YOUTUBE INTEGRATION ====================


@app.route("/api/youtube/search", methods=["POST"])
@login_required
def search_youtube_channel():
    """
    Search for a YouTube channel using the YouTube Data API.

    Request JSON:
    - query: channel name or URL.

    Returns basic channel metadata including subscriber and video counts.
    """
    data = request.get_json()
    query = data.get("query")

    api_key = os.getenv("YOUTUBE_API_KEY")
    if not api_key:
        return jsonify({"error": "YouTube API Key not configured on server"}), 500

    try:
        if "youtube.com" in query:
            query = query.split("/")[-1]

        search_url = (
            "https://www.googleapis.com/youtube/v3/search"
            f"?part=snippet&q={query}&type=channel&maxResults=1&key={api_key}"
        )
        search_res = requests.get(search_url).json()

        if not search_res.get("items"):
            return jsonify({"error": "Channel not found"}), 404

        channel_id = search_res["items"][0]["snippet"]["channelId"]

        stats_url = (
            "https://www.googleapis.com/youtube/v3/channels"
            f"?part=snippet,statistics&id={channel_id}&key={api_key}"
        )
        stats_res = requests.get(stats_url).json()

        info = stats_res["items"][0]

        return jsonify(
            {
                "id": info["id"],
                "name": info["snippet"]["title"],
                "thumbnail": info["snippet"]["thumbnails"]["default"]["url"],
                "subscribers": info["statistics"].get("subscriberCount", "Hidden"),
                "video_count": info["statistics"].get("videoCount", "0"),
            }
        )

    except Exception as e:
        log.error(f"YT Search Error: {e}")
        return jsonify({"error": "Failed to contact YouTube API"}), 500


@app.route("/api/server/<guild_id>/youtube", methods=["GET", "POST", "DELETE"])
@login_required
def manage_youtube(guild_id):
    """
    Manage YouTube notification configurations for a guild.

    GET
        List active YouTube notification configs.
    POST
        Add or update a YouTube notification config and seed existing videos.
    DELETE
        Remove a YouTube notification config by channel ID.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403

    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "DB Error"}), 500
    conn = pool.getconn()

    try:
        cursor = conn.cursor()

        if request.method == "GET":
            cursor.execute(
                """
                SELECT yt_channel_id, yt_channel_name, target_channel_id, mention_role_id, custom_message 
                FROM public.youtube_notification_config WHERE guild_id = %s
            """,
                (guild_id,),
            )
            configs = []
            for row in cursor.fetchall():
                configs.append(
                    {
                        "yt_id": row[0],
                        "name": row[1],
                        "target_channel": row[2],
                        "role_id": row[3],
                        "message": row[4],
                    }
                )
            return jsonify({"configs": configs})

        elif request.method == "POST":
            data = request.get_json()
            yt_id = data.get("yt_id")
            yt_name = data.get("yt_name")
            target_ch = data.get("target_channel")
            role_id = data.get("role_id")
            msg = data.get("message")

            if not all([yt_id, target_ch]):
                return jsonify({"error": "Missing fields"}), 400

            cursor.execute(
                """
                INSERT INTO public.youtube_notification_config 
                (guild_id, yt_channel_id, yt_channel_name, target_channel_id, mention_role_id, custom_message, is_enabled)
                VALUES (%s, %s, %s, %s, %s, %s, TRUE)
                ON CONFLICT (guild_id, yt_channel_id) DO UPDATE SET
                target_channel_id = EXCLUDED.target_channel_id,
                mention_role_id = EXCLUDED.mention_role_id,
                custom_message = EXCLUDED.custom_message,
                yt_channel_name = EXCLUDED.yt_channel_name
            """,
                (guild_id, yt_id, yt_name, target_ch, role_id, msg),
            )

            # Seed existing videos to avoid spam on first run
            rss_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={yt_id}"
            feed = feedparser.parse(rss_url)

            if feed.entries:
                log.info(f"Seeding {len(feed.entries)} videos for {yt_name}")
                for entry in feed.entries:
                    video_id = entry.yt_videoid
                    cursor.execute(
                        """
                        INSERT INTO public.youtube_notification_logs (guild_id, yt_channel_id, video_id, video_status)
                        VALUES (%s, %s, %s, 'seeded')
                        ON CONFLICT DO NOTHING
                    """,
                        (guild_id, yt_id, video_id),
                    )

            conn.commit()
            increment_command_counter()
            return jsonify({"success": True, "seeded_count": len(feed.entries)})

        elif request.method == "DELETE":
            yt_id = request.args.get("yt_id")
            cursor.execute(
                "DELETE FROM public.youtube_notification_config WHERE guild_id = %s AND yt_channel_id = %s",
                (guild_id, yt_id),
            )
            conn.commit()
            return jsonify({"success": True})

    except Exception as e:
        log.error(f"YouTube API Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            pool.putconn(conn)


# ==================== CHANNEL RESTRICTIONS V2 API ====================


@app.route("/api/server/<guild_id>/channel-restrictions-v2/data", methods=["GET"])
@login_required
def get_channel_restrictions_v2_data(guild_id):
    """
    Retrieve all channel restriction v2 configurations for a guild.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403

    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "DB Error"}), 500
    conn = pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, channel_id, channel_name, restriction_type, 
                   allowed_content_types, blocked_content_types,
                   redirect_channel_id, immune_roles
            FROM public.channel_restrictions_v2 
            WHERE guild_id = %s ORDER BY channel_name ASC
        """,
            (guild_id,),
        )

        restrictions = []
        columns = [desc[0] for desc in cursor.description]
        for row in cursor.fetchall():
            r = dict(zip(columns, row))
            r["immune_roles"] = r["immune_roles"] if r["immune_roles"] else []
            restrictions.append(r)

        return jsonify({"restrictions": restrictions})
    finally:
        if conn:
            pool.putconn(conn)


@app.route(
    "/api/server/<guild_id>/channel-restrictions-v2", methods=["POST", "PUT", "DELETE"]
)
@login_required
def manage_restrictions_v2(guild_id):
    """
    Manage channel restrictions v2 for a guild.

    POST
        Create a new restriction for a channel.
    PUT
        Update an existing restriction (by ID).
    DELETE
        Delete an existing restriction (by ID).
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403

    pool = init_db_pool()
    conn = pool.getconn()
    try:
        cursor = conn.cursor()

        if request.method == "DELETE":
            res_id = request.args.get("id")
            cursor.execute(
                "DELETE FROM public.channel_restrictions_v2 WHERE id = %s AND guild_id = %s",
                (res_id, guild_id),
            )
            conn.commit()
            increment_command_counter()
            return jsonify({"success": True})

        data = request.get_json()
        channel_id = data.get("channel_id")
        channel_name = data.get("channel_name")
        res_type = data.get("restriction_type", "block_invites")
        allowed = data.get("allowed_content_types", 0)
        blocked = data.get("blocked_content_types", 0)
        redirect_id = data.get("redirect_channel_id") or None
        redirect_name = data.get("redirect_channel_name")
        immune_roles = data.get("immune_roles", [])

        if request.method == "POST":
            cursor.execute(
                "SELECT 1 FROM public.channel_restrictions_v2 WHERE guild_id=%s AND channel_id=%s",
                (guild_id, channel_id),
            )
            if cursor.fetchone():
                return (
                    jsonify(
                        {
                            "error": "This channel already has a restriction. Edit it instead."
                        }
                    ),
                    409,
                )

            cursor.execute(
                """
                INSERT INTO public.channel_restrictions_v2 
                (guild_id, channel_id, channel_name, restriction_type, allowed_content_types, blocked_content_types, redirect_channel_id, redirect_channel_name, immune_roles, configured_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
                (
                    guild_id,
                    channel_id,
                    channel_name,
                    res_type,
                    allowed,
                    blocked,
                    redirect_id,
                    redirect_name,
                    immune_roles,
                    current_user.id,
                ),
            )

        elif request.method == "PUT":
            res_id = data.get("id")
            cursor.execute(
                """
                UPDATE public.channel_restrictions_v2 
                SET restriction_type=%s, allowed_content_types=%s, blocked_content_types=%s, 
                    redirect_channel_id=%s, redirect_channel_name=%s, immune_roles=%s, updated_at=NOW()
                WHERE id=%s AND guild_id=%s
            """,
                (
                    res_type,
                    allowed,
                    blocked,
                    redirect_id,
                    redirect_name,
                    immune_roles,
                    res_id,
                    guild_id,
                ),
            )

        conn.commit()
        increment_command_counter()
        return jsonify({"success": True})

    except Exception as e:
        log.error(f"Restriction API Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            pool.putconn(conn)


# ==================== REMINDER API ====================


@app.route("/api/server/<guild_id>/reminders", methods=["GET"])
@login_required
def get_reminders(guild_id):
    """
    List non-deleted reminders for a guild.

    Datetimes are returned as ISO-formatted UTC strings for frontend conversion.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403

    pool = init_db_pool()
    conn = pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, reminder_id, channel_id, role_id, message, 
                   next_run, interval, timezone, status, run_count
            FROM public.reminders 
            WHERE guild_id = %s AND status != 'deleted'
            ORDER BY next_run ASC
        """,
            (guild_id,),
        )

        columns = [desc[0] for desc in cursor.description]
        reminders = []
        for row in cursor.fetchall():
            r = dict(zip(columns, row))
            r["next_run"] = r["next_run"].isoformat() if r["next_run"] else None
            reminders.append(r)

        return jsonify({"reminders": reminders})
    except Exception as e:
        log.error(f"Fetch Reminders Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            pool.putconn(conn)


@app.route("/api/server/<guild_id>/reminders/manage", methods=["POST"])
@login_required
def manage_reminder(guild_id):
    """
    Create or edit a reminder for a guild.

    Timezone-aware:
    - Accepts local time + timezone from the user.
    - Converts to UTC for storage, preserving intended local execution time.

    Request JSON:
    - channel_id
    - message
    - start_time (e.g. "2025-12-04T15:30")
    - timezone (e.g. "Asia/Tokyo")
    - interval ("once", "daily", etc.)
    - role_id (optional)
    - reminder_id (optional, for edits)
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403

    data = request.get_json()

    channel_id = data.get("channel_id")
    message = data.get("message")
    start_time_str = data.get("start_time")
    timezone_str = data.get("timezone")
    interval = data.get("interval", "once")
    role_id = data.get("role_id") or None

    if not all([channel_id, message, start_time_str, timezone_str]):
        return jsonify({"error": "Missing required fields"}), 400

    try:
        # Parse local datetime and convert to UTC
        local_dt = datetime.strptime(start_time_str, "%Y-%m-%dT%H:%M")
        tz = pytz.timezone(timezone_str)
        local_aware = tz.localize(local_dt)
        utc_dt = local_aware.astimezone(pytz.UTC)

        import secrets

        reminder_id = data.get("reminder_id")
        action = "created"

        pool = init_db_pool()
        conn = pool.getconn()
        cursor = conn.cursor()

        if reminder_id:
            cursor.execute(
                "SELECT 1 FROM public.reminders WHERE reminder_id = %s AND guild_id = %s",
                (reminder_id, guild_id),
            )
            if not cursor.fetchone():
                return jsonify({"error": "Reminder not found"}), 404

            cursor.execute(
                """
                UPDATE public.reminders
                SET channel_id = %s, role_id = %s, message = %s, start_time = %s, 
                    next_run = %s, interval = %s, timezone = %s, updated_at = NOW(),
                    status = 'active'
                WHERE reminder_id = %s AND guild_id = %s
                """,
                (
                    channel_id,
                    role_id,
                    message,
                    utc_dt,
                    utc_dt,
                    interval,
                    timezone_str,
                    reminder_id,
                    guild_id,
                ),
            )
            action = "updated"
        else:
            reminder_id = f"R-{secrets.randbelow(9000) + 1000}"
            cursor.execute(
                """
                INSERT INTO public.reminders 
                (reminder_id, guild_id, channel_id, role_id, message, 
                 start_time, next_run, interval, timezone, created_by, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'active')
            """,
                (
                    reminder_id,
                    guild_id,
                    channel_id,
                    role_id,
                    message,
                    utc_dt,
                    utc_dt,
                    interval,
                    timezone_str,
                    str(current_user.id),
                ),
            )

        conn.commit()
        increment_command_counter()

        return jsonify({"success": True, "action": action})

    except Exception as e:
        log.error(f"Manage Reminder Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            pool.putconn(conn)


@app.route("/api/server/<guild_id>/reminders/<reminder_id>", methods=["DELETE"])
@login_required
def delete_reminder_api(guild_id, reminder_id):
    """
    Soft-delete a reminder by marking its status as 'deleted'.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403
    pool = init_db_pool()
    conn = pool.getconn()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE public.reminders SET status = 'deleted' WHERE reminder_id = %s AND guild_id = %s",
            (reminder_id, guild_id),
        )
        conn.commit()
        increment_command_counter()
        return jsonify({"success": True})
    finally:
        if conn:
            pool.putconn(conn)


@app.route("/api/server/<guild_id>/reminders/<reminder_id>/toggle", methods=["POST"])
@login_required
def toggle_reminder_status(guild_id, reminder_id):
    """
    Toggle reminder status between 'active' and 'paused'.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403
    pool = init_db_pool()
    conn = pool.getconn()
    try:
        cursor = conn.cursor()

        cursor.execute(
            "SELECT status FROM public.reminders WHERE reminder_id = %s AND guild_id = %s",
            (reminder_id, guild_id),
        )
        row = cursor.fetchone()
        if not row:
            return jsonify({"error": "Not found"}), 404

        new_status = "paused" if row[0] == "active" else "active"

        cursor.execute(
            "UPDATE public.reminders SET status = %s WHERE reminder_id = %s",
            (new_status, reminder_id),
        )
        conn.commit()
        increment_command_counter()

        return jsonify({"success": True, "new_status": new_status})
    finally:
        if conn:
            pool.putconn(conn)


# ==================== GUILD SETTINGS (XP CONFIG) ====================


@app.route("/api/server/<guild_id>/settings", methods=["GET", "POST"])
@login_required
def server_settings_api(guild_id):
    """
    Manage core XP settings for a guild.

    GET
        Returns current XP configuration, or defaults if missing.
    POST
        Upserts XP configuration fields into `guild_settings`.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403

    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "DB Error"}), 500
    conn = pool.getconn()
    try:
        cursor = conn.cursor()
        if request.method == "GET":
            cursor.execute(
                "SELECT xp_per_message, xp_per_image, xp_per_minute_in_voice, voice_xp_limit, xp_cooldown FROM public.guild_settings WHERE guild_id = %s",
                (guild_id,),
            )
            row = cursor.fetchone()
            if not row:
                return jsonify(
                    {
                        "xp_per_message": 5,
                        "xp_per_image": 10,
                        "xp_per_minute_in_voice": 15,
                        "voice_xp_limit": 1500,
                        "xp_cooldown": 60,
                    }
                )
            return jsonify(
                {
                    "xp_per_message": row[0],
                    "xp_per_image": row[1],
                    "xp_per_minute_in_voice": row[2],
                    "voice_xp_limit": row[3],
                    "xp_cooldown": row[4],
                }
            )

        elif request.method == "POST":
            data = request.get_json()
            xp_per_message = int(data.get("xp_per_message", 5))
            xp_per_image = int(data.get("xp_per_image", 10))
            xp_per_minute_in_voice = int(data.get("xp_per_minute_in_voice", 15))
            voice_xp_limit = int(data.get("voice_xp_limit", 1500))
            xp_cooldown = int(data.get("xp_cooldown", 60))

            cursor.execute(
                """
                INSERT INTO public.guild_settings (guild_id, xp_per_message, xp_per_image, xp_per_minute_in_voice, voice_xp_limit, xp_cooldown)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (guild_id) DO UPDATE SET
                  xp_per_message = EXCLUDED.xp_per_message,
                  xp_per_image = EXCLUDED.xp_per_image,
                  xp_per_minute_in_voice = EXCLUDED.xp_per_minute_in_voice,
                  voice_xp_limit = EXCLUDED.voice_xp_limit,
                  xp_cooldown = EXCLUDED.xp_cooldown
                """,
                (
                    guild_id,
                    xp_per_message,
                    xp_per_image,
                    xp_per_minute_in_voice,
                    voice_xp_limit,
                    xp_cooldown,
                ),
            )
            conn.commit()
            increment_command_counter()
            return jsonify({"success": True})

    except Exception as e:
        log.error(f"Settings API Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            pool.putconn(conn)


# ==================== LEADERBOARD API ====================


@app.route("/dashboard/server/<guild_id>/view-leaderboard")
@login_required
def view_full_leaderboard(guild_id):
    """
    Render the full leaderboard page for a guild.
    """
    if not user_has_access(current_user.id, guild_id):
        return "Access Denied", 403

    pool = init_db_pool()
    if not pool:
        return "DB Error", 500

    conn = pool.getconn()
    try:
        cursor = conn.cursor()

        headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
        try:
            guild_resp = requests.get(
                f"{DISCORD_API_BASE_URL}/guilds/{guild_id}", headers=headers
            )
            server = (
                guild_resp.json()
                if guild_resp.status_code == 200
                else {"id": guild_id, "name": "Unknown Server"}
            )
        except Exception:
            server = {"id": guild_id, "name": "Unknown Server"}

        return render_template(
            "Tabs/SubTabsLevel/config_level_leaderboard_full.html",
            server=server,
        )
    finally:
        if conn:
            pool.putconn(conn)


@app.route("/api/server/<guild_id>/leaderboard", methods=["GET"])
@login_required
def get_leaderboard(guild_id):
    """
    Leaderboard data endpoint.

    Requires:
    - Authenticated user with admin/owner access to the guild.

    Query parameters:
    - limit: int or 'all' (default '10')
    - search: username substring for filtering (optional)
    """
    access_granted = False
    try:
        access_granted = user_has_access(current_user.id, guild_id)
    except Exception as e:
        log.error(
            f"Leaderboard access check error for user {current_user.id}, guild {guild_id}: {e}"
        )
        access_granted = False

    if not access_granted:
        log.warning(
            f"Leaderboard 403: User {current_user.id} denied access to guild {guild_id}"
        )
        return (
            jsonify(
                {
                    "error": "Access denied. You must be the server owner or have Administrator permissions.",
                    "hint": "Try logging out and logging back in to refresh your permissions.",
                }
            ),
            403,
        )

    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "DB Error"}), 500

    conn = pool.getconn()
    try:
        cursor = conn.cursor()

        limit_arg = request.args.get("limit", "10")
        search_query = request.args.get("search", "")

        query = (
            "SELECT user_id, username, xp, level FROM public.users WHERE guild_id = %s"
        )
        params = [guild_id]

        if search_query:
            query += " AND username ILIKE %s"
            params.append(f"%{search_query}%")

        query += " ORDER BY xp DESC"

        if limit_arg != "all" and limit_arg != "0":
            try:
                limit = int(limit_arg)
                query += " LIMIT %s"
                params.append(limit)
            except ValueError:
                pass

        cursor.execute(query, tuple(params))
        rows = cursor.fetchall()

        leaderboard = [
            {
                "user_id": r[0],
                "username": r[1],
                "xp": r[2],
                "level": r[3],
                "avatar": None,
            }
            for r in rows
        ]
        return jsonify({"leaderboard": leaderboard})
    except Exception as e:
        log.error(f"Leaderboard Error: {e}")
        return jsonify({"leaderboard": []})
    finally:
        if conn:
            pool.putconn(conn)


# ==================== ANALYTICS API ENDPOINTS ====================


@app.route("/api/analytics/<guild_id>/current")
@login_required
def get_current_analytics(guild_id):
    """
    Get real-time analytics for a guild.

    Requires:
        - Authenticated dashboard user.
        - User must have access to the guild (admin/manager/owner or bot owner).

    Returns:
        JSON with:
            - Weekly message and member stats.
            - Member counts (DB + live from Discord).
            - XP and level statistics.
            - Feature adoption metrics.
            - Top contributors list.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Unauthorized"}), 403

    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "Database error"}), 500

    conn = None
    try:
        conn = pool.getconn()
        cursor = conn.cursor()

        # Guild-level weekly stats
        cursor.execute(
            """
            SELECT messages_this_week, new_members_this_week
            FROM public.guild_stats
            WHERE guild_id = %s
        """,
            (guild_id,),
        )
        stats = cursor.fetchone()

        # Member & XP aggregates
        cursor.execute(
            """
            SELECT 
                COUNT(*) as db_total,
                COUNT(*) FILTER (WHERE weekly_xp > 0) as active_members_weekly,
                SUM(xp) as total_xp_lifetime,
                SUM(weekly_xp) as total_xp_weekly,
                AVG(level) as avg_level
            FROM public.users
            WHERE guild_id = %s
        """,
            (guild_id,),
        )
        members = cursor.fetchone()

        db_total_members = members[0] if members else 0
        active_members_weekly = members[1] if members else 0
        total_xp_lifetime = (members[2] or 0) if members else 0
        total_xp_weekly = (members[3] or 0) if members else 0
        avg_level = (members[4] or 0) if members else 0

        # Live member count from Discord API (fallback to DB count)
        real_total_members = db_total_members
        try:
            bot_headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
            guild_resp = requests.get(
                f"{DISCORD_API_BASE_URL}/guilds/{guild_id}?with_counts=true",
                headers=bot_headers,
                timeout=3,
            )
            if guild_resp.status_code == 200:
                guild_data = guild_resp.json()
                real_total_members = guild_data.get(
                    "approximate_member_count", db_total_members
                )
        except Exception as e:
            log.error(f"Error fetching Discord member count for analytics: {e}")

        # Top contributors (by XP)
        cursor.execute(
            """
            SELECT user_id, username, xp, level
            FROM public.users
            WHERE guild_id = %s
            ORDER BY xp DESC
            LIMIT 10
        """,
            (guild_id,),
        )
        top_contributors = cursor.fetchall()

        # Leveling stats
        cursor.execute(
            """
            SELECT 
                SUM(xp) as total_xp,
                AVG(level) as avg_level,
                MAX(level) as max_level
            FROM public.users
            WHERE guild_id = %s
        """,
            (guild_id,),
        )
        leveling = cursor.fetchone()

        # Feature adoption metrics
        cursor.execute(
            """
            SELECT 
                (SELECT COUNT(*) FROM public.level_roles WHERE guild_id = %s) as level_roles,
                (SELECT COUNT(*) FROM public.youtube_notification_config WHERE guild_id = %s) as yt_feeds,
                (SELECT COUNT(*) FROM public.server_time_configs WHERE guild_id = %s) as time_clocks,
                (SELECT COUNT(*) FROM public.channel_restrictions_v2 WHERE guild_id = %s) as restrictions
        """,
            (guild_id, guild_id, guild_id, guild_id),
        )
        features = cursor.fetchone()
        feature_count = (
            (features[0] or 0)
            + (features[1] or 0)
            + (features[2] or 0)
            + (features[3] or 0)
        )

        return jsonify(
            {
                "messages_this_week": stats[0] if stats else 0,
                "new_members_this_week": stats[1] if stats else 0,
                "total_members": real_total_members,
                "active_members": active_members_weekly,
                "total_xp_weekly": total_xp_weekly,
                "lifetime_xp": total_xp_lifetime,
                "feature_count": feature_count,
                "top_contributors": [
                    {
                        "user_id": str(c[0]),
                        "username": c[1] or "Unknown",
                        "xp": int(c[2]),
                        "level": int(c[3]),
                    }
                    for c in top_contributors
                ],
                "total_xp": int(leveling[0] or 0),
                "avg_level": float(leveling[1] or 0),
                "max_level": int(leveling[2] or 0),
            }
        )

    except Exception as e:
        log.error(f"Error fetching current analytics for {guild_id}: {e}")
        return jsonify({"error": "Failed to fetch analytics"}), 500
    finally:
        if conn and pool:
            cursor.close()
            pool.putconn(conn)


@app.route("/api/analytics/<guild_id>/history")
@login_required
def get_analytics_history(guild_id):
    """
    Get historical weekly analytics snapshots for a guild.

    Returns:
        JSON list of up to 52 snapshots with:
            - Core activity metrics.
            - Trends and member counts.
            - Snapshot and generation timestamps.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Unauthorized"}), 403

    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "Database error"}), 500

    conn = None
    try:
        conn = pool.getconn()
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT 
                id, snapshot_date, week_number, year,
                health_score, total_members, active_members,
                messages_count, new_members_count,
                message_trend, member_trend,
                generated_at
            FROM public.analytics_snapshots
            WHERE guild_id = %s
            ORDER BY snapshot_date DESC
            LIMIT 52
        """,
            (guild_id,),
        )

        snapshots = cursor.fetchall()

        return jsonify(
            {
                "snapshots": [
                    {
                        "id": s[0],
                        "snapshot_date": s[1].isoformat(),
                        "week_number": s[2],
                        "year": s[3],
                        "health_score": s[4],
                        "total_members": s[5],
                        "active_members": s[6],
                        "messages_count": s[7],
                        "new_members_count": s[8],
                        "message_trend": s[9],
                        "member_trend": s[10],
                        "generated_at": s[11].isoformat(),
                    }
                    for s in snapshots
                ]
            }
        )

    except Exception as e:
        log.error(f"Error fetching analytics history for {guild_id}: {e}")
        return jsonify({"error": "Failed to fetch history"}), 500
    finally:
        if conn and pool:
            cursor.close()
            pool.putconn(conn)


@app.route("/analytics/guide/<guild_id>")
@login_required
def analytics_guide(guild_id):
    """
    Render the analytics guide page for a guild.

    The guide explains:
        - How analytics are calculated.
        - How to interpret metrics and charts.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Unauthorized"}), 403
    return render_template("Tabs/SubTabsAnalytics/config_analytics_guide.html", guild_id=guild_id)


@app.route("/api/analytics/<guild_id>/snapshot/<int:snapshot_id>")
@login_required
def get_snapshot_detail(guild_id, snapshot_id):
    """
    Get full details for a specific analytics snapshot.

    Returns:
        JSON with:
            - Health score and core metrics.
            - Engagement tiers breakdown.
            - Leveling and XP distribution.
            - Activity heatmap and peak times.
            - Trends, contributors, insights, timezone info.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Unauthorized"}), 403

    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "Database error"}), 500

    conn = None
    try:
        conn = pool.getconn()
        cursor = conn.cursor()

        cursor.execute(
            """
            SELECT 
                id, guild_id, snapshot_date, week_number, year,
                health_score, total_members, active_members,
                messages_count, new_members_count,
                elite_count, active_count, casual_count, inactive_count,
                total_xp_earned, avg_level, max_level,
                level_distribution, activity_heatmap,
                peak_hour, peak_day,
                message_trend, member_trend,
                top_contributors, insights,
                generated_at, timezone
            FROM public.analytics_snapshots
            WHERE id = %s AND guild_id = %s
        """,
            (snapshot_id, guild_id),
        )

        snapshot = cursor.fetchone()

        if not snapshot:
            return jsonify({"error": "Snapshot not found"}), 404

        return jsonify(
            {
                "id": snapshot[0],
                "guild_id": snapshot[1],
                "snapshot_date": snapshot[2].isoformat(),
                "week_number": snapshot[3],
                "year": snapshot[4],
                "health_score": snapshot[5],
                "total_members": snapshot[6],
                "active_members": snapshot[7],
                "messages_count": snapshot[8],
                "new_members_count": snapshot[9],
                "engagement_tiers": {
                    "elite": {"count": snapshot[10]},
                    "active": {"count": snapshot[11]},
                    "casual": {"count": snapshot[12]},
                    "inactive": {"count": snapshot[13]},
                },
                "leveling": {
                    "total_xp_earned": snapshot[14],
                    "avg_level": float(snapshot[15]),
                    "max_level": snapshot[16],
                    "level_distribution": snapshot[17],
                },
                "activity_heatmap": snapshot[18],
                "peak_hour": snapshot[19],
                "peak_day": snapshot[20],
                "message_trend": snapshot[21],
                "member_trend": snapshot[22],
                "top_contributors": snapshot[23],
                "insights": snapshot[24],
                "generated_at": snapshot[25].isoformat(),
                "timezone": snapshot[26],
            }
        )

    except Exception as e:
        log.error(f"Error fetching snapshot {snapshot_id}: {e}")
        return jsonify({"error": "Failed to fetch snapshot"}), 500
    finally:
        if conn and pool:
            cursor.close()
            pool.putconn(conn)


@app.route("/api/analytics/<guild_id>/settings", methods=["GET", "POST"])
@login_required
def analytics_settings(guild_id):
    """
    Get or update analytics configuration for a guild.

    GET:
        - Returns analytics and weekly report configuration.

    POST:
        - Validates and updates/inserts analytics-related settings.
        - Logs dashboard activity and increments command counter.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Unauthorized"}), 403

    pool = init_db_pool()
    if not pool:
        return jsonify({"error": "Database error"}), 500

    conn = None
    try:
        conn = pool.getconn()
        cursor = conn.cursor()

        if request.method == "GET":
            cursor.execute(
                """
                SELECT 
                    analytics_timezone,
                    weekly_reset_timezone,
                    weekly_report_enabled,
                    weekly_report_day,
                    weekly_report_hour
                FROM public.guild_settings
                WHERE guild_id = %s
            """,
                (guild_id,),
            )

            settings = cursor.fetchone()

            if not settings:
                return jsonify(
                    {
                        "analytics_timezone": "UTC",
                        "weekly_reset_timezone": "UTC",
                        "weekly_report_enabled": True,
                        "weekly_report_day": 0,
                        "weekly_report_hour": 9,
                    }
                )

            return jsonify(
                {
                    "analytics_timezone": settings[0] or "UTC",
                    "weekly_reset_timezone": settings[1] or "UTC",
                    "weekly_report_enabled": (
                        settings[2] if settings[2] is not None else True
                    ),
                    "weekly_report_day": settings[3] if settings[3] is not None else 0,
                    "weekly_report_hour": settings[4] if settings[4] is not None else 9,
                }
            )

        # POST: update settings
        data = request.get_json()

        # Basic guild_id validation
        if not guild_id or guild_id == "None":
            log.error(f"Analytics Settings Update Error: Invalid guild_id: {guild_id}")
            return jsonify({"error": "Invalid server ID"}), 400

        # Timezone validation
        try:
            pytz.timezone(data.get("analytics_timezone", "UTC"))
            pytz.timezone(data.get("weekly_reset_timezone", "UTC"))
        except Exception:
            return jsonify({"error": "Invalid timezone"}), 400

        # Day/hour validation
        day = data.get("weekly_report_day", 0)
        hour = data.get("weekly_report_hour", 9)

        if not (0 <= day <= 6):
            return jsonify({"error": "Invalid day (must be 0-6)"}), 400
        if not (0 <= hour <= 23):
            return jsonify({"error": "Invalid hour (must be 0-23)"}), 400

        log.info(f"Updating analytics settings for guild_id: {guild_id}")
        log.info(
            f"Data: analytics_tz={data.get('analytics_timezone')}, "
            f"reset_tz={data.get('weekly_reset_timezone')}, "
            f"report_enabled={data.get('weekly_report_enabled')}"
        )

        # Check if a row exists for this guild
        cursor.execute(
            """
            SELECT 1 FROM public.guild_settings WHERE guild_id = %s
        """,
            (guild_id,),
        )

        exists = cursor.fetchone() is not None

        if exists:
            # Update existing settings for this guild
            log.info(f"Updating existing row for guild_id: {guild_id}")
            cursor.execute(
                """
                UPDATE public.guild_settings 
                SET analytics_timezone = %s,
                    weekly_reset_timezone = %s,
                    weekly_report_enabled = %s,
                    weekly_report_day = %s,
                    weekly_report_hour = %s
                WHERE guild_id = %s
            """,
                (
                    data.get("analytics_timezone", "UTC"),
                    data.get("weekly_reset_timezone", "UTC"),
                    data.get("weekly_report_enabled", True),
                    day,
                    hour,
                    guild_id,
                ),
            )
        else:
            # Insert new row
            log.info(f"Inserting new row for guild_id: {guild_id}")
            cursor.execute(
                """
                INSERT INTO public.guild_settings 
                (guild_id, analytics_timezone, weekly_reset_timezone, weekly_report_enabled, weekly_report_day, weekly_report_hour)
                VALUES (%s, %s, %s, %s, %s, %s)
            """,
                (
                    guild_id,
                    data.get("analytics_timezone", "UTC"),
                    data.get("weekly_reset_timezone", "UTC"),
                    data.get("weekly_report_enabled", True),
                    day,
                    hour,
                ),
            )

        conn.commit()

        log_dashboard_activity(
            guild_id,
            "analytics_settings_update",
            "Updated analytics settings",
        )

        increment_command_counter()

        return jsonify({"success": True})

    except Exception as e:
        log.error(f"Error managing analytics settings for {guild_id}: {e}")
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        return jsonify({"error": "Failed to manage settings"}), 500
    finally:
        if conn and pool:
            try:
                cursor.close()
                pool.putconn(conn)
            except Exception:
                pass


# ==================== RUNNER ====================


def check_and_migrate_schema():
    """
    Perform minimal schema migrations required by the dashboard.

    - Drops obsolete constraint on reminders.interval (if present).
    - Ensures users.weekly_xp column exists.
    """
    pool = init_db_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                ALTER TABLE public.reminders 
                DROP CONSTRAINT IF EXISTS valid_interval;
            """
            )

            cur.execute(
                """
                ALTER TABLE public.users 
                ADD COLUMN IF NOT EXISTS weekly_xp INTEGER DEFAULT 0;
            """
            )

            conn.commit()
            log.info("✅ Schema migration: DB checks complete (weekly_xp added).")
    except Exception as e:
        log.error(f"Schema Migration Warning: {e}")
        conn.rollback()
    finally:
        pool.putconn(conn)


def run_flask_app():
    """
    Initialize and start the Flask application.

    - Reads host/port/debug from environment.
    - Initializes DB pool and runs schema checks.
    - Starts Flask with reloader disabled.
    """
    host = os.getenv("FLASK_HOST", "0.0.0.0")
    port = int(os.getenv("FLASK_PORT", 9528))
    debug = os.getenv("FLASK_DEBUG", "true").lower() == "true"

    log.info(f"🌐 Flask Server starting on {host}:{port}")
    init_db_pool()
    check_and_migrate_schema()
    app.run(host=host, port=port, debug=debug, use_reloader=False)


if __name__ == "__main__":
    run_flask_app()
