# v4.0.0
import discord
from discord import app_commands
from discord.ext import commands, tasks
from datetime import datetime, timezone, timedelta
import pytz
import asyncpg
import logging
import time

log = logging.getLogger(__name__)
IST = timezone(timedelta(hours=5, minutes=30))
SETTINGS_CACHE_DURATION = 300  # 5 minutes in seconds


class LevelManager:
    """
    Manages all leveling, XP accumulation, weekly stats, and role-reward logic.

    Responsibilities
    ----------------
    - Track XP from:
      * Text messages (with cooldowns).
      * Image messages.
      * Voice activity with per-period caps.
    - Persist user XP/level and weekly XP in the database.
    - Maintain weekly guild statistics (messages, new members).
    - Handle automatic and manual XP resets.
    - Assign and synchronize level-based roles.
    - Expose a set of slash commands for configuration and inspection.
    """

    def __init__(self, bot: commands.Bot, pool: asyncpg.Pool):
        """
        Initialize a LevelManager instance.

        Parameters
        ----------
        bot : commands.Bot
            The main Discord bot instance.
        pool : asyncpg.Pool
            PostgreSQL connection pool for persistence.
        """
        self.bot = bot
        self.pool = pool
        self.voice_sessions = {}  # (guild_id, user_id) -> (datetime, channel_id)
        self.user_cache = {}  # (guild_id, user_id) -> user row dict
        self.message_cooldowns = {}  # (guild_id, user_id) -> datetime of last XP grant
        self.settings_cache = {}  # guild_id -> (settings_dict, timestamp)
        self.jtc_manager = None  # Will be set by supporter.py after JoinToCreateManager initialization

    async def start(self):
        """
        Start the leveling subsystem.

        Registers event listeners and starts periodic background tasks.
        """
        self.bot.add_listener(self.on_message, "on_message")
        self.bot.add_listener(self.on_voice_state_update, "on_voice_state_update")
        self.bot.add_listener(self.on_member_join, "on_member_join")
        self.reset_loop.start()
        self.cleanup_cooldowns.start()
        log.info("Leveling system has been initialized (Dynamic Settings Mode).")

    def stop(self):
        """
        Stop background loops associated with leveling.

        This is called during bot shutdown or when disabling the module.
        """
        if self.reset_loop.is_running():
            self.reset_loop.cancel()
        if self.cleanup_cooldowns.is_running():
            self.cleanup_cooldowns.cancel()
        log.info("LevelManager loops stopped.")

    # ==========================
    # Guild Settings Management
    # ==========================
    async def get_guild_settings(self, guild_id: int) -> dict:
        """
        Retrieve leveling settings for a guild, with caching.

        If no settings are found, a default row is inserted into
        `public.guild_settings` and then returned.

        Parameters
        ----------
        guild_id : int
            The ID of the guild whose settings are requested.

        Returns
        -------
        dict
            A dictionary-like record of guild settings.
        """
        now = time.time()

        # Check cached settings
        if guild_id in self.settings_cache:
            cached_settings, timestamp = self.settings_cache[guild_id]
            if now - timestamp < SETTINGS_CACHE_DURATION:
                return cached_settings

        async with self.pool.acquire() as conn:
            settings_record = await conn.fetchrow(
                "SELECT * FROM public.guild_settings WHERE guild_id = $1", str(guild_id)
            )

            # Create defaults if no row exists
            if not settings_record:
                await conn.execute(
                    """INSERT INTO public.guild_settings 
                        (guild_id, xp_per_message, xp_per_image, xp_per_minute_in_voice, voice_xp_limit) 
                        VALUES ($1, 5, 10, 15, 1500) 
                        ON CONFLICT (guild_id) DO NOTHING""",
                    str(guild_id),
                )
                settings_record = await conn.fetchrow(
                    "SELECT * FROM public.guild_settings WHERE guild_id = $1",
                    str(guild_id),
                )

        settings_dict = (
            dict(settings_record)
            if settings_record
            else {
                "xp_per_message": 5,
                "xp_per_image": 10,
                "xp_per_minute_in_voice": 15,
                "voice_xp_limit": 1500,
            }
        )

        self.settings_cache[guild_id] = (settings_dict, now)
        return settings_dict

    # ==========================
    # User Data Utilities
    # ==========================
    async def get_user(self, guild_id: int, user_id: int) -> dict:
        """
        Retrieve a user's leveling record from the cache or database.

        If the user does not yet exist in the database, a new record is created.

        Parameters
        ----------
        guild_id : int
            Guild ID for the user context.
        user_id : int
            Discord user ID.

        Returns
        -------
        dict
            A dictionary representing the user's row in `public.users`.
        """
        key = (guild_id, user_id)
        if user_data := self.user_cache.get(key):
            return user_data

        async with self.pool.acquire() as conn:
            user_record = await conn.fetchrow(
                "SELECT * FROM public.users WHERE guild_id = $1 AND user_id = $2",
                str(guild_id),
                str(user_id),
            )

        if user_record:
            user_dict = dict(user_record)
            self.user_cache[key] = user_dict
            return user_dict
        return await self.create_user(guild_id, user_id)

    async def create_user(self, guild_id: int, user_id: int) -> dict:
        """
        Create a new user entry in `public.users` with default values.

        Parameters
        ----------
        guild_id : int
            Guild ID for the user context.
        user_id : int
            Discord user ID.

        Returns
        -------
        dict
            A newly created user record with default XP/level values.
        """
        guild = self.bot.get_guild(guild_id)
        member = guild.get_member(user_id) if guild else None
        guild_name = guild.name if guild else "Unknown Guild"
        user_name = member.name if member else "Unknown User"

        query = (
            "INSERT INTO public.users (guild_id, user_id, guild_name, username) "
            "VALUES ($1, $2, $3, $4) ON CONFLICT (guild_id, user_id) "
            "DO UPDATE SET guild_name = $3, username = $4"
        )
        await self.pool.execute(
            query, str(guild_id), str(user_id), guild_name, user_name
        )

        new_user = {
            "guild_id": str(guild_id),
            "user_id": str(user_id),
            "xp": 0,
            "level": 0,
            "voice_xp_earned": 0,
            "guild_name": guild_name,
            "username": user_name,
        }
        self.user_cache[(guild_id, user_id)] = new_user
        return new_user

    async def update_user_xp(
        self, guild_id: int, user_id: int, xp_gain: int, voice_xp_gain: int = 0
    ):
        """
        Update a user's XP and level, and persist the change.

        Also updates `weekly_xp` and `voice_xp_earned` if applicable.

        Parameters
        ----------
        guild_id : int
            Guild ID for the user.
        user_id : int
            User ID for the user.
        xp_gain : int
            Amount of XP to add to the user's total.
        voice_xp_gain : int, optional
            Amount of XP categorized as voice XP.

        Returns
        -------
        int
            The user's new level after the update.
        """
        user = await self.get_user(guild_id, user_id)
        new_xp = user.get("xp", 0) + xp_gain
        new_level = new_xp // 1000
        new_voice_xp = user.get("voice_xp_earned", 0) + voice_xp_gain
        new_weekly_xp = user.get("weekly_xp", 0) + xp_gain

        query = (
            "UPDATE public.users SET xp = $3, level = $4, voice_xp_earned = $5, "
            "weekly_xp = $6 WHERE guild_id = $1 AND user_id = $2"
        )
        await self.pool.execute(
            query,
            str(guild_id),
            str(user_id),
            new_xp,
            new_level,
            new_voice_xp,
            new_weekly_xp,
        )

        user.update(
            xp=new_xp,
            level=new_level,
            voice_xp_earned=new_voice_xp,
            weekly_xp=new_weekly_xp,
        )
        self.user_cache[(guild_id, user_id)] = user
        return new_level

    # ==========================
    # Guild Weekly Stats
    # ==========================
    async def _check_and_reset_weekly_stats(self, guild_id: int):
        """
        Check whether the guild's weekly stats should be reset and reset if needed.

        Weekly reset is based on:
        - A configured timezone (from `guild_settings.weekly_reset_timezone`, default "UTC").
        - Monday 00:00 in that timezone.

        Parameters
        ----------
        guild_id : int
            The guild whose weekly stats are evaluated.
        """
        settings = await self.get_guild_settings(guild_id)
        timezone_str = settings.get("weekly_reset_timezone", "UTC")

        try:
            tz = pytz.timezone(timezone_str)
        except pytz.UnknownTimeZoneError:
            tz = pytz.UTC

        now = datetime.now(tz)

        async with self.pool.acquire() as conn:
            stats = await conn.fetchrow(
                "SELECT last_reset FROM public.guild_stats WHERE guild_id = $1",
                str(guild_id),
            )

            if not stats:
                now_utc = datetime.now(timezone.utc)
                await conn.execute(
                    """INSERT INTO public.guild_stats (guild_id, messages_this_week, new_members_this_week, last_reset)
                       VALUES ($1, 0, 0, $2)
                       ON CONFLICT (guild_id) DO NOTHING""",
                    str(guild_id),
                    now_utc,
                )
                return

            last_reset_utc = stats["last_reset"]
            if last_reset_utc.tzinfo is None:
                last_reset_utc = last_reset_utc.replace(tzinfo=timezone.utc)
            last_reset_local = last_reset_utc.astimezone(tz)

            current_monday = now - timedelta(days=now.weekday())
            current_monday = current_monday.replace(
                hour=0, minute=0, second=0, microsecond=0
            )

            last_reset_monday = last_reset_local - timedelta(
                days=last_reset_local.weekday()
            )
            last_reset_monday = last_reset_monday.replace(
                hour=0, minute=0, second=0, microsecond=0
            )

            if current_monday > last_reset_monday:
                log.info(
                    f"📊 Resetting weekly stats for guild {guild_id} (TZ: {timezone_str})"
                )
                now_utc = datetime.now(timezone.utc)
                await conn.execute(
                    """UPDATE public.guild_stats 
                       SET messages_this_week = 0, new_members_this_week = 0, last_reset = $2
                       WHERE guild_id = $1""",
                    str(guild_id),
                    now_utc,
                )
                await conn.execute(
                    "UPDATE public.users SET weekly_xp = 0 WHERE guild_id = $1",
                    str(guild_id),
                )

    async def _update_guild_stats_message(self, guild_id: int):
        """
        Increment the message count for a guild, performing weekly resets if needed.

        Parameters
        ----------
        guild_id : int
            Guild ID whose message count is being updated.
        """
        await self._check_and_reset_weekly_stats(guild_id)

        async with self.pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO public.guild_stats (guild_id, messages_this_week, new_members_this_week, last_reset)
                   VALUES ($1, 1, 0, NOW())
                   ON CONFLICT (guild_id) DO UPDATE 
                   SET messages_this_week = public.guild_stats.messages_this_week + 1""",
                str(guild_id),
            )

    async def _update_guild_stats_member(self, guild_id: int):
        """
        Increment the new member count for a guild, performing weekly resets if needed.

        Parameters
        ----------
        guild_id : int
            Guild ID whose new member count is being updated.
        """
        await self._check_and_reset_weekly_stats(guild_id)

        async with self.pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO public.guild_stats (guild_id, messages_this_week, new_members_this_week, last_reset)
                   VALUES ($1, 0, 1, NOW())
                   ON CONFLICT (guild_id) DO UPDATE 
                   SET new_members_this_week = public.guild_stats.new_members_this_week + 1""",
                str(guild_id),
            )

    # ==========================
    # Event Handlers
    # ==========================
    async def on_message(self, message: discord.Message):
        """
        Handle XP gain for messages and update guild weekly stats.

        Notes
        -----
        - Respects a per-user cooldown (xp_cooldown) to avoid spam.
        - Distinguishes between text-only messages and image attachments
          for different XP values.
        """
        if message.author.bot or not message.guild:
            return

        settings = await self.get_guild_settings(message.guild.id)
        xp_cooldown = settings.get("xp_cooldown", 60)

        key = (message.guild.id, message.author.id)
        now = datetime.now()
        if (last_msg := self.message_cooldowns.get(key)) and (
            now - last_msg
        ).total_seconds() < xp_cooldown:
            return
        self.message_cooldowns[key] = now

        try:
            await self._update_guild_stats_message(message.guild.id)
        except Exception as e:
            log.error(f"Error updating guild stats for message: {e}")

        xp_text = settings.get("xp_per_message", 10)
        xp_image = settings.get("xp_per_image", 15)

        amount = (
            xp_image
            if any(
                att.content_type and att.content_type.startswith("image/")
                for att in message.attachments
            )
            else xp_text
        )

        user_data = await self.get_user(message.guild.id, message.author.id)
        old_level = user_data.get("level", 0)
        new_level = await self.update_user_xp(
            message.guild.id, message.author.id, amount
        )

        if new_level > old_level:
            await self._check_and_handle_level_up(message.author, new_level)

    async def on_voice_state_update(
        self,
        member: discord.Member,
        before: discord.VoiceState,
        after: discord.VoiceState,
    ):
        """
        Track voice session start and end to award voice XP.

        Voice XP is only counted when the user is:
        - Connected to a voice channel.
        - Not AFK.
        - Not self-deafened.
        """
        if member.bot or not member.guild:
            return

        key = (member.guild.id, member.id)
        now = datetime.now(IST)

        is_active_before = before.channel and not before.afk and not before.self_deaf
        is_active_after = after.channel and not after.afk and not after.self_deaf

        if is_active_before and not is_active_after:
            if session_data := self.voice_sessions.pop(key, None):
                # session_data is (start_time, channel_id)
                start_time, channel_id = session_data
                await self._award_voice_xp(member, start_time, channel_id)
        elif not is_active_before and is_active_after:
            # Store both start time and channel ID
            self.voice_sessions[key] = (now, after.channel.id)

    async def on_member_join(self, member: discord.Member):
        """
        Track new member joins for weekly guild statistics.
        """
        if member.bot or not member.guild:
            return

        try:
            await self._update_guild_stats_member(member.guild.id)
        except Exception as e:
            log.error(f"Error updating guild stats for new member: {e}")

    # ==========================
    # Core Leveling & Roles
    # ==========================
    async def _award_voice_xp(self, member: discord.Member, start_time: datetime, channel_id: int):
        """
        Calculate and award XP for time spent in voice channels.

        Respects per-period `voice_xp_limit` to avoid excessive gains.
        
        **Join-to-Create Integration:**
        - Only awards XP for temp voice channels created by Join-to-Create
        - No XP for trigger channels
        - No XP for regular voice channels (unless Join-to-Create is not configured)

        Parameters
        ----------
        member : discord.Member
            Member who left active voice.
        start_time : datetime
            Timestamp when the member started the eligible voice session.
        channel_id : int
            The ID of the voice channel they were in.
        """
        # NEW: Check channel type if Join-to-Create is enabled
        if self.jtc_manager:
            # Check if it's a trigger channel (no XP)
            if await self.jtc_manager.is_trigger_channel(channel_id):
                log.info(f"⏭️ Skipping XP for {member.name} - was in trigger channel")
                return
            
            # Check if it's a temp channel (award XP)
            if not await self.jtc_manager.is_temp_channel(channel_id):
                log.info(f"⏭️ Skipping XP for {member.name} - not in temp channel")
                return
        
        # Existing XP calculation logic
        settings = await self.get_guild_settings(member.guild.id)
        voice_xp_limit = settings.get("voice_xp_limit", 1500)
        xp_per_minute = settings.get("xp_per_minute_in_voice", 4)

        user = await self.get_user(member.guild.id, member.id)
        if user.get("voice_xp_earned", 0) >= voice_xp_limit:
            return

        elapsed_seconds = (datetime.now(IST) - start_time).total_seconds()
        xp_to_add = int((elapsed_seconds / 60) * xp_per_minute)
        if xp_to_add <= 0:
            return

        remaining_room = voice_xp_limit - user.get("voice_xp_earned", 0)
        xp_to_add = min(xp_to_add, remaining_room)

        if xp_to_add > 0:
            old_level = user.get("level", 0)
            new_level = await self.update_user_xp(
                member.guild.id, member.id, xp_to_add, voice_xp_gain=xp_to_add
            )
            if new_level > old_level:
                await self._check_and_handle_level_up(member, new_level)

    async def _check_and_handle_level_up(self, member: discord.Member, new_level: int):
        """
        Handle level-up events: roles, announcement messages, and tracking.

        Steps
        -----
        1. Check if the user has already been notified for this level.
        2. Load level system configuration (message style, stacking, etc.).
        3. Upgrade user roles based on the new level.
        4. Send a level-up announcement (embed/minimal/simple) if configured.
        5. Update `public.last_notified_level`.
        """
        last_notified = (
            await self.pool.fetchval(
                "SELECT level FROM public.last_notified_level WHERE guild_id = $1 AND user_id = $2",
                str(member.guild.id),
                str(member.id),
            )
            or 0
        )
        if new_level <= last_notified:
            return

        log.info(
            f"LEVEL UP: {member.name} in '{member.guild.name}' reached Level {new_level}"
        )

        settings = await self.pool.fetchrow(
            "SELECT custom_message, custom_message_role_reward, stack_role_rewards, announce_role_rewards, message_style FROM public.level_system_config WHERE guild_id = $1",
            str(member.guild.id),
        )

        stack_roles = (
            settings["stack_role_rewards"]
            if settings and settings["stack_role_rewards"] is not None
            else True
        )
        announce_roles = (
            settings["announce_role_rewards"]
            if settings and settings["announce_role_rewards"] is not None
            else True
        )
        message_style = (
            settings["message_style"]
            if settings and settings["message_style"]
            else "embed"
        )

        earned_role_id = await self.upgrade_user_roles(member, new_level, stack_roles)
        earned_role = member.guild.get_role(earned_role_id) if earned_role_id else None

        channel_id_str = await self.pool.fetchval(
            "SELECT channel_id FROM public.level_notify_channel WHERE guild_id = $1",
            str(member.guild.id),
        )
        if channel_id_str and (channel := self.bot.get_channel(int(channel_id_str))):

            default_msg = "🚀 Congrats {user}! You've reached **Level {level}**!"
            default_role_msg = "🎉 Congrats {user}! You've reached **Level {level}** and earned the **{role}** role!"

            template_normal = (
                settings["custom_message"]
                if settings and settings["custom_message"]
                else default_msg
            )
            template_role = (
                settings["custom_message_role_reward"]
                if settings and settings["custom_message_role_reward"]
                else default_role_msg
            )

            user_mention = member.mention
            level_str = str(new_level)
            role_name = earned_role.name if earned_role else "Unknown Role"
            role_mention = earned_role.mention if earned_role else "Unknown Role"

            if earned_role and announce_roles:
                msg_content = (
                    template_role.replace("{user}", user_mention)
                    .replace("{level}", level_str)
                    .replace("{role}", role_name)
                    .replace("{xp}", str(0))
                )
            else:
                msg_content = (
                    template_normal.replace("{user}", user_mention)
                    .replace("{level}", level_str)
                    .replace("{xp}", str(0))
                )

            try:
                if message_style == "embed":
                    embed = discord.Embed(
                        description=msg_content,
                        color=(
                            member.color
                            if member.color != discord.Color.default()
                            else discord.Color.gold()
                        ),
                    )
                    embed.set_author(
                        name="Level Up!", icon_url=member.display_avatar.url
                    )
                    if earned_role and announce_roles:
                        embed.set_footer(text=f"Role Earned: {role_name}")
                    await channel.send(content=member.mention, embed=embed)

                elif message_style == "minimal":
                    await channel.send(
                        f"**Level Up!** {member.mention} -> **{new_level}**"
                    )

                else:
                    await channel.send(msg_content)

            except discord.HTTPException as e:
                log.error(
                    f"Failed to send level-up message to channel {channel.id}: {e}"
                )

        query = (
            "INSERT INTO public.last_notified_level (guild_id, user_id, level, guild_name, username) "
            "VALUES ($1, $2, $3, $4, $5) ON CONFLICT (guild_id, user_id) "
            "DO UPDATE SET level = $3, username = $5"
        )
        await self.pool.execute(
            query,
            str(member.guild.id),
            str(member.id),
            new_level,
            member.guild.name,
            member.name,
        )

    async def upgrade_user_roles(
        self, member: discord.Member, new_level: int, stack_roles: bool = True
    ) -> int | None:
        """
        Synchronize level-based roles for a member according to their level.

        Parameters
        ----------
        member : discord.Member
            The member whose roles should be updated.
        new_level : int
            The member's new level.
        stack_roles : bool, optional
            If True, previously earned roles are kept; otherwise, only the
            highest applicable role is kept.

        Returns
        -------
        int | None
            The ID of the highest level role assigned, or None if none were changed.
        """
        roles = await self.pool.fetch(
            "SELECT role_id, level FROM public.level_roles WHERE guild_id = $1 ORDER BY level DESC",
            str(member.guild.id),
        )
        if not roles:
            return None

        target_role_id = next(
            (int(r["role_id"]) for r in roles if new_level >= r["level"]), None
        )
        all_level_role_ids = {int(r["role_id"]) for r in roles}
        current_user_role_ids = {r.id for r in member.roles}

        roles_to_add_ids = (
            {target_role_id} - current_user_role_ids if target_role_id else set()
        )

        roles_to_remove_ids = set()
        if not stack_roles:
            roles_to_remove_ids = (current_user_role_ids & all_level_role_ids) - {
                target_role_id
            }

        try:
            if roles_to_add_ids:
                await member.add_roles(
                    *[
                        r
                        for r_id in roles_to_add_ids
                        if (r := member.guild.get_role(r_id))
                    ],
                    reason=f"Reached Level {new_level}",
                )
            if roles_to_remove_ids:
                await member.remove_roles(
                    *[
                        r
                        for r_id in roles_to_remove_ids
                        if (r := member.guild.get_role(r_id))
                    ],
                    reason="Level role sync (Stacking Disabled)",
                )
            if roles_to_add_ids or roles_to_remove_ids:
                return target_role_id
        except discord.Forbidden:
            log.error(
                f"Bot lacks permission to manage roles in guild {member.guild.id}"
            )
        return None

    # ==========================
    # XP Reset Logic
    # ==========================
    async def _perform_full_reset(self, guild: discord.Guild, keep_roles: bool = False):
        """
        Perform a full XP reset for a guild.

        Parameters
        ----------
        guild : discord.Guild
            The guild whose XP should be reset.
        keep_roles : bool, optional
            If True, level reward roles are kept; otherwise they are removed.

        Returns
        -------
        tuple[int, int]
            (roles_removed_count, users_affected_count)
        """
        log.warning(
            f"Performing full XP reset for guild: {guild.name} ({guild.id}) [Keep Roles: {keep_roles}]"
        )
        roles_removed, users_affected = 0, 0

        if not keep_roles:
            reward_roles = await self.pool.fetch(
                "SELECT role_id FROM public.level_roles WHERE guild_id = $1",
                str(guild.id),
            )
            if reward_roles:
                reward_role_ids = {int(r["role_id"]) for r in reward_roles}
                for member in guild.members:
                    if member.bot:
                        continue
                    roles_to_strip = [
                        r for r in member.roles if r.id in reward_role_ids
                    ]
                    if roles_to_strip:
                        try:
                            await member.remove_roles(
                                *roles_to_strip, reason="XP Reset"
                            )
                            roles_removed += len(roles_to_strip)
                            users_affected += 1
                        except discord.Forbidden:
                            log.warning(
                                f"No permission to remove roles from {member.display_name} in {guild.name}"
                            )
        else:
            log.info("Skipping role removal per keep_roles=True.")

        await self.pool.execute(
            "UPDATE public.users SET xp = 0, level = 0, voice_xp_earned = 0 WHERE guild_id = $1",
            str(guild.id),
        )
        await self.pool.execute(
            "UPDATE public.last_notified_level SET level = 0 WHERE guild_id = $1",
            str(guild.id),
        )

        for key in [k for k in self.user_cache if k[0] == guild.id]:
            del self.user_cache[key]
        return roles_removed, users_affected

    async def check_and_run_auto_reset(self):
        """
        Evaluate auto-reset configuration and perform resets if required.

        Uses the `public.auto_reset` table to determine:
        - Reset interval (in days).
        - Whether reward roles should be removed or kept.
        """
        now_utc = datetime.now(timezone.utc)
        configs = await self.pool.fetch("SELECT * FROM public.auto_reset")
        for row in configs:
            if (now_utc - row["last_reset"]).days >= row["days"]:
                if guild := self.bot.get_guild(int(row["guild_id"])):
                    remove_roles = row.get("remove_roles", True)
                    log.info(
                        f"Auto-reset triggered for guild {guild.name} ({guild.id}) [Remove Roles: {remove_roles}]"
                    )

                    await self._perform_full_reset(guild, keep_roles=not remove_roles)

                    await self.pool.execute(
                        "UPDATE public.auto_reset SET last_reset = NOW() WHERE guild_id = $1",
                        str(guild.id),
                    )

    @tasks.loop(hours=1)
    async def reset_loop(self):
        """
        Background task: periodically check for auto-reset conditions.
        """
        await self.check_and_run_auto_reset()

    @reset_loop.before_loop
    async def before_reset_loop(self):
        """
        Wait for the bot to be ready before starting the auto-reset loop.
        """
        await self.bot.wait_until_ready()

    @tasks.loop(hours=1)
    async def cleanup_cooldowns(self):
        """
        Remove expired message cooldown entries to avoid memory growth.
        """
        now = datetime.now()
        cutoff = now - timedelta(hours=1)

        old_keys = [
            key
            for key, timestamp in self.message_cooldowns.items()
            if timestamp < cutoff
        ]

        for key in old_keys:
            del self.message_cooldowns[key]

        if old_keys:
            log.info(f"🧹 Cleaned up {len(old_keys)} old cooldown entries")

    # ==========================
    # Slash Commands
    # ==========================
    def register_commands(self):
        """
        Register all leveling-related slash commands.

        Commands
        --------
        /l1-level
        /l2-leaderboard
        /l3-setup-level-reward
        /l4-level-reward-show
        /l5-notify-level-msg
        /l6-xp-settings
        /l7-level-config
        /l13-level-custom-msg
        /l14-level-auto-reset
        /l9-reset-xp
        /l10-upgrade-all-roles
        """

        @self.bot.tree.command(
            name="l1-level", description="Check your or another user's level."
        )
        async def level(
            interaction: discord.Interaction, member: discord.Member = None
        ):
            """
            Show basic level and XP information for a user.

            Parameters
            ----------
            member : discord.Member, optional
                Target user to inspect. Defaults to the invoking user.
            """
            target = member or interaction.user
            user_data = await self.get_user(interaction.guild.id, target.id)
            settings = await self.get_guild_settings(interaction.guild.id)
            voice_xp_limit = settings.get("voice_xp_limit", 1500)

            embed = discord.Embed(
                title=f"📊 Level Info for {target.display_name}", color=0x3498DB
            )
            embed.set_thumbnail(url=target.display_avatar.url)
            embed.add_field(name="Level", value=user_data.get("level", 0))
            embed.add_field(name="Total XP", value=user_data.get("xp", 0))
            embed.add_field(
                name="Voice XP This Period",
                value=f"{user_data.get('voice_xp_earned', 0)} / {voice_xp_limit}",
                inline=False,
            )
            await interaction.response.send_message(embed=embed, ephemeral=True)

        @self.bot.tree.command(
            name="l2-leaderboard",
            description="Show the top 10 users on the leaderboard.",
        )
        async def leaderboard(interaction: discord.Interaction):
            """
            Display the top 10 users by XP for the current guild.
            """
            await interaction.response.defer()
            data = await self.pool.fetch(
                "SELECT * FROM public.users WHERE guild_id = $1 ORDER BY xp DESC LIMIT 10",
                str(interaction.guild.id),
            )
            embed = discord.Embed(
                title=f"🏆 Leaderboard - {interaction.guild.name}", color=0xF1C40F
            )
            if not data:
                embed.description = "No one has earned any XP yet!"
            for i, row in enumerate(data, 1):
                try:
                    user_obj = interaction.guild.get_member(
                        int(row["user_id"])
                    ) or await self.bot.fetch_user(int(row["user_id"]))
                    name = user_obj.display_name
                except discord.NotFound:
                    name = row.get("username", "Unknown User")
                embed.add_field(
                    name=f"#{i} {name}",
                    value=f"Lvl {row['level']} ({row['xp']} XP)",
                    inline=False,
                )
            await interaction.followup.send(embed=embed)

        @self.bot.tree.command(
            name="l3-setup-level-reward",
            description="Set a role reward for reaching a specific level.",
        )
        @app_commands.checks.has_permissions(manage_roles=True)
        async def setup_level_reward(
            interaction: discord.Interaction, level: int, role: discord.Role
        ):
            """
            Configure a level-based role reward.

            Parameters
            ----------
            level : int
                Level threshold for the reward.
            role : discord.Role
                Role to assign when the level is reached.
            """
            await interaction.response.defer(ephemeral=True)
            query = (
                "INSERT INTO public.level_roles (guild_id, level, role_id, guild_name, role_name) "
                "VALUES ($1, $2, $3, $4, $5) "
                "ON CONFLICT (guild_id, level) DO UPDATE SET role_id = $3, role_name = $5"
            )
            await self.pool.execute(
                query,
                str(interaction.guild.id),
                level,
                str(role.id),
                interaction.guild.name,
                role.name,
            )
            await interaction.followup.send(
                f"✅ Reward set: Users reaching Level {level} will now receive the {role.mention} role.",
                ephemeral=True,
            )

        @self.bot.tree.command(
            name="l4-level-reward-show",
            description="Show configured level rewards in this server.",
        )
        @app_commands.checks.has_permissions(view_audit_log=True)
        async def level_reward_show(interaction: discord.Interaction):
            """
            Show a list of all configured level-role rewards in this guild.
            """
            await interaction.response.defer(ephemeral=True)
            rewards = await self.pool.fetch(
                "SELECT level, role_id, role_name FROM public.level_roles WHERE guild_id = $1 ORDER BY level DESC",
                str(interaction.guild.id),
            )
            if not rewards:
                await interaction.followup.send(
                    "❌ No level rewards are configured for this server.",
                    ephemeral=True,
                )
                return

            description = "Here are the role rewards for reaching specific levels:\n"
            for row in rewards:
                role = interaction.guild.get_role(int(row["role_id"]))
                level_info = f"\n**Level {row['level']}** → "
                if role:
                    description += level_info + role.mention
                else:
                    role_name = row["role_name"]
                    description += level_info + f"`{role_name}` (Deleted)"

            embed = discord.Embed(
                title="🏅 Level Rewards",
                description=description,
                color=discord.Color.gold(),
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

        @self.bot.tree.command(
            name="l5-notify-level-msg",
            description="Set a channel for level-up messages.",
        )
        @app_commands.checks.has_permissions(manage_channels=True)
        async def notify_level_msg(
            interaction: discord.Interaction, channel: discord.TextChannel
        ):
            """
            Configure the channel where level-up announcements are sent.
            """
            await interaction.response.defer(ephemeral=True)
            query = (
                "INSERT INTO public.level_notify_channel (guild_id, channel_id, guild_name, channel_name) "
                "VALUES ($1, $2, $3, $4) ON CONFLICT (guild_id) DO UPDATE SET channel_id = $2, channel_name = $4"
            )

            await self.pool.execute(
                query,
                str(interaction.guild.id),
                str(channel.id),
                interaction.guild.name,
                channel.name,
            )
            await interaction.followup.send(
                f"✅ Level-up messages will now be sent in {channel.mention}.",
                ephemeral=True,
            )

        @self.bot.tree.command(
            name="l6-xp-settings",
            description="Configure XP rates for messages, images, and voice.",
        )
        @app_commands.checks.has_permissions(administrator=True)
        @app_commands.describe(
            xp_per_message="XP per text message (default: 5)",
            xp_per_image="XP per image attachment (default: 10)",
            xp_cooldown="Seconds between XP gain (default: 60)",
            voice_xp_per_minute="XP per minute in voice (default: 15)",
        )
        async def xp_settings(
            interaction: discord.Interaction,
            xp_per_message: int = None,
            xp_per_image: int = None,
            xp_cooldown: int = None,
            voice_xp_per_minute: int = None,
        ):
            """
            Adjust XP gain parameters for the guild.

            Any combination of settings may be updated in a single call.
            """
            await interaction.response.defer(ephemeral=True)
            guild_id = str(interaction.guild.id)

            fields = []
            values = []
            param_idx = 1

            if xp_per_message is not None:
                fields.append(f"xp_per_message = ${param_idx}")
                values.append(xp_per_message)
                param_idx += 1
            if xp_per_image is not None:
                fields.append(f"xp_per_image = ${param_idx}")
                values.append(xp_per_image)
                param_idx += 1
            if xp_cooldown is not None:
                fields.append(f"xp_cooldown = ${param_idx}")
                values.append(xp_cooldown)
                param_idx += 1
            if voice_xp_per_minute is not None:
                fields.append(f"xp_per_minute_in_voice = ${param_idx}")
                values.append(voice_xp_per_minute)
                param_idx += 1

            if not fields:
                await interaction.followup.send(
                    "⚠️ You didn't provide any settings to change.", ephemeral=True
                )
                return

            values.append(guild_id)
            query = (
                f"UPDATE public.guild_settings SET {', '.join(fields)} "
                f"WHERE guild_id = ${param_idx}"
            )

            await self.pool.execute(
                "INSERT INTO public.guild_settings (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING",
                guild_id,
            )

            await self.pool.execute(query, *values)

            if interaction.guild.id in self.settings_cache:
                del self.settings_cache[interaction.guild.id]

            await interaction.followup.send(
                "✅ XP Settings updated successfully!", ephemeral=True
            )

        @self.bot.tree.command(
            name="l7-level-config",
            description="Configure system behavior (message style, role stacking, etc).",
        )
        @app_commands.checks.has_permissions(administrator=True)
        @app_commands.choices(
            message_style=[
                app_commands.Choice(name="Rich Embed", value="embed"),
                app_commands.Choice(name="Simple Text", value="simple"),
                app_commands.Choice(name="Minimal", value="minimal"),
            ]
        )
        @app_commands.describe(
            message_style="How the level-up message looks",
            stack_roles="Keep previous role rewards (default: True)",
            announce_roles="Announce new roles in message (default: True)",
        )
        async def level_config(
            interaction: discord.Interaction,
            message_style: app_commands.Choice[str] = None,
            stack_roles: bool = None,
            announce_roles: bool = None,
        ):
            """
            Configure level system UX and role behavior.

            Options
            -------
            - Message style (embed/simple/minimal).
            - Role stacking (keep older reward roles).
            - Whether new roles are called out in level-up messages.
            """
            await interaction.response.defer(ephemeral=True)
            guild_id = str(interaction.guild.id)

            fields = []
            values = []
            param_idx = 1

            if message_style is not None:
                fields.append(f"message_style = ${param_idx}")
                values.append(message_style.value)
                param_idx += 1
            if stack_roles is not None:
                fields.append(f"stack_role_rewards = ${param_idx}")
                values.append(stack_roles)
                param_idx += 1
            if announce_roles is not None:
                fields.append(f"announce_role_rewards = ${param_idx}")
                values.append(announce_roles)
                param_idx += 1

            if not fields:
                await interaction.followup.send(
                    "⚠️ No changes provided.", ephemeral=True
                )
                return

            values.append(guild_id)
            query = (
                f"UPDATE public.level_system_config SET {', '.join(fields)}, "
                f"updated_at = NOW() WHERE guild_id = ${param_idx}"
            )

            await self.pool.execute(
                """INSERT INTO public.level_system_config (guild_id, message_style, stack_role_rewards, announce_role_rewards) 
                   VALUES ($1, 'embed', TRUE, TRUE) ON CONFLICT (guild_id) DO NOTHING""",
                guild_id,
            )

            await self.pool.execute(query, *values)
            await interaction.followup.send(
                "✅ Level System Configuration updated!", ephemeral=True
            )

        @self.bot.tree.command(
            name="l13-level-custom-msg",
            description="Set custom level-up messages.",
        )
        @app_commands.checks.has_permissions(administrator=True)
        @app_commands.choices(
            type=[
                app_commands.Choice(name="Normal Message", value="normal"),
                app_commands.Choice(name="With Role Reward", value="role"),
            ]
        )
        @app_commands.describe(
            type="Which message to edit",
            message="The message using {user}, {level}, {role} placeholders",
        )
        async def level_custom_msg(
            interaction: discord.Interaction,
            type: app_commands.Choice[str],
            message: str,
        ):
            """
            Configure custom level-up templates.

            Placeholders
            ------------
            - {user} : User mention
            - {level}: New level number
            - {role} : Role name (for role message)
            - {xp}   : Reserved for future XP usage
            """
            await interaction.response.defer(ephemeral=True)
            guild_id = str(interaction.guild.id)

            column = (
                "custom_message"
                if type.value == "normal"
                else "custom_message_role_reward"
            )

            query = f"""
                INSERT INTO public.level_system_config (guild_id, {column}) 
                VALUES ($1, $2)
                ON CONFLICT (guild_id) DO UPDATE SET
                {column} = $2, updated_at = NOW()
            """

            await self.pool.execute(query, guild_id, message)
            await interaction.followup.send(
                f"✅ Custom {type.name} updated!\n**Preview:** {message}",
                ephemeral=True,
            )

        @self.bot.tree.command(
            name="l14-level-auto-reset",
            description="Configure automatic XP resets.",
        )
        @app_commands.checks.has_permissions(administrator=True)
        @app_commands.describe(
            days="Reset every X days (0 to disable)",
            remove_roles="Also remove reward roles when resetting (default: True)",
        )
        async def level_auto_reset(
            interaction: discord.Interaction,
            days: int,
            remove_roles: bool = True,
        ):
            """
            Configure periodic automatic XP resets for the guild.

            Parameters
            ----------
            days : int
                Interval between resets (0 disables auto-reset).
            remove_roles : bool, optional
                Whether to remove reward roles as part of the reset.
            """
            await interaction.response.defer(ephemeral=True)
            guild_id = str(interaction.guild.id)

            if days <= 0:
                await self.pool.execute(
                    "DELETE FROM public.auto_reset WHERE guild_id = $1", guild_id
                )
                await interaction.followup.send(
                    "✅ Auto-reset disabled.", ephemeral=True
                )
                return

            await self.pool.execute(
                """
                INSERT INTO public.auto_reset (guild_id, days, remove_roles, last_reset)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (guild_id) DO UPDATE SET
                days = $2, remove_roles = $3
                """,
                guild_id,
                days,
                remove_roles,
            )

            msg = f"✅ Auto-reset set to every {days} days."
            msg += (
                " (Roles will be removed)" if remove_roles else " (Roles will be kept)"
            )
            await interaction.followup.send(msg, ephemeral=True)

        @self.bot.tree.command(
            name="l9-reset-xp",
            description="MANUALLY reset all XP and remove reward roles.",
        )
        @app_commands.checks.has_permissions(administrator=True)
        async def reset_xp(interaction: discord.Interaction):
            """
            Manually perform a full XP reset (including reward roles).
            """
            await interaction.response.defer(thinking=True, ephemeral=False)
            roles_removed, users_affected = await self._perform_full_reset(
                interaction.guild
            )
            await interaction.followup.send(
                f"♻️ **Manual XP Reset Complete!**\n"
                f"- All user XP and levels have been reset to 0.\n"
                f"- Removed {roles_removed} reward roles from {users_affected} users."
            )

        @self.bot.tree.command(
            name="l10-upgrade-all-roles",
            description="Manually sync roles for all users based on their current level.",
        )
        @app_commands.checks.has_permissions(manage_roles=True)
        async def upgrade_all_roles(interaction: discord.Interaction):
            """
            Synchronize level-based roles for all users in the guild.

            Useful when changing reward thresholds or after importing data.
            """
            await interaction.response.defer(thinking=True, ephemeral=True)
            users_data = await self.pool.fetch(
                "SELECT user_id, level FROM public.users WHERE guild_id = $1",
                str(interaction.guild.id),
            )
            if not users_data:
                await interaction.followup.send(
                    "No users found in the database for this server."
                )
                return

            changed_count = 0
            for user in users_data:
                member = interaction.guild.get_member(int(user["user_id"]))
                if member:
                    if await self.upgrade_user_roles(member, user["level"]):
                        changed_count += 1

            await interaction.followup.send(
                f"🔄 Role synchronization complete! Updated roles for {changed_count} member(s).",
                ephemeral=True,
            )

        log.info("💻 Leveling commands registered.")
