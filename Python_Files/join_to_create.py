# v5.0.0
# v4.0.0
"""
Join-to-Create Voice Channel System

This module implements a temporary voice channel creation system where users
can join a designated "trigger" channel to automatically create their own
temporary voice channel.

Key Features:
- Automatic temporary channel creation when joining trigger channel
- Configurable deletion delay for empty channels
- Anti-abuse protections (cooldowns, rate limiting)
- Analytics tracking (channel lifetime, max users)
- Restart safety (cleanup orphaned channels)
- Integration with existing LevelManager for XP tracking

Responsibilities:
- Detect joins to trigger channels
- Create and manage temporary voice channels
- Track channel lifecycle for analytics
- Provide helper methods for LevelManager to check channel types
"""

import discord
from discord import app_commands
from discord.ext import commands
import asyncpg
import logging
from datetime import datetime, timedelta, timezone
import asyncio
from typing import Optional, Dict, Tuple
from voice_control import VoiceControlView

log = logging.getLogger(__name__)


class JoinToCreateManager:
    """
    Manages the Join-to-Create temporary voice channel system.
    
    This manager handles:
    - Trigger channel detection and temp channel creation
    - Channel deletion scheduling
    - User cooldowns and rate limiting
    - Analytics tracking
    - Restart safety and orphan cleanup
    
    Attributes
    ----------
    bot : commands.Bot
        The main Discord bot instance.
    pool : asyncpg.Pool
        PostgreSQL connection pool for persistence.
    config_cache : dict
        Cached guild configurations {guild_id: (config, timestamp)}.
    user_cooldowns : dict
        User cooldown tracking {(guild_id, user_id): timestamp}.
    deletion_tasks : dict
        Scheduled deletion tasks {channel_id: asyncio.Task}.
    temp_channels : dict
        Active temp channels {channel_id: creation_timestamp}.
    """
    
    def __init__(self, bot: commands.Bot, pool: asyncpg.Pool):
        """
        Initialize the JoinToCreateManager.
        
        Parameters
        ----------
        bot : commands.Bot
            The main Discord bot instance.
        pool : asyncpg.Pool
            PostgreSQL connection pool.
        """
        self.bot = bot
        self.pool = pool
        
        # Caching
        self.config_cache: Dict[int, Tuple[dict, float]] = {}
        self.CACHE_DURATION = 300  # 5 minutes
        
        # Anti-abuse
        self.user_cooldowns: Dict[Tuple[int, int], datetime] = {}
        self.guild_rate_limits: Dict[int, list] = {}  # {guild_id: [timestamps]}
        
        # Channel tracking
        self.deletion_tasks: Dict[int, asyncio.Task] = {}
        self.temp_channels: Dict[int, datetime] = {}  # {channel_id: created_at}
        
        log.info("✅ JoinToCreateManager initialized")
    
    async def start(self):
        """
        Start the Join-to-Create system.
        
        Registers event listeners and performs startup cleanup.
        """
        self.bot.add_listener(self.on_voice_state_update, "on_voice_state_update")
        self.bot.add_listener(self.on_guild_channel_delete, "on_guild_channel_delete")
        
        # Schema check
        await self.ensure_schema()
        
        # Cleanup orphaned channels on startup
        await self.cleanup_orphaned_channels()
        
        log.info("🎙️ Join-to-Create system started")
    
    async def stop(self):
        """
        Stop the Join-to-Create system.
        
        Cancels all pending deletion tasks.
        """
        # Cancel all pending deletion tasks
        for task in self.deletion_tasks.values():
            if not task.done():
                task.cancel()
        
        log.info("🛑 Join-to-Create system stopped")
    
    # ==========================
    # Configuration Management
    # ==========================
    
    async def get_guild_config(self, guild_id: int) -> Optional[dict]:
        """
        Retrieve Join-to-Create configuration for a guild, with caching.
        
        Parameters
        ----------
        guild_id : int
            The ID of the guild.
        
        Returns
        -------
        dict | None
            Configuration dictionary or None if not configured.
        """
        import time
        now = time.time()
        
        # Check cache
        if guild_id in self.config_cache:
            config, timestamp = self.config_cache[guild_id]
            if now - timestamp < self.CACHE_DURATION:
                return config
        
        # Fetch from database
        async with self.pool.acquire() as conn:
            config_record = await conn.fetchrow(
                """SELECT * FROM public.join_to_create_config 
                   WHERE guild_id = $1 AND enabled = TRUE""",
                str(guild_id)
            )
        
        if config_record:
            config = dict(config_record)
            self.config_cache[guild_id] = (config, now)
            return config
        
        return None
    
    def invalidate_config_cache(self, guild_id: int):
        """
        Invalidate cached configuration for a guild.
        
        Parameters
        ----------
        guild_id : int
            The ID of the guild.
        """
        if guild_id in self.config_cache:
            del self.config_cache[guild_id]
    
    # ==========================
    # Channel Type Helpers (for LevelManager)
    # ==========================
    
    async def is_trigger_channel(self, channel_id: int) -> bool:
        """
        Check if a channel is a Join-to-Create trigger channel.
        
        This method is used by LevelManager to determine if XP should be awarded.
        
        Parameters
        ----------
        channel_id : int
            The ID of the voice channel.
        
        Returns
        -------
        bool
            True if the channel is a trigger channel, False otherwise.
        """
        async with self.pool.acquire() as conn:
            result = await conn.fetchval(
                """SELECT EXISTS(
                    SELECT 1 FROM public.join_to_create_config 
                    WHERE trigger_channel_id = $1 AND enabled = TRUE
                )""",
                str(channel_id)
            )
        return result or False
    
    async def is_temp_channel(self, channel_id: int) -> bool:
        """
        Check if a channel is a temporary voice channel.
        
        This method is used by LevelManager to determine if XP should be awarded.
        
        Parameters
        ----------
        channel_id : int
            The ID of the voice channel.
        
        Returns
        -------
        bool
            True if the channel is a temp channel, False otherwise.
        """
        # Check in-memory cache first (fast path)
        if channel_id in self.temp_channels:
            return True
        
        # Check database (for channels created before bot restart)
        async with self.pool.acquire() as conn:
            result = await conn.fetchval(
                """SELECT EXISTS(
                    SELECT 1 FROM public.voice_temp_channels 
                    WHERE channel_id = $1 AND deleted_at IS NULL
                )""",
                str(channel_id)
            )
        return result or False
    
    # ==========================
    # Anti-Abuse Protections
    # ==========================
    
    def check_user_cooldown(self, user_id: int, guild_id: int, cooldown_seconds: int) -> bool:
        """
        Check if a user is on cooldown for channel creation.
        
        Parameters
        ----------
        user_id : int
            The ID of the user.
        guild_id : int
            The ID of the guild.
        cooldown_seconds : int
            Cooldown duration in seconds.
        
        Returns
        -------
        bool
            True if user can create a channel, False if on cooldown.
        """
        key = (guild_id, user_id)
        now = datetime.now(timezone.utc)
        
        if key in self.user_cooldowns:
            last_creation = self.user_cooldowns[key]
            if (now - last_creation).total_seconds() < cooldown_seconds:
                return False
        
        # Update cooldown
        self.user_cooldowns[key] = now
        return True
    
    def check_guild_rate_limit(self, guild_id: int, max_per_minute: int = 5) -> bool:
        """
        Check if guild has exceeded rate limit for channel creation.
        
        Parameters
        ----------
        guild_id : int
            The ID of the guild.
        max_per_minute : int
            Maximum channels allowed per minute.
        
        Returns
        -------
        bool
            True if within rate limit, False if exceeded.
        """
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(minutes=1)
        
        # Initialize or clean up old timestamps
        if guild_id not in self.guild_rate_limits:
            self.guild_rate_limits[guild_id] = []
        
        # Remove timestamps older than 1 minute
        self.guild_rate_limits[guild_id] = [
            ts for ts in self.guild_rate_limits[guild_id] if ts > cutoff
        ]
        
        # Check rate limit
        if len(self.guild_rate_limits[guild_id]) >= max_per_minute:
            return False
        
        # Add current timestamp
        self.guild_rate_limits[guild_id].append(now)
        return True
    
    # ==========================
    # Event Handlers
    # ==========================
    
    async def on_voice_state_update(
        self,
        member: discord.Member,
        before: discord.VoiceState,
        after: discord.VoiceState
    ):
        """
        Handle voice state updates for Join-to-Create functionality.
        
        Detects:
        - Joins to trigger channels (create temp channel)
        - Leaves from temp channels (schedule deletion if empty)
        
        Parameters
        ----------
        member : discord.Member
            The member whose voice state changed.
        before : discord.VoiceState
            Voice state before the change.
        after : discord.VoiceState
            Voice state after the change.
        """
        if member.bot:
            return
        
        guild = member.guild
        
        # Handle join to trigger channel
        if after.channel and after.channel != before.channel:
            config = await self.get_guild_config(guild.id)
            if config and str(after.channel.id) == config['trigger_channel_id']:
                await self.handle_trigger_join(member, config)
        
        # Handle leave from temp channel
        if before.channel and before.channel != after.channel:
            if before.channel.id in self.temp_channels:
                await self.handle_temp_channel_leave(before.channel)
    

    async def handle_trigger_join(self, member: discord.Member, config: dict):
        """
        Handle a user joining the trigger channel.
        
        Creates a temporary voice channel (Private or Public) and moves the user into it.
        """
        guild = member.guild
        
        # Check user cooldown
        cooldown_seconds = config.get('user_cooldown_seconds', 10)
        if not self.check_user_cooldown(member.id, guild.id, cooldown_seconds):
            log.info(f"⏳ User {member.name} on cooldown in {guild.name}")
            # Optional: Move user out if they spam join? For now just ignore.
            return
        
        # Check guild rate limit
        if not self.check_guild_rate_limit(guild.id):
            log.warning(f"⚠️ Guild {guild.name} exceeded rate limit for temp channel creation")
            return
        
        # Determine Channel Type (Private vs Public)
        private_role_id = config.get('private_vc_role_id')
        force_private = config.get('force_private', False)
        is_private = force_private
        
        if not is_private and private_role_id:
            try:
                role = guild.get_role(int(private_role_id))
                if role and role in member.roles:
                    is_private = True
            except (ValueError, TypeError):
                pass
        
        try:
            category_id = int(config['category_id'])
            category = guild.get_channel(category_id)
            
            if not category or not isinstance(category, discord.CategoryChannel):
                log.error(f"❌ Category {category_id} not found in {guild.name}")
                return
            
            # Create the channel
            channel_name = f"{member.display_name}'s Channel"
            
            overwrites = {
                guild.default_role: discord.PermissionOverwrite(connect=True, view_channel=True),
                guild.me: discord.PermissionOverwrite(connect=True, manage_channels=True, move_members=True)
            }
            
            if is_private:
                # Private VC overrides
                # @everyone: View=True, Connect=False
                overwrites[guild.default_role] = discord.PermissionOverwrite(connect=False, view_channel=True)
                # Owner: Connect=True, Speak=True, Manage=True (Proxied via Bot mostly, but give connect)
                overwrites[member] = discord.PermissionOverwrite(connect=True, speak=True, move_members=True, mute_members=True)
                channel_name = f"🔒 {member.display_name}'s Private"

            temp_channel = await guild.create_voice_channel(
                name=channel_name,
                category=category,
                overwrites=overwrites,
                reason=f"Join-to-Create: {member.name} joined trigger channel ({'Private' if is_private else 'Public'})"
            )
            
            log.info(f"✅ Created temp channel '{channel_name}' in {guild.name}")
            
            # Track in memory
            self.temp_channels[temp_channel.id] = datetime.now(timezone.utc)
            
            # Insert into database
            async with self.pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO public.voice_temp_channels 
                       (guild_id, channel_id, trigger_channel_id, category_id, creator_user_id, creator_username, created_at, is_private, owner_user_id, owner_username)
                       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9)""",
                    str(guild.id),
                    str(temp_channel.id),
                    config['trigger_channel_id'],
                    config['category_id'],
                    str(member.id),
                    member.name,
                    is_private,
                    str(member.id) if is_private else None,
                    member.name if is_private else None
                )
            
            # Move user to temp channel
            try:
                await member.move_to(temp_channel, reason="Join-to-Create: Moving to temp channel")
                
                # If Private, send Control Panel
                if is_private:
                    # VoiceControlView is now imported globally
                    view = VoiceControlView(self.bot, self.pool, member.id)
                    embed = discord.Embed(
                        title="🔒 Private Voice Controls",
                        description=f"Welcome {member.mention}! You are the owner of this channel.\nUse the buttons below to manage permissions.",
                        color=discord.Color.gold()
                    )
                    await temp_channel.send(member.mention, embed=embed, view=view)

            except discord.HTTPException as e:
                log.error(f"❌ Failed to move {member.name} to temp channel: {e}")
                await temp_channel.delete(reason="Failed to move user")
                del self.temp_channels[temp_channel.id]
        
        except discord.Forbidden:
            log.error(f"❌ Missing permissions to create voice channel in {guild.name}")
        except Exception as e:
            log.error(f"❌ Error creating temp channel: {e}")

    async def ensure_schema(self):
        """
        Auto-migrate database schema to support Private VCs.
        """
        log.info("🛠️ Checking database schema for Private VC extensions...")
        async with self.pool.acquire() as conn:
            # 1. voice_temp_channels extensions
            await conn.execute("""
                ALTER TABLE public.voice_temp_channels 
                ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS owner_user_id TEXT,
                ADD COLUMN IF NOT EXISTS owner_username TEXT,
                ADD COLUMN IF NOT EXISTS max_concurrent_users INT DEFAULT 0;
            """)
            
            # 2. config extensions
            await conn.execute("""
                ALTER TABLE public.join_to_create_config
                ADD COLUMN IF NOT EXISTS private_vc_role_id TEXT,
                ADD COLUMN IF NOT EXISTS force_private BOOLEAN DEFAULT FALSE,
                ADD COLUMN IF NOT EXISTS min_session_minutes INT DEFAULT 0;
            """)
            
            # 3. Create permission table
            await conn.execute("""
                 CREATE TABLE IF NOT EXISTS public.voice_channel_permissions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    guild_id TEXT NOT NULL,
                    channel_id TEXT NOT NULL,
                    target_type TEXT NOT NULL CHECK (target_type IN ('user', 'role')),
                    target_id TEXT NOT NULL,
                    permission TEXT NOT NULL CHECK (permission IN ('connect', 'view', 'speak')),
                    granted_by TEXT NOT NULL,
                    granted_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(channel_id, target_id, permission)
                );
            """)
        log.info("✅ Database schema verified.")
    
    async def handle_temp_channel_leave(self, channel: discord.VoiceChannel):
        """
        Handle a user leaving a temp channel.
        
        If the channel is empty, schedule it for deletion.
        
        Parameters
        ----------
        channel : discord.VoiceChannel
            The temp channel that was left.
        """
        # Cancel existing deletion task if any
        if channel.id in self.deletion_tasks:
            task = self.deletion_tasks[channel.id]
            if not task.done():
                task.cancel()
            del self.deletion_tasks[channel.id]
        
        # Check if channel is empty
        if len(channel.members) == 0:
            # Get config for deletion delay
            config = await self.get_guild_config(channel.guild.id)
            delay_seconds = config.get('delete_delay_seconds', 20) if config else 20
            
            # Schedule deletion
            task = asyncio.create_task(
                self.schedule_channel_deletion(channel.id, delay_seconds)
            )
            self.deletion_tasks[channel.id] = task
    
    async def schedule_channel_deletion(self, channel_id: int, delay_seconds: int):
        """
        Schedule a temp channel for deletion after a delay.
        
        Parameters
        ----------
        channel_id : int
            The ID of the channel to delete.
        delay_seconds : int
            Delay in seconds before deletion.
        """
        try:
            await asyncio.sleep(delay_seconds)
            
            # Get the channel
            channel = self.bot.get_channel(channel_id)
            if not channel:
                log.warning(f"⚠️ Channel {channel_id} not found for deletion")
                return
            
            # Double-check it's still empty
            if len(channel.members) > 0:
                log.info(f"🔄 Channel {channel.name} no longer empty, canceling deletion")
                return
            
            # Calculate lifetime
            created_at = self.temp_channels.get(channel_id)
            if created_at:
                lifetime_seconds = int((datetime.now(timezone.utc) - created_at).total_seconds())
            else:
                lifetime_seconds = 0
            
            # Update database
            async with self.pool.acquire() as conn:
                await conn.execute(
                    """UPDATE public.voice_temp_channels 
                       SET deleted_at = NOW(), total_lifetime_seconds = $2
                       WHERE channel_id = $1""",
                    str(channel_id),
                    lifetime_seconds
                )
            
            # Delete the channel
            await channel.delete(reason="Join-to-Create: Channel empty")
            log.info(f"🗑️ Deleted temp channel {channel.name} after {lifetime_seconds}s")
            
            # Clean up tracking
            if channel_id in self.temp_channels:
                del self.temp_channels[channel_id]
            if channel_id in self.deletion_tasks:
                del self.deletion_tasks[channel_id]
        
        except asyncio.CancelledError:
            log.info(f"⏹️ Deletion task for channel {channel_id} was cancelled")
        except Exception as e:
            log.error(f"❌ Error deleting temp channel {channel_id}: {e}")
    
    async def on_guild_channel_delete(self, channel: discord.abc.GuildChannel):
        """
        Handle manual deletion of temp channels by admins.
        
        Parameters
        ----------
        channel : discord.abc.GuildChannel
            The channel that was deleted.
        """
        if not isinstance(channel, discord.VoiceChannel):
            return
        
        if channel.id in self.temp_channels:
            # Calculate lifetime
            created_at = self.temp_channels[channel.id]
            lifetime_seconds = int((datetime.now(timezone.utc) - created_at).total_seconds())
            
            # Update database
            async with self.pool.acquire() as conn:
                await conn.execute(
                    """UPDATE public.voice_temp_channels 
                       SET deleted_at = NOW(), total_lifetime_seconds = $2
                       WHERE channel_id = $1 AND deleted_at IS NULL""",
                    str(channel.id),
                    lifetime_seconds
                )
            
            # Clean up tracking
            self.temp_channels.pop(channel.id, None)
            if channel.id in self.deletion_tasks:
                task = self.deletion_tasks[channel.id]
                if not task.done():
                    task.cancel()
                del self.deletion_tasks[channel.id]
            
            log.info(f"🗑️ Temp channel {channel.name} was manually deleted")
    
    # ==========================
    # Restart Safety
    # ==========================
    
    async def cleanup_orphaned_channels(self):
        """
        Clean up orphaned temp channels on bot startup.
        
        Queries the database for temp channels that weren't properly deleted,
        checks if they still exist in Discord, and cleans them up.
        """
        log.info("🧹 Cleaning up orphaned temp channels...")
        
        async with self.pool.acquire() as conn:
            orphaned = await conn.fetch(
                """SELECT guild_id, channel_id, created_at 
                   FROM public.voice_temp_channels 
                   WHERE deleted_at IS NULL"""
            )
        
        cleaned_count = 0
        resumed_count = 0
        
        for record in orphaned:
            guild_id = int(record['guild_id'])
            channel_id = int(record['channel_id'])
            created_at = record['created_at']
            
            guild = self.bot.get_guild(guild_id)
            if not guild:
                # Guild not found, mark as deleted
                async with self.pool.acquire() as conn:
                    await conn.execute(
                        """UPDATE public.voice_temp_channels 
                           SET deleted_at = NOW() 
                           WHERE channel_id = $1""",
                        str(channel_id)
                    )
                cleaned_count += 1
                continue
            
            channel = guild.get_channel(channel_id)
            if not channel:
                # Channel doesn't exist, mark as deleted
                async with self.pool.acquire() as conn:
                    await conn.execute(
                        """UPDATE public.voice_temp_channels 
                           SET deleted_at = NOW() 
                           WHERE channel_id = $1""",
                        str(channel_id)
                    )
                cleaned_count += 1
                continue
            
            # Channel exists, check if empty
            if len(channel.members) == 0:
                # Delete empty channel
                try:
                    await channel.delete(reason="Join-to-Create: Orphaned empty channel cleanup")
                    lifetime_seconds = int((datetime.now(timezone.utc) - created_at).total_seconds())
                    async with self.pool.acquire() as conn:
                        await conn.execute(
                            """UPDATE public.voice_temp_channels 
                               SET deleted_at = NOW(), total_lifetime_seconds = $2
                               WHERE channel_id = $1""",
                            str(channel_id),
                            lifetime_seconds
                        )
                    cleaned_count += 1
                except Exception as e:
                    log.error(f"❌ Failed to delete orphaned channel {channel_id}: {e}")
            else:
                # Channel has users, resume tracking
                self.temp_channels[channel_id] = created_at
                resumed_count += 1
        
        log.info(f"✅ Cleanup complete: {cleaned_count} deleted, {resumed_count} resumed")
    
    # ==========================
    # Slash Commands
    # ==========================
    
    def register_commands(self):
        """
        Register all Join-to-Create slash commands.
        """
        
        @self.bot.tree.command(
            name="v1-setup",
            description="Configure Join-to-Create voice channel system"
        )
        @app_commands.describe(
            trigger_channel="Voice channel that triggers temp channel creation",
            category="Category where temp channels will be created",
            delete_delay="Seconds to wait before deleting empty channels (default: 20)",
            user_cooldown="Cooldown per user in seconds (default: 10)",
            private_role="Optional role that automatically creates private voice channels",
            force_private="If True, all created voice channels will be private",
            min_session="Minimum session duration in minutes for analytics tracking"
        )
        @app_commands.checks.has_permissions(administrator=True)
        async def jtc_setup(
            interaction: discord.Interaction,
            trigger_channel: discord.VoiceChannel,
            category: discord.CategoryChannel,
            delete_delay: int = 20,
            user_cooldown: int = 10,
            private_role: Optional[discord.Role] = None,
            force_private: bool = False,
            min_session: int = 0
        ):
            """Configure the Join-to-Create system for this server."""
            await interaction.response.defer(ephemeral=True)
            
            try:
                # Validate inputs
                if not (0 <= delete_delay <= 300):
                    await interaction.followup.send("❌ Delete delay must be between 0 and 300 seconds.", ephemeral=True)
                    return
                
                if not (0 <= user_cooldown <= 60):
                    await interaction.followup.send("❌ User cooldown must be between 0 and 60 seconds.", ephemeral=True)
                    return
                

                
                # Save configuration
                async with self.pool.acquire() as conn:
                    await conn.execute(
                        """INSERT INTO public.join_to_create_config 
                           (guild_id, trigger_channel_id, category_id, enabled, delete_delay_seconds, user_cooldown_seconds, private_vc_role_id, force_private, min_session_minutes)
                           VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7, $8)
                           ON CONFLICT (guild_id) 
                           DO UPDATE SET 
                               trigger_channel_id = $2,
                               category_id = $3,
                               enabled = TRUE,
                               delete_delay_seconds = $4,
                               user_cooldown_seconds = $5,
                               private_vc_role_id = $6,
                               force_private = $7,
                               min_session_minutes = $8,
                               updated_at = NOW()""",
                        str(interaction.guild.id),
                        str(trigger_channel.id),
                        str(category.id),
                        delete_delay,
                        user_cooldown,
                        str(private_role.id) if private_role else None,
                        force_private,
                        min_session
                    )
                
                # Invalidate cache
                self.invalidate_config_cache(interaction.guild.id)
                
                # Send confirmation
                embed = discord.Embed(
                    title="✅ Join-to-Create System Configured",
                    description="The system is now active!",
                    color=discord.Color.green()
                )
                embed.add_field(name="Trigger Channel", value=trigger_channel.mention, inline=False)
                embed.add_field(name="Category", value=category.name, inline=False)
                embed.add_field(name="Delete Delay", value=f"{delete_delay} seconds", inline=True)
                embed.add_field(name="User Cooldown", value=f"{user_cooldown} seconds", inline=True)
                embed.add_field(name="Private Role", value=private_role.mention if private_role else "None", inline=True)
                embed.add_field(name="Force Private?", value="Yes" if force_private else "No", inline=True)
                embed.add_field(name="Min Session", value=f"{min_session} minutes", inline=True)
                
                await interaction.followup.send(embed=embed, ephemeral=True)
                log.info(f"⚙️ Join-to-Create configured for {interaction.guild.name}")
            
            except Exception as e:
                log.error(f"❌ Error configuring Join-to-Create: {e}")
                await interaction.followup.send(f"❌ Error: {e}", ephemeral=True)
        
        @self.bot.tree.command(
            name="v2-disable",
            description="Disable the Join-to-Create system"
        )
        @app_commands.checks.has_permissions(administrator=True)
        async def jtc_disable(interaction: discord.Interaction):
            """Disable the Join-to-Create system for this server."""
            await interaction.response.defer(ephemeral=True)
            
            try:
                async with self.pool.acquire() as conn:
                    result = await conn.execute(
                        """UPDATE public.join_to_create_config 
                           SET enabled = FALSE, updated_at = NOW()
                           WHERE guild_id = $1""",
                        str(interaction.guild.id)
                    )
                
                if result == "UPDATE 0":
                    await interaction.followup.send("❌ Join-to-Create is not configured for this server.", ephemeral=True)
                    return
                
                # Invalidate cache
                self.invalidate_config_cache(interaction.guild.id)
                
                await interaction.followup.send("✅ Join-to-Create system has been disabled.", ephemeral=True)
                log.info(f"🛑 Join-to-Create disabled for {interaction.guild.name}")
            
            except Exception as e:
                log.error(f"❌ Error disabling Join-to-Create: {e}")
                await interaction.followup.send(f"❌ Error: {e}", ephemeral=True)
        
        @self.bot.tree.command(
            name="v3-status",
            description="Show Join-to-Create system status and statistics"
        )
        async def jtc_status(interaction: discord.Interaction):
            """Show the current Join-to-Create configuration and stats."""
            await interaction.response.defer(ephemeral=True)
            
            try:
                config = await self.get_guild_config(interaction.guild.id)
                
                if not config:
                    await interaction.followup.send("❌ Join-to-Create is not configured for this server.", ephemeral=True)
                    return
                
                # Get statistics
                async with self.pool.acquire() as conn:
                    stats = await conn.fetchrow(
                        """SELECT 
                               COUNT(*) as total_channels,
                               COUNT(*) FILTER (WHERE deleted_at IS NULL) as active_channels,
                               AVG(total_lifetime_seconds) FILTER (WHERE deleted_at IS NOT NULL) as avg_lifetime
                           FROM public.voice_temp_channels
                           WHERE guild_id = $1""",
                        str(interaction.guild.id)
                    )
                
                # Build embed
                trigger_channel = interaction.guild.get_channel(int(config['trigger_channel_id']))
                category = interaction.guild.get_channel(int(config['category_id']))
                
                embed = discord.Embed(
                    title="🎙️ Join-to-Create System Status",
                    description="Current configuration and statistics",
                    color=discord.Color.blue()
                )
                
                # Configuration
                embed.add_field(
                    name="Configuration",
                    value=f"**Trigger Channel:** {trigger_channel.mention if trigger_channel else 'Not found'}\n"
                          f"**Category:** {category.name if category else 'Not found'}\n"
                          f"**Delete Delay:** {config['delete_delay_seconds']}s\n"
                          f"**User Cooldown:** {config['user_cooldown_seconds']}s",
                    inline=False
                )
                
                # Statistics
                avg_lifetime_min = int(stats['avg_lifetime'] / 60) if stats['avg_lifetime'] else 0
                embed.add_field(
                    name="Statistics",
                    value=f"**Total Channels Created:** {stats['total_channels']}\n"
                          f"**Active Channels:** {stats['active_channels']}\n"
                          f"**Avg Channel Lifetime:** {avg_lifetime_min} minutes",
                    inline=False
                )
                
                await interaction.followup.send(embed=embed, ephemeral=True)
            
            except Exception as e:
                log.error(f"❌ Error fetching Join-to-Create status: {e}")
                await interaction.followup.send(f"❌ Error: {e}", ephemeral=True)
