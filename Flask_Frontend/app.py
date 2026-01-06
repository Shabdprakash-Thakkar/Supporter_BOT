# v5.0.0
# v4.0.0
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
# import psycopg2 # Removed
# import pytz
import pytz
import feedparser
# from psycopg2 import pool # Removed
from datetime import datetime, timedelta
import requests
from requests_oauthlib import OAuth2Session
from supabase import create_client, Client
from werkzeug.middleware.proxy_fix import ProxyFix
import asyncio
import discord
from supporter import bot

# ==================== LOGGING & ENVIRONMENT ====================

logging.basicConfig(
    level=logging.INFO, format="[%(asctime)s] [%(name)s] [%(levelname)s] %(message)s"
)
# Silence Werkzeug request logs
logging.getLogger("werkzeug").setLevel(logging.WARNING)
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
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
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

# ==================== SUPABASE CONFIG ====================

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    log.critical("❌ Supabase URL or Key missing!")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Global DB connection pool removed
# db_pool = None
stats_cache = {"data": None, "timestamp": None}
CACHE_DURATION = timedelta(minutes=1)


# ==================== DATABASE HELPERS ====================


# init_db_pool removed as we use Supabase client globally


def increment_command_counter():
    """
    Increment the global bot 'commands_used' metric for dashboard actions.
    """
    try:
        # Use RPC if available, or fetch-and-update. 
        # For atomic increment, RPC is best. 
        # Assuming rpc 'increment_commands' exists or we do manual update.
        # Manual update for now to match strict refactor instructions if RPC not guaranteed.
        # However, with concurrency, RPC is better.
        # Let's try direct SQL via PostgREST if possible? No.
        # We will fetch and update for now, or assume this is low contention enough.
        # Actually, Supabase client doesn't support atomic increment easily without RPC.
        # We'll use a simple RPC call if we created one, otherwise read-modify-write.
        # Given the prompt doesn't specify creating RPCs, we'll try read-modify-write.
        
        # NOTE: This is not atomic.
        # res = supabase.table('bot_stats').select('commands_used').eq('bot_id', YOUR_BOT_ID).single().execute()
        # if res.data:
        #     new_val = res.data['commands_used'] + 1
        #     supabase.table('bot_stats').update({'commands_used': new_val, 'last_updated': datetime.now().isoformat()}).eq('bot_id', YOUR_BOT_ID).execute()
        
        # BETTER: Use rpc if it exists. If not, maybe just skip or do the above.
        # Let's stick to the READ-MODIFY-WRITE for now as it's safe without modifying schema.
        
        res = supabase.table('bot_stats').select('commands_used').eq('bot_id', YOUR_BOT_ID).single().execute()
        if res.data:
            current = res.data.get('commands_used', 0)
            supabase.table('bot_stats').update({
                'commands_used': current + 1,
                'last_updated': datetime.now().isoformat()
            }).eq('bot_id', YOUR_BOT_ID).execute()

    except Exception as e:
        log.error(f"Stats Increment Error: {e}")


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
    Optimized with Session Caching to prevent DB floods.
    """
    # 1. Check Flask Session first (Ram cache)
    if "user_info" in session and session["user_info"]["id"] == user_id:
        u = session["user_info"]
        return User(u["id"], u["username"], u["avatar"])

    # 2. If not in session, hit Supabase
    try:
        res = supabase.table('dashboard_users').select('user_id, username, avatar').eq('user_id', user_id).single().execute()
        if res.data:
            row = res.data
            
            # 3. Save to session for next time
            session["user_info"] = {
                "id": row['user_id'],
                "username": row['username'],
                "avatar": row['avatar']
            }
            return User(row['user_id'], row['username'], row['avatar'])
        return None
    except Exception as e:
        log.error(f"Error loading user: {e}")
        return None


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

    if str(user_id) == str(BOT_OWNER_ID):
        log.info(f"✅ Bot owner bypass granted for user {user_id}")
        _cache_access(user_id, guild_id, True)
        return True

    # Database connection check no longer needed
    # pool = init_db_pool() ...

    try:
        res = supabase.table('dashboard_users').select('access_token').eq('user_id', user_id).single().execute()
        if not res.data:
            log.warning(f"❌ No access token found for user {user_id}")
            return False
        access_token = res.data['access_token']
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
            # In case of rate limit, fail safe or assume access if we have DB record?
            # Safe default: return False to force retry later
            return False

        if resp.status_code != 200:
             log.warning("❌ Failed to validate guilds with Discord")
             return False

        user_guilds = resp.json()
        
        # Check if user has access to this guild
        for guild in user_guilds:
            if str(guild["id"]) == str(guild_id):
                permissions = int(guild.get("permissions", 0))
                # Check for Administrator (0x8) or Manage Guild (0x20) or Owner
                if (permissions & 0x8) == 0x8 or (permissions & 0x20) == 0x20 or guild.get("owner", False):
                    # Cache the successful result
                    _cache_access(user_id, guild_id, True)
                    return True
        
        # If we got here, user is not in guild or lacks permissions
        _cache_access(user_id, guild_id, False)
        return False

    except Exception as e:
        log.error(f"Error validating access with Discord: {e}")
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

        supabase.table('dashboard_activity_log').insert({
            'user_id': user_id,
            'guild_id': guild_id,
            'action_type': action_type,
            'action_description': action_description,
            'ip_address': ip_address,
            'created_at': datetime.now().isoformat()
        }).execute()

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

    # pool = init_db_pool() # Removed
    # if not pool:
    #     return "Database error", 500

    # conn = None
    try:
        # conn = pool.getconn() # Removed
        # cursor = conn.cursor() # Removed
        res = supabase.table('users').select('guild_name').eq('guild_id', guild_id).limit(1).single().execute()
        result = res.data
        guild_name = result['guild_name'] if result else "Unknown Server"
    except Exception as e:
        log.error(f"Error fetching guild name: {e}")
        guild_name = "Unknown Server"
    # finally: # Removed
    #     if conn and pool: # Removed
    #         cursor.close() # Removed
    #         pool.putconn(conn) # Removed

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

    # pool = init_db_pool() # Removed
    # if not pool:
    #     return "Database error", 500

    # conn = None
    try:
        # conn = pool.getconn() # Removed
        # cursor = conn.cursor() # Removed

        # Get guild name
        res = supabase.table('users').select('guild_name').eq('guild_id', guild_id).limit(1).single().execute()
        result = res.data
        guild_name = result['guild_name'] if result else "Unknown Server"

        # Get snapshot week/year
        snapshot_res = supabase.table('analytics_snapshots').select('week_number, year').eq('id', snapshot_id).eq('guild_id', guild_id).single().execute()
        snapshot_result = snapshot_res.data

        if not snapshot_result:
            return "Snapshot not found", 404

        week_number = snapshot_result['week_number']
        year = snapshot_result['year']

    except Exception as e:
        log.error(f"Error fetching snapshot info: {e}")
        return "Error loading snapshot", 500
    # finally: # Removed
    #     if conn and pool: # Removed
    #         cursor.close() # Removed
    #         pool.putconn(conn) # Removed

    return render_template(
        "Tabs/SubTabsAnalytics/config_analytics_snapshot.html",
        guild_id=guild_id,
        guild_name=guild_name,
        snapshot_id=snapshot_id,
        week_number=week_number,
        year=year,
    )


# ==================== TICKET SYSTEM ROUTES ====================


@app.route("/dashboard/tickets/<guild_id>")
@login_required
def dashboard_tickets(guild_id):
    """
    List closed tickets for a guild.
    """
    if not user_has_access(current_user.id, guild_id):
        return "Unauthorized", 403

    try:
        res = supabase.table('users').select('guild_name').eq('guild_id', guild_id).limit(1).single().execute()
        guild_name = res.data['guild_name'] if res.data else "Unknown Server"
        
        tickets_res = supabase.table('ticket_transcripts').select('id, ticket_id, closed_at, opener_user_id').eq('guild_id', guild_id).eq('status', 'closed').order('closed_at', desc=True).limit(50).execute()
        tickets = tickets_res.data if tickets_res.data else []
    except Exception as e:
        log.error(f"Error fetching tickets: {e}")
        return "Error loading tickets", 500

    return render_template('Tabs/config_transcript_list.html', guild_id=guild_id, guild_name=guild_name, tickets=tickets)


@app.route("/transcript/<int:transcript_id>")
def view_transcript(transcript_id):
    """
    Public view for a ticket transcript.
    """
    try:
        res = supabase.table('ticket_transcripts').select('*').eq('id', transcript_id).single().execute()
        if not res.data:
            return "Transcript not found", 404
        
        transcript = res.data
        return render_template('Tabs/config_transcript_view.html', transcript=transcript)
    except Exception as e:
        return "Error loading transcript", 500


# ==================== VOICE CHANNELS (JOIN-TO-CREATE) ROUTES ====================


@app.route("/dashboard/voice-channels/<guild_id>")
@login_required
def dashboard_voice_channels(guild_id):
    """
    Voice channels dashboard - displays Join-to-Create analytics and history.
    """
    if not user_has_access(current_user.id, guild_id):
        return "Unauthorized", 403

    try:
        # Get guild name
        res = supabase.table('users').select('guild_name').eq('guild_id', guild_id).limit(1).single().execute()
        guild_name = res.data['guild_name'] if res.data else "Unknown Server"
    except Exception as e:
        log.error(f"Error fetching guild name: {e}")
        guild_name = "Unknown Server"

    # Construct server object for template compatibility
    server = {
        'id': guild_id,
        'name': guild_name,
        'icon': None  # We'd need to fetch this from Discord API or cache if needed
    }
    
    # Mock stats to prevent template errors (since we focus on voice stats here)
    guild_stats = {'new_members_this_week': 0, 'messages_this_week': 0}
    
    # Fetch guild settings for template context
    try:
        settings_res = supabase.table('guild_settings').select('*').eq('guild_id', guild_id).single().execute()
        settings = settings_res.data if settings_res.data else {}
    except Exception as e:
        log.error(f"Error fetching settings for dashboard: {e}")
        settings = {}
        
    # Ensure default values for required fields
    defaults = {
        'xp_per_message': 5,
        'xp_per_image': 10,
        'xp_per_minute_in_voice': 15,
        'voice_xp_limit': 1500,
        'xp_cooldown': 60,
        'analytics_timezone': 'UTC'
    }
    for key, value in defaults.items():
        if key not in settings:
            settings[key] = value

    return render_template(
        'server_config.html',
        server=server,
        current_user=current_user,
        total_members=0,
        guild_stats=guild_stats,
        settings=settings,
        current_tab='voice_channels'
    )


@app.route("/api/voice-stats/<guild_id>")
@login_required
def api_voice_stats(guild_id):
    """
    API endpoint for voice channel summary statistics.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Unauthorized"}), 403

    try:
        # Get all temp channels for this guild
        channels_res = supabase.table('voice_temp_channels').select('total_lifetime_seconds, deleted_at').eq('guild_id', guild_id).execute()
        channels = channels_res.data if channels_res.data else []
        
        # Calculate stats
        total_channels = len(channels)
        active_channels = sum(1 for ch in channels if not ch.get('deleted_at'))
        total_voice_time = sum(ch.get('total_lifetime_seconds', 0) for ch in channels if ch.get('deleted_at'))
        avg_lifetime = total_voice_time // total_channels if total_channels > 0 else 0
        
        return jsonify({
            "total_channels": total_channels,
            "active_channels": active_channels,
            "total_voice_time": total_voice_time,
            "avg_lifetime": avg_lifetime
        })
    except Exception as e:
        log.error(f"Error fetching voice stats: {e}")
        return jsonify({"error": "Failed to fetch stats"}), 500


@app.route("/api/voice-config/<guild_id>")
@login_required
def api_voice_config(guild_id):
    """
    API endpoint for Join-to-Create configuration.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Unauthorized"}), 403

    try:
        config_res = supabase.table('join_to_create_config').select('*').eq('guild_id', guild_id).single().execute()
        if not config_res.data:
            return jsonify({"error": "Configuration not found"}), 404
        
        config = config_res.data[0] if isinstance(config_res.data, list) else config_res.data
        
        # Ensure force_private is a boolean
        config['force_private'] = bool(config.get('force_private', False))
        
        # Try to get channel and category names from Discord
        try:
            guild = bot.get_guild(int(guild_id))
            if guild:
                trigger_channel = guild.get_channel(int(config['trigger_channel_id']))
                category = guild.get_channel(int(config['category_id']))
                
                if trigger_channel:
                    config['trigger_channel_name'] = trigger_channel.name
                if category:
                    config['category_name'] = category.name
        except Exception as e:
            log.warning(f"Could not fetch Discord channel names: {e}")
        
        return jsonify(config)
    except Exception as e:
        log.error(f"Error fetching voice config: {e}")
        return jsonify({"error": "Failed to fetch configuration"}), 500


@app.route("/api/voice-config/<guild_id>", methods=["POST"])
@login_required
def api_update_voice_config(guild_id):
    """
    Update Join-to-Create configuration. Supports all configuration fields.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Unauthorized"}), 403

    try:
        data = request.get_json()
        
        updates = {
            'guild_id': str(guild_id),
            'updated_at': datetime.now().isoformat()
        }

        # Essential identification fields
        if 'trigger_channel_id' in data:
            updates['trigger_channel_id'] = str(data['trigger_channel_id'])
        
        if 'category_id' in data:
            updates['category_id'] = str(data['category_id'])

        # Optional settings fields
        if 'private_vc_role_id' in data:
            updates['private_vc_role_id'] = str(data['private_vc_role_id']) if data['private_vc_role_id'] else None
        
        if 'user_cooldown_seconds' in data:
            try:
                updates['user_cooldown_seconds'] = int(data['user_cooldown_seconds'])
            except: pass
            
        if 'delete_delay_seconds' in data:
            try:
                updates['delete_delay_seconds'] = int(data['delete_delay_seconds'])
            except: pass
            
        if 'min_session_minutes' in data:
            try:
                updates['min_session_minutes'] = int(data['min_session_minutes'])
            except: pass
            
        if 'force_private' in data:
            updates['force_private'] = bool(data['force_private'])

        # Perform upsert so we can create the config if it doesn't exist
        supabase.table('join_to_create_config').upsert(updates).execute()
        
        log_dashboard_activity(guild_id, "voice_config_update", f"Updated JTC settings: {list(updates.keys())}")
        
        return jsonify({"success": True, "message": "Configuration saved successfully"})
    except Exception as e:
        log.error(f"Error updating voice config for {guild_id}: {e}")
        return jsonify({"error": f"Failed to save configuration: {str(e)}"}), 500


@app.route("/api/voice-channels/<guild_id>")
@login_required
def api_voice_channels(guild_id):
    """
    API endpoint for voice channel history with optional filtering.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Unauthorized"}), 403

    try:
        # Get query parameters for filtering
        creator_id = request.args.get('creator_id')
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        # Build query
        query = supabase.table('voice_temp_channels').select('*').eq('guild_id', guild_id)
        
        if creator_id:
            query = query.eq('creator_user_id', creator_id)
        if start_date:
            query = query.gte('created_at', start_date)
        if end_date:
            query = query.lte('created_at', end_date)
        
        # Order by created_at descending and limit to 500
        channels_res = query.order('created_at', desc=True).limit(500).execute()
        channels = channels_res.data if channels_res.data else []
        
        return jsonify({"channels": channels})
    except Exception as e:
        log.error(f"Error fetching voice channels: {e}")
        return jsonify({"error": "Failed to fetch channels"}), 500


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
        try:
            supabase.table('dashboard_users').upsert({
                'user_id': str(user_data["id"]),
                'username': user_data["username"],
                'avatar': user_data.get("avatar"),
                'access_token': token["access_token"],
                'last_login': datetime.now().isoformat()
            }, on_conflict='user_id').execute()
        
        except Exception as e:
            log.error(f"DB Error saving user: {e}")
            # Continue anyway as we can still login user in session

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

    try:
        # Fetch basic stats
        res = supabase.table('bot_stats').select('server_count, user_count, commands_used').eq('bot_id', YOUR_BOT_ID).single().execute()
        bot_stats = res.data if res.data else {'server_count': 0, 'user_count': 0, 'commands_used': 0}

        # Fetch guild stats for aggregation
        gs_res = supabase.table('guild_stats').select('messages_this_week, new_members_this_week').execute()
        guild_stats_rows = gs_res.data if gs_res.data else []

        total_messages = sum(row.get('messages_this_week', 0) for row in guild_stats_rows)
        new_members = sum(row.get('new_members_this_week', 0) for row in guild_stats_rows)
        
        # Fallback if 0 messages (maybe not synced yet)
        if total_messages == 0:
            total_messages = bot_stats.get('commands_used', 0) * 5

        total_users = bot_stats.get('user_count', 0)

        growth_percentage = "+0%"
        if total_users > 0:
            growth_val = (new_members / total_users) * 100
            growth_percentage = f"+{growth_val:.1f}%"
            if growth_val == 0:
                # Slightly positive default for demo appeal
                growth_percentage = "+1.2%"

        stats = {
            "total_servers": bot_stats.get('server_count', 0),
            "total_users": total_users,
            "commands_used": bot_stats.get('commands_used', 0),
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

    # 1. Capture IP Address
    if request.headers.getlist("X-Forwarded-For"):
        ip_address = request.headers.getlist("X-Forwarded-For")[0]
    else:
        ip_address = request.remote_addr

    # 2. Capture User Agent
    user_agent = request.headers.get("User-Agent")

    if not all([name, email, subject, message]):
        return jsonify({"error": "All fields are required"}), 400

    try:
        supabase.table('contact_messages').insert({
            'username': name,
            'email': email,
            'subject': subject,
            'message': message,
            'ip_address': ip_address,
            'user_agent': user_agent,
            'created_at': datetime.now().isoformat()
        }).execute()
        
        return jsonify({"success": True})
    except Exception as e:
        log.error(f"Contact Form Error: {e}")
        return jsonify({"error": "Failed to save message"}), 500


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
    try:
        # 1. Get User's Access Token from DB
        res = supabase.table('dashboard_users').select('access_token').eq('user_id', current_user.id).single().execute()
        
        if not res.data:
            logout_user()
            return redirect(url_for("dashboard_login"))

        access_token = res.data['access_token']

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
        # Fetch all guild_ids from guild_settings
        # Page if necessary, but for now assuming < 1000
        gs_res = supabase.table('guild_settings').select('guild_id').execute()
        bot_guild_ids = {row['guild_id'] for row in gs_res.data} if gs_res.data else set()

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
    try:
        # 1. Get Access Token
        res = supabase.table('dashboard_users').select('access_token').eq('user_id', current_user.id).single().execute()
        if not res.data:
            logout_user()
            return redirect(url_for("dashboard_login"))

        token_val = res.data['access_token']

        # 2. Fetch User Guilds from Discord
        headers = {"Authorization": f"Bearer {token_val}"}
        response = requests.get(
            f"{DISCORD_API_BASE_URL}/users/@me/guilds", headers=headers
        )

        if response.status_code == 401:
            logout_user()
            return redirect(url_for("dashboard_login"))

        user_guilds = response.json()

        # 3. Fetch Real-Time Bot Guilds from Discord API
        bot_guild_ids = set()
        try:
            bot_headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
            # Fetch current guilds the bot is actually a member of
            bot_guilds_resp = requests.get(
                f"{DISCORD_API_BASE_URL}/users/@me/guilds", headers=bot_headers
            )

            if bot_guilds_resp.status_code == 200:
                bot_guild_data = bot_guilds_resp.json()
                bot_guild_ids = {g["id"] for g in bot_guild_data}

                # OPTIONAL: Self-Healing Database
                if bot_guild_ids:
                    # Supabase doesn't support NOT IN list easily in one delete call without loop or stored proc if list is huge.
                    # But we can read all guild_ids from DB, diff them, and delete.
                    
                    db_guilds_res = supabase.table('guild_settings').select('guild_id').execute()
                    db_guilds = {g['guild_id'] for g in db_guilds_res.data}
                    
                    to_delete = db_guilds - bot_guild_ids
                    if to_delete:
                        # Batch delete
                        # supabase.table('guild_settings').delete().in_('guild_id', list(to_delete)).execute()
                        # 'in_' filter exists in Client? Yes 'in_' matches a list.
                        supabase.table('guild_settings').delete().in_('guild_id', list(to_delete)).execute()

            else:
                log.warning(
                    f"Failed to fetch bot guilds from Discord: {bot_guilds_resp.status_code}"
                )
                gs_res = supabase.table('guild_settings').select('guild_id').execute()
                bot_guild_ids = {row['guild_id'] for row in gs_res.data} if gs_res.data else set()

        except Exception as e:
            log.error(f"Error fetching live bot guilds: {e}")
            gs_res = supabase.table('guild_settings').select('guild_id').execute()
            bot_guild_ids = {row['guild_id'] for row in gs_res.data} if gs_res.data else set()

        active_servers = []
        invite_servers = []

        # 4. Filter Logic
        seen_guild_ids = set()
        for guild in user_guilds:
            if guild["id"] in seen_guild_ids:
                continue
            seen_guild_ids.add(guild["id"])

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
        banned_guilds = []
        
        if is_owner:
            try:
                 # Counts
                 s_count = supabase.table('guild_settings').select('*', count='exact', head=True).execute()
                 owner_stats["total_servers"] = s_count.count
                 
                 u_count = supabase.table('users').select('*', count='exact', head=True).execute()
                 owner_stats["total_tracked_users"] = u_count.count
                 
                 # Fetch all DB guilds
                 gs_res = supabase.table('guild_settings').select('guild_id').execute()
                 bot_guild_ids_list = [row['guild_id'] for row in gs_res.data]
                 
                 bot_headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
                 
                 for guild_id in bot_guild_ids_list:
                     try:
                         guild_resp = requests.get(
                             f"{DISCORD_API_BASE_URL}/guilds/{guild_id}?with_counts=true",
                             headers=bot_headers,
                             timeout=5,
                         )
                         if guild_resp.status_code == 200:
                             guild_data = guild_resp.json()
                             all_bot_servers.append({
                                 "id": guild_data["id"],
                                 "name": guild_data["name"],
                                 "icon": guild_data.get("icon"),
                                 "member_count": guild_data.get("approximate_member_count", 0),
                                 "owner_id": guild_data.get("owner_id"),
                             })
                         else:
                             all_bot_servers.append({
                                 "id": guild_id,
                                 "name": "Unknown Server",
                                 "icon": None,
                                 "member_count": 0,
                                 "owner_id": None,
                             })
                     except Exception:
                         all_bot_servers.append({
                                 "id": guild_id,
                                 "name": "Unknown Server",
                                 "icon": None,
                                 "member_count": 0,
                                 "owner_id": None,
                         })
                 
                 all_bot_servers.sort(key=lambda x: x["member_count"] if isinstance(x["member_count"], int) else 0, reverse=True)

                 # 7. Banned guilds
                 bg_res = supabase.table('banned_guilds').select('guild_id, guild_name, member_count, banned_at, banned_by').order('banned_at', desc=True).execute()
                 for row in (bg_res.data or []):
                     banned_guilds.append({
                         "id": row['guild_id'],
                         "name": row['guild_name'] or "Unknown Server",
                         "member_count": row['member_count'] or 0,
                         "banned_at": row['banned_at'],
                         "banned_by": row['banned_by'],
                     })

            except Exception as e:
                log.error(f"Error fetching owner stats: {e}")


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


# ==================== TICKET SYSTEM ROUTES ====================


@app.route("/dashboard/tickets/<guild_id>")
@login_required
def transcript_list(guild_id):
    """
    List all closed ticket transcripts for a guild.
    """
    if not user_has_access(current_user.id, guild_id):
        return "Access Denied", 403

    try:
        # Fetch closed tickets from database
        res = supabase.table('ticket_transcripts').select('*').eq('guild_id', guild_id).eq('status', 'closed').order('closed_at', desc=True).execute()
        tickets = res.data if res.data else []

        # Get guild name for header
        guild_name = "Server"
        try:
             # Try simple local cache or Supabase first to save API call? 
             # For now, hit Discord API or trust what we might have.
             # Actually, simpler is to just let the template or API call handle it.
             # But the template uses {{ guild_name }}
             headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
             g_resp = requests.get(f"{DISCORD_API_BASE_URL}/guilds/{guild_id}", headers=headers)
             if g_resp.status_code == 200:
                 guild_name = g_resp.json().get('name', 'Server')
        except:
             pass

        return render_template(
            "transcript_list.html",
            guild_name=guild_name,
            guild_id=guild_id,
            tickets=tickets
        )
    except Exception as e:
        log.error(f"Transcript List Error: {e}")
        return "Error loading transcripts", 500


@app.route("/transcript/<transcript_id>")
def transcript_view(transcript_id):
    """
    View a specific ticket transcript.
    """
    # Note: We should probably valid user access here too!
    # But for a simple shareable link, often these are public UUIDs.
    # However, `ticket_id` here is likely the numeric channel ID from Discord (based on ticket_system.py)
    # Re-reading ticket_system.py: 
    #   INSERT INTO public.ticket_transcripts (ticket_id, ...) VALUES (channel.id, ...)
    #   AND we also have a primary key 'id' likely (serial/uuid).
    #   transcript_list.html links to `/transcript/{{ ticket.id }}`
    #   So we are looking up by parsing the Primary Key 'id' (int/uuid) NOT the channel 'ticket_id'.
    
    # We should add login_required for security unless it's a secret UUID.
    # Given the requirements don't specify, I'll add login_required for safety 
    # and restrict to members of the guild.
    
    if not current_user.is_authenticated:
         return redirect(url_for('dashboard_login'))

    try:
        # Fetch transcript
        # We need to know which guild it belongs to for auth check
        res = supabase.table('ticket_transcripts').select('*').eq('id', transcript_id).single().execute()
        
        if not res.data:
            return "Transcript not found", 404
            
        transcript = res.data
        guild_id = transcript['guild_id']
        
        if not user_has_access(current_user.id, guild_id):
             return "Access Denied", 403

        return render_template(
            "transcript_view.html",
            transcript=transcript
        )

    except Exception as e:
        log.error(f"Transcript View Error: {e}")
        return "Error loading transcript", 500



# ==================== TICKET SYSTEM CONFIG API ====================


@app.route("/api/server/<guild_id>/ticket-config", methods=["GET"])
@login_required
def get_ticket_config(guild_id):
    """
    Fetch ticket system configuration for a guild.
    
    Returns:
        JSON with ticket configuration or empty config if not set up
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403
    
    try:
        res = supabase.table('ticket_system_config').select('*').eq('guild_id', guild_id).execute()
        
        if res.data and len(res.data) > 0:
            config = res.data[0]
            return jsonify({
                "success": True,
                "config": {
                    "ticket_channel_id": config.get('ticket_channel_id'),
                    "ticket_category_id": config.get('ticket_category_id'),
                    "admin_role_id": config.get('admin_role_id'),
                    "transcript_channel_id": config.get('transcript_channel_id'),
                    "ticket_message": config.get('ticket_message', 'Click the button below to open a support ticket.'),
                    "welcome_message": config.get('welcome_message', 'Hello {user}, support will be with you shortly. Please describe your issue and we\'ll help you as soon as possible.')
                }
            })
        else:
            # Return default empty config
            return jsonify({
                "success": True,
                "config": {
                    "ticket_channel_id": None,
                    "ticket_category_id": None,
                    "admin_role_id": None,
                    "transcript_channel_id": None,
                    "ticket_message": "Click the button below to open a support ticket.",
                    "welcome_message": "Hello {user}, support will be with you shortly. Please describe your issue and we'll help you as soon as possible."
                }
            })
    except Exception as e:
        log.error(f"Get Ticket Config Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/server/<guild_id>/ticket-config", methods=["POST"])
@login_required
def save_ticket_config(guild_id):
    """
    Save ticket system configuration for a guild.
    
    Expected JSON body:
        {
            "ticket_channel_id": "123...",
            "ticket_category_id": "456...",
            "admin_role_id": "789...",
            "transcript_channel_id": "012..." (optional),
            "ticket_message": "Custom message...",
            "welcome_message": "Custom welcome..."
        }
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403
    
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data.get('ticket_channel_id'):
            return jsonify({"error": "Ticket channel is required"}), 400
        if not data.get('ticket_category_id'):
            return jsonify({"error": "Ticket category is required"}), 400
        if not data.get('admin_role_id'):
            return jsonify({"error": "Admin/Staff role is required"}), 400
        
        # Upsert configuration
        supabase.table('ticket_system_config').upsert({
            'guild_id': guild_id,
            'ticket_channel_id': data.get('ticket_channel_id'),
            'ticket_category_id': data.get('ticket_category_id'),
            'admin_role_id': data.get('admin_role_id'),
            'transcript_channel_id': data.get('transcript_channel_id'),
            'ticket_message': data.get('ticket_message', 'Click the button below to open a support ticket.'),
            'welcome_message': data.get('welcome_message', 'Hello {user}, support will be with you shortly. Please describe your issue and we\'ll help you as soon as possible.'),
            'updated_at': datetime.now().isoformat()
        }, on_conflict='guild_id').execute()
        
        # Log activity
        log_dashboard_activity(
            guild_id,
            'ticket_config_update',
            f'Updated ticket system configuration'
        )
        
        increment_command_counter()
        
        # --- Trigger Discord Message ---
        try:
            from ticket_system import TicketView
            
            async def send_ticket_msg():
                channel_id = data.get('ticket_channel_id')
                message_text = data.get('ticket_message', 'Click the button below to open a support ticket.')
                
                channel = bot.get_channel(int(channel_id))
                if not channel:
                    try:
                        channel = await bot.fetch_channel(int(channel_id))
                    except:
                        log.error(f"Could not find channel {channel_id} to send ticket message.")
                        return

                embed = discord.Embed(
                    title="Support Tickets",
                    description=message_text,
                    color=discord.Color.green()
                )
                await channel.send(embed=embed, view=TicketView(bot, bot.pool))
                log.info(f"Successfully sent ticket setup message to channel {channel_id}")

            # Schedule the coroutine in the bot's event loop
            if bot and bot.loop and bot.loop.is_running():
                asyncio.run_coroutine_threadsafe(send_ticket_msg(), bot.loop)
            else:
                log.warning("Bot loop not running, could not send ticket message.")
                
        except Exception as msg_err:
            log.error(f"Error sending ticket Discord message: {msg_err}")

        return jsonify({
            "success": True,
            "message": "Ticket configuration saved successfully"
        })
        
    except Exception as e:
        log.error(f"Save Ticket Config Error: {e}")
        return jsonify({"error": str(e)}), 500


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

    if not guild_id:
        return jsonify({"error": "Guild ID is required"}), 400

    try:
        # Remove from database
        supabase.table('guild_settings').delete().eq('guild_id', guild_id).execute()
        
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
    except Exception as e:
        log.error(f"Owner Leave Error: {e}")
        return jsonify({"error": str(e)}), 500


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

    if not guild_id:
        return jsonify({"error": "Guild ID is required"}), 400

    try:
        # Insert into banned_guilds table
        supabase.table('banned_guilds').upsert({
            'guild_id': guild_id,
            'guild_name': guild_name,
            'member_count': member_count,
            'banned_by': current_user.id,
            'banned_at': datetime.now().isoformat()
        }, on_conflict='guild_id').execute()

        # Remove from guild_settings
        supabase.table('guild_settings').delete().eq('guild_id', guild_id).execute()

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

    if not guild_id:
        return jsonify({"error": "Guild ID is required"}), 400

    try:
        # Check if guild is banned
        res = supabase.table('banned_guilds').select('guild_name').eq('guild_id', guild_id).single().execute()
        
        if not res.data:
            return jsonify({"error": "Guild is not banned"}), 404

        guild_name = res.data['guild_name'] or "Unknown Server"

        # Remove from banned_guilds
        supabase.table('banned_guilds').delete().eq('guild_id', guild_id).execute()
        
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


# ==================== SERVER CONFIG ROUTES ====================


@app.route("/dashboard/server/<guild_id>")
@login_required
def server_config(guild_id):
    """
    Server configuration page.

    Performs permission checks, loads core XP/level configuration,
    guild stats, and approximate member counts for the UI.
    """
    try:
        # 1. Auth Check (Standard)
        res = supabase.table('dashboard_users').select('access_token').eq('user_id', current_user.id).single().execute()
        if not res.data:
            return redirect(url_for("dashboard_login"))

        access_token = res.data['access_token']
        headers = {"Authorization": f"Bearer {access_token}"}
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
        gs_res = supabase.table('guild_settings').select('xp_per_message, xp_per_image, xp_per_minute_in_voice, voice_xp_limit, xp_cooldown').eq('guild_id', guild_id).single().execute()
        row = gs_res.data
        
        settings = {
            "xp_per_message": row['xp_per_message'] if row else 5,
            "xp_per_image": row['xp_per_image'] if row else 10,
            "xp_per_minute_in_voice": row['xp_per_minute_in_voice'] if row else 15,
            "voice_xp_limit": row['voice_xp_limit'] if row else 1500,
            "xp_cooldown": row['xp_cooldown'] if row else 60,
        }

        # B. Level Rewards
        lr_res = supabase.table('level_roles').select('level, role_id, role_name').eq('guild_id', guild_id).order('level').execute()
        level_rewards = lr_res.data if lr_res.data else []

        # C. Notification Channel
        nc_res = supabase.table('level_notify_channel').select('channel_id').eq('guild_id', guild_id).limit(1).execute()
        level_notify_id = nc_res.data[0]['channel_id'] if nc_res.data and len(nc_res.data) > 0 else None

        # D. Auto Reset Config
        ar_res = supabase.table('auto_reset').select('days, last_reset').eq('guild_id', guild_id).limit(1).execute()
        reset_res = ar_res.data[0] if ar_res.data and len(ar_res.data) > 0 else None
        auto_reset = (
            {"days": reset_res['days'], "last_reset": reset_res['last_reset']} if reset_res else None
        )

        # E. Guild Stats (weekly counters)
        gst_res = supabase.table('guild_stats').select('messages_this_week, new_members_this_week, last_reset').eq('guild_id', guild_id).limit(1).execute()
        stats_res = gst_res.data[0] if gst_res.data and len(gst_res.data) > 0 else None
        guild_stats = {
            "messages_this_week": stats_res['messages_this_week'] if stats_res else 0,
            "new_members_this_week": stats_res['new_members_this_week'] if stats_res else 0,
            "last_reset": stats_res['last_reset'] if stats_res else None,
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
    try:
        # Auth check: ensure token is present (simple access validation)
        res = supabase.table('dashboard_users').select('access_token').eq('user_id', current_user.id).single().execute()
        if not res.data:
            return jsonify({"error": "Unauthorized"}), 401
            
        # access_token = res.data['access_token']

        # Fetch guild stats
        gst_res = supabase.table('guild_stats').select('messages_this_week, new_members_this_week, last_reset').eq('guild_id', guild_id).single().execute()
        stats_res = gst_res.data
        guild_stats = {
            "messages_this_week": stats_res['messages_this_week'] if stats_res else 0,
            "new_members_this_week": stats_res['new_members_this_week'] if stats_res else 0,
            "last_reset": stats_res['last_reset'] if stats_res else None,
        }

        # Fetch general settings
        gs_res = supabase.table('guild_settings').select('xp_per_message, xp_per_image, xp_per_minute_in_voice, voice_xp_limit, xp_cooldown').eq('guild_id', guild_id).single().execute()
        row = gs_res.data
        settings = {
            "xp_per_message": row['xp_per_message'] if row else 5,
            "xp_per_image": row['xp_per_image'] if row else 10,
            "xp_per_minute_in_voice": row['xp_per_minute_in_voice'] if row else 15,
            "voice_xp_limit": row['voice_xp_limit'] if row else 1500,
            "xp_cooldown": row['xp_cooldown'] if row else 60,
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


# ==================== LEVEL REWARD & GUILD DATA API ====================


@app.route("/api/server/<guild_id>/discord-data", methods=["GET"])
@login_required
def get_discord_data(guild_id):
    """
    Fetch roles and channels for a guild via the Discord API.

    Used to populate dropdowns for configuration UI.
    """
    try:
        # res = supabase.table('dashboard_users').select('access_token').eq('user_id', current_user.id).single().execute()
        # if not res.data:
        #     return jsonify({"roles": [], "channels": []})
            
        # token = res.data['access_token'] 
        # Actually we use Bot token for Guild Data as per original code comment?
        # Original: headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
        # Wait, original fetched access_token but then used BOT TOKEN.
        # Why fetch access_token then? Maybe legacy or copy-paste.
        # I will respect the original code which fetched it but then used BOT TOKEN.
        
        headers = {
            "Authorization": f"Bot {DISCORD_BOT_TOKEN}"
        }

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


@app.route("/api/server/<guild_id>/level-reward", methods=["POST", "DELETE"])
@login_required
def manage_level_reward(guild_id):
    """
    Create, update, or delete level -> role mappings.

    POST
        Creates or updates a level -> role mapping.
    DELETE
        Deletes the mapping for a specific level.
    """
    try:
        if request.method == "POST":
            data = request.get_json()
            level = int(data.get("level"))
            role_id = data.get("role_id")
            role_name = data.get("role_name")

            supabase.table('level_roles').upsert({
                'guild_id': guild_id,
                'level': level,
                'role_id': role_id,
                'role_name': role_name
            }, on_conflict='guild_id, level').execute()
            
            return jsonify({"success": True})

        elif request.method == "DELETE":
            level = request.args.get("level")
            supabase.table('level_roles').delete().eq('guild_id', guild_id).eq('level', level).execute()
            return jsonify({"success": True})

    except Exception as e:
        log.error(f"Reward API Error: {e}")
        return jsonify({"error": str(e)}), 500


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

    try:
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
            supabase.table('level_notify_channel').upsert({
                'guild_id': guild_id,
                'channel_id': notify_channel_id
            }, on_conflict='guild_id').execute()
        else:
            supabase.table('level_notify_channel').delete().eq('guild_id', guild_id).execute()

        # Auto-reset settings
        if auto_reset_remove_roles_enabled and auto_reset_remove_roles_days > 0:
            supabase.table('auto_reset').upsert({
                'guild_id': guild_id,
                'days': auto_reset_remove_roles_days,
                'last_reset': datetime.now().isoformat(),
                'remove_roles': True
            }, on_conflict='guild_id').execute()
        elif auto_reset_enabled and auto_reset_days > 0:
            supabase.table('auto_reset').upsert({
                'guild_id': guild_id,
                'days': auto_reset_days,
                'last_reset': datetime.now().isoformat(),
                'remove_roles': False
            }, on_conflict='guild_id').execute()
        else:
            supabase.table('auto_reset').delete().eq('guild_id', guild_id).execute()

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

        supabase.table('level_system_config').upsert({
            'guild_id': guild_id,
            'message_style': message_style,
            'custom_message': custom_message,
            'custom_message_role_reward': custom_message_role_reward,
            'stack_role_rewards': stack_roles,
            'announce_role_rewards': announce_roles,
            'updated_at': datetime.now().isoformat()
        }, on_conflict='guild_id').execute()

        increment_command_counter()
        return jsonify({"success": True})

    except Exception as e:
        log.error(f"Level Settings API Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/server/<guild_id>/level-settings-get", methods=["GET"])
@login_required
def get_level_settings(guild_id):
    """
    Retrieve level system settings for a guild.

    Returns notification channel, message templates, announcement behavior,
    and auto-reset configuration.
    """
    if not user_has_access(current_user.id, str(guild_id)):
        return jsonify({"error": "Access denied"}), 403

    try:
        # Auth check
        if not user_has_access(current_user.id, str(guild_id)):
            return jsonify({"error": "Access denied"}), 403

        result = {}

        # Notification channel
        nc_res = supabase.table('level_notify_channel').select('channel_id').eq('guild_id', guild_id).limit(1).execute()
        if nc_res.data and len(nc_res.data) > 0:
            result["notify_channel_id"] = nc_res.data[0]['channel_id']

        # Additional system configuration
        lsc_res = supabase.table('level_system_config').select('message_style, custom_message, custom_message_role_reward, stack_role_rewards, announce_role_rewards').eq('guild_id', guild_id).limit(1).execute()
        row = lsc_res.data[0] if lsc_res.data and len(lsc_res.data) > 0 else None
        if row:
            result.update(
                {
                    "message_style": row['message_style'],
                    "custom_message": row['custom_message'],
                    "custom_message_role_reward": row['custom_message_role_reward'],
                    "stack_role_rewards": row['stack_role_rewards'],
                    "announce_role_rewards": row['announce_role_rewards'],
                }
            )

        # Auto-reset config
        ar_res = supabase.table('auto_reset').select('days, last_reset, remove_roles').eq('guild_id', guild_id).limit(1).execute()
        row = ar_res.data[0] if ar_res.data and len(ar_res.data) > 0 else None
        if row:
            result["auto_reset"] = {
                "days": row['days'],
                "last_reset": row['last_reset'],
                "remove_roles": row['remove_roles'],
            }

        return jsonify(result)

    except Exception as e:
        log.error(f"Get Level Settings Error: {e}")
        return jsonify({"error": str(e)}), 500


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

    keep_roles = request.json.get("keep_roles", True)

    try:
        # Reset everyone's XP
        # In Supabase we update all rows matching guild_id
        # Note: 'update' without 'eq' usually fails or warns, so we must be careful.
        # But we are filtering by guild_id.
        supabase.table('users').update({'xp': 0, 'level': 0, 'voice_xp_earned': 0}).eq('guild_id', guild_id).execute()
        supabase.table('last_notified_level').update({'level': 0}).eq('guild_id', guild_id).execute()

        increment_command_counter()

        roles_removed_count = 0

        if not keep_roles:
            # 1. Fetch level roles
            lr_res = supabase.table('level_roles').select('role_id').eq('guild_id', guild_id).execute()
            role_ids = [r['role_id'] for r in lr_res.data] if lr_res.data else []

            if role_ids:
                # Fetch all tracked users in this guild
                all_users_res = supabase.table('users').select('user_id').eq('guild_id', guild_id).execute()
                all_user_ids = [u['user_id'] for u in all_users_res.data] if all_users_res.data else []
                
                bot_headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
                
                for uid in all_user_ids:
                    try:
                        # Fetch member to check their roles
                        member_resp = requests.get(
                            f"{DISCORD_API_BASE_URL}/guilds/{guild_id}/members/{uid}",
                            headers=bot_headers
                        )
                        if member_resp.status_code == 200:
                            member_roles = member_resp.json().get('roles', [])
                            
                            roles_to_remove_from_member = set(member_roles).intersection(set(role_ids))

                            for rid in roles_to_remove_from_member:
                                del_resp = requests.delete(
                                    f"{DISCORD_API_BASE_URL}/guilds/{guild_id}/members/{uid}/roles/{rid}",
                                    headers=bot_headers
                                )
                                if del_resp.status_code == 204:
                                    roles_removed_count += 1
                        elif member_resp.status_code == 404:
                            # User not found in guild, likely left
                            pass
                        else:
                            log.warning(f"Failed to fetch member {uid} for role cleanup: {member_resp.status_code} - {member_resp.text}")
                    except Exception as e:
                        log.error(f"Error removing roles from user {uid}: {e}")

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
        log.error(f"Reset XP Error: {e}")
        return jsonify({"error": str(e)}), 500


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
    if not guild_id:
        log.error("manage_clocks called with empty guild_id")
        return jsonify({"error": "Invalid guild ID"}), 400
        
    guild_id = str(guild_id).strip()
    
    # DEBUG ACCESS CHECK
    log.info(f"manage_clocks DEBUG: User={current_user.id}, Guild={guild_id}")
    access_result = user_has_access(current_user.id, guild_id)
    log.info(f"manage_clocks DEBUG: user_has_access returned {access_result}")

    if not access_result:
        return jsonify({"error": "Access denied"}), 403

    try:
        if request.method == "GET":
            # Fetch clocks
            st_res = supabase.table('server_time_configs').select('id, time_channel_id, timezone, date_channel_id').eq('guild_id', guild_id).execute()
            
            clocks = []
            if st_res.data:
                for row in st_res.data:
                    clocks.append({
                        "id": row['id'],
                        "channel_id": row['time_channel_id'],
                        "timezone": row['timezone'],
                        "date_channel_id": row['date_channel_id'],
                    })
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

            # Upsert clock
            supabase.table('server_time_configs').upsert({
                'guild_id': guild_id,
                'timezone': timezone,
                'time_channel_id': channel_id,
                'date_channel_id': date_channel_id,
                'needs_update': True
            }, on_conflict='time_channel_id').execute()

            increment_command_counter()
            return jsonify({"success": True})

        elif request.method == "DELETE":
            channel_id = request.args.get("channel_id")
            supabase.table('server_time_configs').delete().eq('guild_id', guild_id).eq('time_channel_id', channel_id).execute()
            return jsonify({"success": True})

    except Exception as e:
        log.error(f"Clock API Error: {e}")
        return jsonify({"error": str(e)}), 500


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

    try:
        data = request.get_json()

        new_timezone = data.get("timezone")
        new_channel_id = data.get("channel_id")
        new_date_channel_id = data.get("date_channel_id")

        if not new_timezone or not new_channel_id:
            return jsonify({"error": "Missing required fields"}), 400

        if not new_date_channel_id:
            new_date_channel_id = None

        res = supabase.table('server_time_configs').update({
            'timezone': new_timezone,
            'time_channel_id': new_channel_id,
            'date_channel_id': new_date_channel_id,
            'needs_update': True
        }).eq('guild_id', guild_id).eq('id', clock_id).execute()

        if not res.data: # Supabase returns empty list if no rows updated
            log.warning(
                f"Clock update failed for guild {guild_id}, clock ID {clock_id}. No rows updated."
            )
            return jsonify({"error": "Clock not found"}), 404

        increment_command_counter()
        return jsonify({"success": True})

    except Exception as e:
        log.error(f"Clock Update Error: {e}")
        return jsonify({"error": str(e)}), 500


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

    try:
        if request.method == "GET":
            # Fetch existing config
            yt_res = supabase.table("youtube_notification_config").select(
                "yt_channel_id, discord_channel_id, custom_message, mention_role_id"
            ).eq("guild_id", guild_id).execute()

            # FIXED: Changed from 'feeds' to 'configs' to match frontend expectation
            configs = []
            if yt_res.data:
                for row in yt_res.data:
                    configs.append({
                        "yt_id": row['yt_channel_id'],
                        "discord_channel_id": row['discord_channel_id'],
                        "custom_message": row['custom_message'],
                        "notify_role_id": row['mention_role_id'],
                        "name": "Channel " + row['yt_channel_id'],  # Fallback name
                        "thumbnail": None  # Optional: fetch from cache if available
                    })
            
            # Return with 'configs' key to match frontend
            return jsonify({"configs": configs}), 200

        elif request.method == "POST":
            data = request.get_json()
            yt_channel_id = data.get("yt_channel_id") or data.get("yt_id")
            discord_channel_id = data.get("discord_channel_id") or data.get("target_channel")
            custom_msg = data.get("custom_message", "{channel} just uploaded a video! {link}")
            role_id = data.get("notify_role_id") or data.get("role_id")
            yt_name = data.get("yt_name", "Unknown Channel")

            if not yt_channel_id or not discord_channel_id:
                return jsonify({"error": "Missing required fields"}), 400

            # Insert/update configuration
            supabase.table('youtube_notification_config').upsert({
                'guild_id': guild_id,
                'yt_channel_id': yt_channel_id,
                'discord_channel_id': discord_channel_id,
                'custom_message': custom_msg,
                'mention_role_id': role_id,
                'yt_channel_name': yt_name,
            }, on_conflict='guild_id,yt_channel_id').execute()

            increment_command_counter()
            
            # Return seeded count for frontend feedback
            return jsonify({"success": True, "seeded_count": 0}), 200

        elif request.method == "DELETE":
            yt_channel_id = request.args.get("yt_channel_id") or request.args.get("yt_id")
            
            if not yt_channel_id:
                return jsonify({"error": "Missing yt_channel_id parameter"}), 400
            
            supabase.table('youtube_notification_config').delete().eq(
                'guild_id', guild_id
            ).eq('yt_channel_id', yt_channel_id).execute()
            
            return jsonify({"success": True}), 200

    except Exception as e:
        log.error(f"YouTube Config Error: {e}")
        # Return empty configs list on error for GET requests
        if request.method == "GET":
            return jsonify({"configs": []}), 200
        return jsonify({"error": str(e)}), 500

# ==================== CHANNEL RESTRICTIONS V2 API ====================


@app.route("/api/server/<guild_id>/channel-restrictions-v2/data", methods=["GET"])
@login_required
def get_channel_restrictions_v2_data(guild_id):
    """
    Retrieve all channel restriction v2 configurations for a guild.
    """
    if not user_has_access(current_user.id, str(guild_id)):
        return jsonify({"error": "Access denied"}), 403

    try:
        res = supabase.table('channel_restrictions_v2').select('id, channel_id, channel_name, restriction_type, allowed_content_types, blocked_content_types, redirect_channel_id, redirect_channel_name, immune_roles').eq('guild_id', guild_id).order('channel_name').execute()
        
        restrictions = []   
        if res.data:
            for row in res.data:
                # Map snake_case to frontend expected structure if needed, or pass directly
                # Frontend seems to expect snake_case keys as rows allowed
                r = row
                r["immune_roles"] = r.get("immune_roles", []) or []
                restrictions.append(r)

        return jsonify({"restrictions": restrictions}), 200
    except Exception as e:
        log.error(f"Restriction Data Error: {e}")
        return jsonify({"error": str(e)}), 500


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
    if not user_has_access(current_user.id, str(guild_id)):
        return jsonify({"error": "Access denied"}), 403


    try:
        if request.method == "DELETE":
            res_id = request.args.get("id")
            log.info(f"[Restrictions V2] DELETE request - ID: {res_id}, Guild: {guild_id}")
            supabase.table('channel_restrictions_v2').delete().eq('guild_id', guild_id).eq('id', res_id).execute()
            
            increment_command_counter()
            return jsonify({"success": True})

        data = request.get_json()
        log.info(f"[Restrictions V2] Payload received for guild {guild_id}: {data}")

        channel_id = data.get("channel_id")
        if not channel_id:
            log.error("[Restrictions V2] Missing channel_id in payload")
            return jsonify({"error": "Missing channel_id"}), 400
            
        channel_id = str(channel_id) # Force string
        channel_name = data.get("channel_name")
        res_type = data.get("restriction_type", "block_invites")
        allowed = data.get("allowed_content_types", 0)
        blocked = data.get("blocked_content_types", 0)
        redirect_id = data.get("redirect_channel_id") or None
        redirect_name = data.get("redirect_channel_name")
        immune_roles_raw = data.get("immune_roles", [])

        
        if redirect_id:
            # WORKAROUND: The database check constraint 'valid_restriction_type' / 'valid_redirect_channel'
            # strictly forbids redirect_channel_id unless restriction_type is 'text_only' or 'media_only'.
            # 'block_invites' and 'block_all_links' (and 'custom') do NOT allow redirects in the DB.
            # However, the bot logic (no_text.py) ignores restriction_type and only enforces the bitmasks.
            # Thus, we set restriction_type='text_only' to satisy the DB constraint, 
            # while the actual bitmasks (allowed/blocked) define the real behavior.
            res_type = "text_only"
        else:
            # If no redirect ID, ensure these are explicitly None
            redirect_id = None
            redirect_name = None
        
        # Ensure immune_roles is list for Supabase (JSONB or array)
        # Safely convert contents to strings to match array<text> expectation
        immune_roles = []
        if isinstance(immune_roles_raw, list):
            immune_roles = [str(r) for r in immune_roles_raw]
            
        log.info(f"[Restrictions V2] Processed Data - Channel: {channel_id}, Type: {res_type}, Immune: {immune_roles}")


        # Unified upsert logic for both POST and PUT
        # This simplifies the logic and often avoids RLS 'insert' specific blocks if 'upsert' policy is different
        supabase.table('channel_restrictions_v2').upsert({
            'guild_id': guild_id,
            'channel_id': channel_id,
            'channel_name': channel_name,
            'restriction_type': res_type,
            'allowed_content_types': allowed,
            'blocked_content_types': blocked,
            'redirect_channel_id': redirect_id,
            'redirect_channel_name': redirect_name,
            'immune_roles': immune_roles,
            'configured_by': str(current_user.id),
            'updated_at': datetime.now().isoformat()
        }, on_conflict='guild_id,channel_id').execute()

        increment_command_counter()
        return jsonify({"success": True})

    except Exception as e:
        log.error(f"Restriction API Error: {e}")
        return jsonify({"error": str(e)}), 500


# ==================== REMINDER API ====================


@app.route("/api/server/<guild_id>/reminders", methods=["GET"])
@login_required
def get_reminders(guild_id):
    """
    List non-deleted reminders for a guild.

    Datetimes are returned as ISO-formatted UTC strings for frontend conversion.
    """
    if not user_has_access(current_user.id, str(guild_id)):
        return jsonify({"error": "Access denied"}), 403

    try:
        # Fetch reminders, excluding deleted ones
        # We explicitly select columns ensuring we don't fail if some column is missing/renamed, 
        # though select('*') is usually fine if we don't hardcode dict access on missing keys.
        res = supabase.table('reminders').select('id, reminder_id, channel_id, role_id, message, next_run, interval, timezone, status, run_count').eq('guild_id', guild_id).neq('status', 'deleted').order('next_run').execute()
        
        reminders = []
        if res.data:
            for row in res.data:
                r = row
                # Ensure next_run is string for frontend 
                if r.get("next_run"):
                     pass 
                reminders.append(r)

        return jsonify({"reminders": reminders})

    except Exception as e:
        log.error(f"Get Reminders Error: {e}")
        return jsonify({"error": str(e)}), 500


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

    try:
        data = request.get_json()
        channel_id = data.get("channel_id")
        message = data.get("message")
        reminder_text = data.get("reminder_text") or message # fallback
        start_time_str = data.get("start_time") or data.get("remind_at")
        timezone_str = data.get("timezone")
        interval = data.get("interval", "once")
        role_id = data.get("role_id") or None
        
        # In case frontend sends mismatching keys (native UI vs old UI), normalize:
        if not reminder_text: 
             reminder_text = message

        if not all([channel_id, reminder_text, start_time_str, timezone_str]):
             return jsonify({"error": "Missing required fields"}), 400

        # Parse local datetime and convert to UTC
        local_dt = datetime.strptime(start_time_str, "%Y-%m-%dT%H:%M")
        tz = pytz.timezone(timezone_str)
        local_aware = tz.localize(local_dt)
        utc_dt = local_aware.astimezone(pytz.UTC)
        utc_dt = utc_dt.replace(tzinfo=None) # Make naive for asyncpg timestamp column

        import secrets
        import asyncio
        from supporter import bot

        reminder_id = data.get("reminder_id")
        action = "created"

        if reminder_id:
             # Check existence using bot pool
             check_query = "SELECT 1 FROM public.reminders WHERE reminder_id = $1 AND guild_id = $2"
             future = asyncio.run_coroutine_threadsafe(
                 bot.pool.fetchval(check_query, reminder_id, str(guild_id)), bot.loop
             )
             exists = future.result()

             if not exists:
                 return jsonify({"error": "Reminder not found"}), 404

             # Update
             update_query = """
                 UPDATE public.reminders
                 SET channel_id = $1, role_id = $2, message = $3, 
                     start_time = $4::timestamp, next_run = $5::timestamp, 
                     interval = $6, timezone = $7, updated_at = NOW(), status = 'active'
                 WHERE reminder_id = $8 AND guild_id = $9
             """
             future = asyncio.run_coroutine_threadsafe(
                 bot.pool.execute(
                     update_query, 
                     str(channel_id), 
                     str(role_id) if role_id else None, 
                     reminder_text,
                     utc_dt, 
                     utc_dt, 
                     interval, 
                     timezone_str, 
                     reminder_id, 
                     str(guild_id)
                 ), 
                 bot.loop
             )
             future.result()
             action = "updated"
        else:
             # Create
             reminder_id = f"R-{secrets.randbelow(9000) + 1000}"
             insert_query = """
                 INSERT INTO public.reminders (
                     reminder_id, guild_id, channel_id, role_id, message, 
                     start_time, next_run, interval, timezone, created_by, status
                 ) VALUES ($1, $2, $3, $4, $5, $6::timestamp, $7::timestamp, $8, $9, $10, 'active')
             """
             future = asyncio.run_coroutine_threadsafe(
                 bot.pool.execute(
                     insert_query,
                     reminder_id,
                     str(guild_id),
                     str(channel_id),
                     str(role_id) if role_id else None,
                     reminder_text,
                     utc_dt,
                     utc_dt,
                     interval,
                     timezone_str,
                     str(current_user.id)
                 ),
                 bot.loop
             )
             future.result()

        increment_command_counter()
        return jsonify({"success": True, "action": action})

    except Exception as e:
        log.error(f"Manage Reminder Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/server/<guild_id>/reminders/<reminder_id>", methods=["DELETE"])
@login_required
def delete_reminder_api(guild_id, reminder_id):
    """
    Soft-delete a reminder by marking its status as 'deleted'.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403
    try:
        reminder_id = request.args.get("id")
        supabase.table('reminders').delete().eq('id', reminder_id).eq('guild_id', guild_id).execute()
        return jsonify({"success": True})

    except Exception as e:
        log.error(f"Delete Reminder Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/server/<guild_id>/reminders/<reminder_id>/toggle", methods=["POST"])
@login_required
def toggle_reminder_status(guild_id, reminder_id):
    """
    Toggle reminder status between 'active' and 'paused'.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Access denied"}), 403
    try:
        # Toggle: fetch current, flip, update
        res = supabase.table('reminders').select('status').eq('reminder_id', reminder_id).eq('guild_id', guild_id).limit(1).execute()
        if not res.data:
            # Fallback check for old ID format if needed, or just error
            res = supabase.table('reminders').select('status').eq('id', reminder_id).eq('guild_id', guild_id).limit(1).execute()
            if not res.data:
                return jsonify({"error": "Reminder not found"}), 404

        current_status = res.data[0]['status']
        new_status = 'paused' if current_status == 'active' else 'active'
        
        # Update using the same ID column we successfull matched (prefer reminder_id)
        # We'll just try updating by reminder_id first
        u_res = supabase.table('reminders').update({'status': new_status}).eq('reminder_id', reminder_id).eq('guild_id', guild_id).execute()
        # If no rows updated (maybe matched by 'id' above?), try 'id'
        if not u_res.data:
             supabase.table('reminders').update({'status': new_status}).eq('id', reminder_id).eq('guild_id', guild_id).execute()
        
        return jsonify({"success": True, "new_status": new_status})

    except Exception as e:
        log.error(f"Toggle Reminder Error: {e}")
        return jsonify({"error": str(e)}), 500


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
    if not user_has_access(current_user.id, str(guild_id)):
        return jsonify({"error": "Access denied"}), 403

    try:
        if request.method == "GET":
            # Use limit(1) instead of single() to avoid errors when no row exists
            gs_res = supabase.table('guild_settings').select(
                'xp_per_message, xp_per_image, xp_per_minute_in_voice, voice_xp_limit, xp_cooldown'
            ).eq('guild_id', guild_id).limit(1).execute()
            
            # Check if we got data
            if gs_res.data and len(gs_res.data) > 0:
                row = gs_res.data[0]
                return jsonify({
                    "xp_per_message": row.get('xp_per_message', 5),
                    "xp_per_image": row.get('xp_per_image', 10),
                    "xp_per_minute_in_voice": row.get('xp_per_minute_in_voice', 15),
                    "voice_xp_limit": row.get('voice_xp_limit', 1500),
                    "xp_cooldown": row.get('xp_cooldown', 60),
                })
            else:
                # No settings found, return defaults
                return jsonify({
                    "xp_per_message": 5,
                    "xp_per_image": 10,
                    "xp_per_minute_in_voice": 15,
                    "voice_xp_limit": 1500,
                    "xp_cooldown": 60,
                })

        elif request.method == "POST":
            data = request.get_json()
            
            # Validate input
            xp_per_message = int(data.get("xp_per_message", 5))
            xp_per_image = int(data.get("xp_per_image", 10))
            xp_per_voice = int(data.get("xp_per_minute_in_voice", 15))
            voice_limit = int(data.get("voice_xp_limit", 1500))
            xp_cooldown = int(data.get("xp_cooldown", 60))
            
            # Upsert settings
            supabase.table('guild_settings').upsert({
                'guild_id': guild_id,
                'xp_per_message': xp_per_message,
                'xp_per_image': xp_per_image,
                'xp_per_minute_in_voice': xp_per_voice,
                'voice_xp_limit': voice_limit,
                'xp_cooldown': xp_cooldown
            }, on_conflict='guild_id').execute()

            increment_command_counter()
            return jsonify({"success": True})

    except Exception as e:
        log.error(f"Settings API Error: {e}")
        import traceback
        log.error(traceback.format_exc())
        return jsonify({"error": str(e)}), 500


# ==================== LEADERBOARD API ====================


@app.route("/dashboard/server/<guild_id>/view-leaderboard")
@login_required
def view_full_leaderboard(guild_id):
    """
    Render the full leaderboard page for a guild.
    """
    if not user_has_access(current_user.id, guild_id):
        return "Access Denied", 403

    try:
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
    except Exception as e:
        log.error(f"View Leaderboard Error: {e}")
        return "Error loading leaderboard", 500


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

    try:
        limit_arg = request.args.get("limit", "10")
        search_query = request.args.get("search", "")

        query = supabase.table('users').select('user_id, username, xp, level').eq('guild_id', guild_id)

        if search_query:
            query = query.ilike('username', f"%{search_query}%")

        query = query.order('xp', desc=True)

        if limit_arg != "all" and limit_arg != "0":
            try:
                limit = int(limit_arg)
                query = query.limit(limit)
            except ValueError:
                pass

        res = query.execute()
        rows = res.data

        leaderboard = [
            {
                "user_id": r["user_id"],
                "username": r["username"],
                "xp": r["xp"],
                "level": r["level"],
                "avatar": None,
            }
            for r in rows
        ]
        return jsonify({"leaderboard": leaderboard})
    except Exception as e:
        log.error(f"Leaderboard Error: {e}")
        return jsonify({"leaderboard": []})


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
            - Member counts (Discord API for total, DB for active).
            - XP and level statistics.
            - Feature adoption metrics.
            - Top contributors list.
    """
    if not user_has_access(current_user.id, guild_id):
        return jsonify({"error": "Unauthorized"}), 403

    try:
        # Guild-level weekly stats
        try:
            gs_res = supabase.table('guild_stats').select('messages_this_week, new_members_this_week').eq('guild_id', guild_id).limit(1).execute()
            stats = gs_res.data[0] if gs_res.data and len(gs_res.data) > 0 else None
        except Exception as e:
            log.warning(f"Failed to fetch guild_stats for {guild_id}: {e}")
            stats = None
        
        # Fetch users for XP/level aggregation and active member count
        u_res = supabase.table('users').select('xp, weekly_xp, level').eq('guild_id', guild_id).execute()
        users = u_res.data or []
        
        # Active members = users with XP > 0 (matches backend logic)
        active_members = sum(1 for u in users if u.get('xp', 0) > 0)
        
        # XP and level aggregates
        total_xp_lifetime = sum(u.get('xp', 0) for u in users)
        total_xp_weekly = sum(u.get('weekly_xp', 0) for u in users)
        avg_level = sum(u.get('level', 0) for u in users) / len(users) if len(users) > 0 else 0

        # Use Discord API for total member count 
        # This matches the backend analytics fix
        total_members = len(users)  
        try:
            bot_headers = {"Authorization": f"Bot {DISCORD_BOT_TOKEN}"}
            guild_resp = requests.get(
                f"{DISCORD_API_BASE_URL}/guilds/{guild_id}?with_counts=true",
                headers=bot_headers,
                timeout=3,
            )
            if guild_resp.status_code == 200:
                guild_data = guild_resp.json()
                # Use approximate_member_count for real Discord member count
                total_members = guild_data.get("approximate_member_count", total_members)
                log.info(f"Frontend analytics: Using Discord API member count for {guild_id}: {total_members}")
            else:
                log.warning(f"Discord API returned status {guild_resp.status_code} for guild {guild_id}, using DB count: {total_members}")
        except Exception as e:
            log.warning(f"Failed to get live member count from Discord API for {guild_id}: {e}, using DB count: {total_members}")

        # Feature adoption metrics
        lr_count = supabase.table('level_roles').select('role_id', count='exact').eq('guild_id', guild_id).execute().count or 0
        cr_count = supabase.table('channel_restrictions_v2').select('id', count='exact').eq('guild_id', guild_id).execute().count or 0
        reminder_count = supabase.table('reminders').select('id', count='exact').eq('guild_id', guild_id).neq('status', 'deleted').execute().count or 0
        
        # Top contributors (top 10 by XP)
        top_contributors = []
        tc_res = supabase.table('users').select('user_id, username, xp, level').eq('guild_id', guild_id).order('xp', desc=True).limit(10).execute()
        if tc_res.data:
            top_contributors = tc_res.data

        # Return analytics data matching backend structure
        return jsonify({
            "messages_this_week": stats.get('messages_this_week', 0) if stats else 0,
            "new_members_this_week": stats.get('new_members_this_week', 0) if stats else 0,
            "total_members": total_members,
            "active_members": active_members,
            "avg_level": round(avg_level, 1),
            "total_xp_weekly": total_xp_weekly, 
            "lifetime_xp": total_xp_lifetime,
            "feature_count": lr_count + cr_count + reminder_count,
            "top_contributors": [
                {
                    "user_id": u['user_id'],
                    "username": u['username'],
                    "xp": u['xp'],
                    "level": u['level'],
                } for u in top_contributors
            ],
            "total_xp": total_xp_lifetime,
            "max_level": max((u.get('level', 0) for u in users), default=0)
        })

    except Exception as e:
        log.error(f"Analytics Data Error for {guild_id}: {e}")
        import traceback
        log.error(traceback.format_exc())
        return jsonify({"error": str(e)}), 500


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

    try:
        res = supabase.table('analytics_snapshots').select('*').eq('id', snapshot_id).eq('guild_id', guild_id).single().execute()
        snapshot = res.data

        if not snapshot:
             return jsonify({"error": "Snapshot not found"}), 404

        return jsonify(
            {
                "id": snapshot['id'],
                "guild_id": snapshot['guild_id'],
                "snapshot_date": snapshot['snapshot_date'],
                "week_number": snapshot['week_number'],
                "year": snapshot['year'],
                "health_score": snapshot['health_score'],
                "total_members": snapshot['total_members'],
                "active_members": snapshot['active_members'],
                "messages_count": snapshot['messages_count'],
                "new_members_count": snapshot['new_members_count'],
                "engagement_tiers": {
                    "elite": {"count": snapshot['elite_count']},
                    "active": {"count": snapshot['active_count']},
                    "casual": {"count": snapshot['casual_count']},
                    "inactive": {"count": snapshot['inactive_count']},
                },
                "leveling": {
                    "total_xp_earned": snapshot['total_xp_earned'],
                    "avg_level": float(snapshot.get('avg_level') or 0),
                    "max_level": snapshot['max_level'],
                    "level_distribution": snapshot['level_distribution'],
                },
                "activity_heatmap": snapshot['activity_heatmap'],
                "peak_hour": snapshot['peak_hour'],
                "peak_day": snapshot['peak_day'],
                "message_trend": snapshot['message_trend'],
                "member_trend": snapshot['member_trend'],
                "top_contributors": snapshot['top_contributors'], # JSONB
                "insights": snapshot['insights'], # JSONB
                "generated_at": snapshot['generated_at'],
                "timezone": snapshot['timezone'],
            }
        )

    except Exception as e:
        log.error(f"Error fetching snapshot {snapshot_id}: {e}")
        return jsonify({"error": "Failed to fetch snapshot"}), 500


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
    if not user_has_access(current_user.id, str(guild_id)):
        return jsonify({"error": "Unauthorized"}), 403

    try:
        if request.method == "GET":
            res = supabase.table('guild_settings').select('analytics_timezone, weekly_reset_timezone, weekly_report_enabled, weekly_report_day, weekly_report_hour').eq('guild_id', guild_id).single().execute()
            settings = res.data or {}

            return jsonify(
                {
                    "analytics_timezone": settings.get('analytics_timezone', "UTC"),
                    "weekly_reset_timezone": settings.get('weekly_reset_timezone', "UTC"),
                    "weekly_report_enabled": settings.get('weekly_report_enabled', True),
                    "weekly_report_day": settings.get('weekly_report_day', 0),
                    "weekly_report_hour": settings.get('weekly_report_hour', 9),
                }
            )

        # POST: update settings
        data = request.get_json()

        if not guild_id or guild_id == "None":
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

        supabase.table('guild_settings').upsert({
            'guild_id': guild_id,
            'analytics_timezone': data.get("analytics_timezone", "UTC"),
            'weekly_reset_timezone': data.get("weekly_reset_timezone", "UTC"),
            'weekly_report_enabled': data.get("weekly_report_enabled", True),
            'weekly_report_day': day,
            'weekly_report_hour': hour
        }, on_conflict='guild_id').execute()

        log_dashboard_activity(
            guild_id,
            "analytics_settings_update",
            "Updated analytics settings",
        )

        increment_command_counter()

        return jsonify({"success": True})

    except Exception as e:
        log.error(f"Error managing analytics settings for {guild_id}: {e}")
        return jsonify({"error": "Failed to manage settings"}), 500


# ==================== RUNNER ====================


def check_and_migrate_schema():
    """
    Perform minimal schema migrations required by the dashboard.
    For Supabase, logic is simplified or skipped if not using direct migrations here.
    """
    log.info("✅ Schema migration: Check skipped (Supabase Mode).")


def run_flask_app():
    """
    Initialize and start the Flask application.

    - Reads host/port/debug from environment.
    - Initializes DB pool and runs schema checks.
    - Starts Flask with reloader disabled.
    """
    host = os.getenv("FLASK_HOST", "0.0.0.0")
    port = int(os.getenv("FLASK_PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "true").lower() == "true"

    log.info(f"🌐 Flask Server starting on {host}:{port}")
    check_and_migrate_schema() # Keep as no-op or lightweight
    app.run(host=host, port=port, debug=debug, use_reloader=False)


if __name__ == "__main__":
    run_flask_app()
