# v5.0.0
# v4.0.0
"""
Date & Time (Clock) System Manager.

This module manages dynamic timezone-based clock channels for servers.
It supports:
- Per-guild timezone configurations stored in `public.server_time_configs`.
- Fast, on-demand updates when configuration changes.
- Periodic synchronization of all configured time/date channels.
- Timezone autocompletion and slash commands for setup and removal.
"""

import discord
from discord import app_commands
from discord.ext import tasks, commands
import pytz
from datetime import datetime
import asyncpg
import logging
import asyncio

log = logging.getLogger(__name__)


class DateTimeManager:
    """
    Manages server clock channels showing time/date for configured timezones.

    Responsibilities
    ----------------
    - Maintain voice channel names for time (HH:MM) and date (DD Mon, YYYY).
    - Map timezones to country flags or continent emojis.
    - React quickly to configuration changes (fast update loop).
    - Periodically refresh all configured clock channels (main loop).
    - Expose slash commands to:
      * Create clocks (/t1-setup-clock).
      * List clocks (/t2-list-clocks).
      * Remove clocks (/t3-remove-clock).
    """

    def __init__(self, bot: commands.Bot, pool: asyncpg.Pool):
        """
        Initialize the DateTimeManager.

        Parameters
        ----------
        bot : commands.Bot
            The Discord bot instance.
        pool : asyncpg.Pool
            PostgreSQL connection pool.
        """
        self.bot = bot
        self.pool = pool
        self.all_timezones = pytz.common_timezones

        # Build a timezone -> country_code mapping using pytz.country_timezones.
        # In case of multiple countries, the first one encountered is used.
        self.tz_country_map: dict[str, str] = {}
        try:
            for country_code, tz_list in getattr(pytz, "country_timezones", {}).items():
                for tz in tz_list:
                    if tz not in self.tz_country_map:
                        self.tz_country_map[tz] = country_code.upper()
        except Exception:
            self.tz_country_map = {}

        # Continent-level fallback emojis when no country mapping exists.
        self.continent_emoji = {
            "Africa": "🌍",
            "America": "🌎",
            "Asia": "🌏",
            "Europe": "🌍",
            "Indian": "🌊",
            "Pacific": "🌊",
            "Atlantic": "🌊",
            "Arctic": "❄️",
            "Antarctica": "❄️",
            "Etc": "🕓",
            "UTC": "🕓",
        }

        log.info("Clock system initialized (Instant-Update Mode).")

    # ==========================
    # Lifecycle Management
    # ==========================
    async def start(self):
        """
        Start the background tasks for the DateTimeManager.

        Safe to call multiple times; each loop checks if it is already running.
        """
        # Start fast update loop if not running
        try:
            if not self.fast_update_check.is_running():
                self.fast_update_check.start()
                log.info("Started fast_update_check loop.")
        except RuntimeError:
            log.debug(
                "fast_update_check loop could not be started (already running or runtime state)."
            )

        # Start main update loop if not running
        try:
            if not self.main_update_loop.is_running():
                self.main_update_loop.start()
                log.info("Started main_update_loop.")
        except RuntimeError:
            log.debug(
                "main_update_loop could not be started (already running or runtime state)."
            )

    def stop(self):
        """
        Stop the background tasks for the DateTimeManager.
        """
        if self.fast_update_check.is_running():
            self.fast_update_check.cancel()
        if self.main_update_loop.is_running():
            self.main_update_loop.cancel()
        log.info("DateTimeManager loops stopped.")

    # ==========================
    # Emoji / Flag Utilities
    # ==========================
    @staticmethod
    def country_code_to_flag_emoji(code: str) -> str:
        """
        Convert a 2-letter ISO country code to a flag emoji.

        Parameters
        ----------
        code : str
            2-letter ISO country code (e.g. 'US', 'JP').

        Returns
        -------
        str
            Corresponding flag emoji, or an empty string on failure.
        """
        if not code or len(code) != 2:
            return ""
        code = code.upper()
        try:
            return "".join(chr(127397 + ord(c)) for c in code)
        except Exception:
            return ""

    def emoji_for_timezone(self, tz_name: str) -> str:
        """
        Get the most appropriate emoji for a timezone.

        Resolution order
        ----------------
        1. Specific country flag (if mapped).
        2. Continent-level emoji (by timezone prefix).
        3. Generic clock emoji.

        Parameters
        ----------
        tz_name : str
            Timezone name (e.g. 'Asia/Tokyo').

        Returns
        -------
        str
            Emoji to represent the timezone.
        """
        if not tz_name:
            return "🕒"

        country = self.tz_country_map.get(tz_name)
        if country:
            flag = self.country_code_to_flag_emoji(country)
            if flag:
                return flag

        continent = tz_name.split("/")[0] if "/" in tz_name else tz_name
        emoji = self.continent_emoji.get(continent)
        if emoji:
            return emoji

        return "🕒"

    # ==========================
    # Core Update Logic
    # ==========================
    async def _update_channels_for_config(self, config):
        """
        Calculate current time/date for a timezone and update its channels.

        Parameters
        ----------
        config : asyncpg.Record or dict
            A configuration row from `public.server_time_configs` including:
            - guild_id
            - timezone
            - time_channel_id
            - date_channel_id (optional)
        """
        guild_id = int(config["guild_id"])
        tz_name = config["timezone"]

        try:
            # Localized current datetime
            zone = pytz.timezone(tz_name)
            now = datetime.now(zone)

            time_str = now.strftime("%H:%M")
            date_str = now.strftime("%d %b, %Y")

            flag = self.emoji_for_timezone(tz_name)

            time_prefix = f"{flag} 🕒" if flag else "🕒"
            date_prefix = f"{flag} 📅" if flag else "📅"

            guild = self.bot.get_guild(guild_id)
            if not guild:
                return

            # Update time channel
            if config.get("time_channel_id"):
                ch_id = int(config["time_channel_id"])
                channel = guild.get_channel(ch_id)
                if channel:
                    new_name = f"{time_prefix} {time_str}"
                    if channel.name != new_name:
                        try:
                            await channel.edit(name=new_name)
                            log.debug(f"Updated Time Channel {ch_id} -> {new_name}")
                        except discord.Forbidden:
                            log.warning(
                                f"Missing permission to edit time channel {ch_id} in guild {guild_id}"
                            )
                        except Exception as e:
                            log.error(
                                f"Failed to update time channel {ch_id} in guild {guild_id}: {e}"
                            )

            # Update date channel
            if config.get("date_channel_id"):
                ch_id = int(config["date_channel_id"])
                channel = guild.get_channel(ch_id)
                if channel:
                    new_name = f"{date_prefix} {date_str}"
                    if channel.name != new_name:
                        try:
                            await channel.edit(name=new_name)
                            log.debug(f"Updated Date Channel {ch_id} -> {new_name}")
                        except discord.Forbidden:
                            log.warning(
                                f"Missing permission to edit date channel {ch_id} in guild {guild_id}"
                            )
                        except Exception as e:
                            log.error(
                                f"Failed to update date channel {ch_id} in guild {guild_id}: {e}"
                            )

        except discord.Forbidden:
            log.warning(f"Missing permission to edit channels in guild {guild_id}")
        except Exception as e:
            log.error(f"Error updating config {config.get('id')}: {e}")

    # ==========================
    # Fast "Dirty Flag" Loop
    # ==========================
    @tasks.loop(seconds=10)
    async def fast_update_check(self):
        """
        Fast loop that immediately updates clocks marked as `needs_update = TRUE`.

        Triggered scenarios
        -------------------
        - Dashboard changes.
        - Slash command setups that set `needs_update = TRUE`.
        """
        if self.bot.is_closed():
            return
        if not self.pool:
            return
        try:
            async with self.pool.acquire() as conn:
                configs = await conn.fetch(
                    "SELECT * FROM public.server_time_configs WHERE needs_update = TRUE"
                )

                if configs:
                    log.info(
                        f"⚡ Fast Update: Found {len(configs)} pending clock updates."
                    )
                    for config in configs:
                        await self._update_channels_for_config(config)
                        await conn.execute(
                            "UPDATE public.server_time_configs SET needs_update = FALSE WHERE id = $1",
                            config["id"],
                        )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            if not self.bot.is_closed():
                log.error(f"Fast Update Loop Error: {e}")

    @fast_update_check.before_loop
    async def before_fast_check(self):
        """
        Wait for the bot to be ready before starting the fast update loop.
        """
        await self.bot.wait_until_ready()

    # ==========================
    # Main Periodic Clock Loop
    # ==========================
    @tasks.loop(minutes=10)
    async def main_update_loop(self):
        """
        Periodically update all configured clocks to keep them accurate.

        Runs every 10 minutes, iterating over all rows in `server_time_configs`.
        """
        if self.bot.is_closed():
            return
        if not self.pool:
            return
        try:
            async with self.pool.acquire() as conn:
                configs = await conn.fetch("SELECT * FROM public.server_time_configs")

            if configs:
                log.info(
                    f"⏰ Main Loop: Updating {len(configs)} clock configurations..."
                )
                for config in configs:
                    if self.bot.is_closed():
                        break
                    await self._update_channels_for_config(config)
                    await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            if not self.bot.is_closed():
                log.error(f"Main Clock Loop Error: {e}")

    @main_update_loop.before_loop
    async def before_main_loop(self):
        """
        Wait for the bot to be ready and align the loop to the next 10-minute mark.

        This keeps clock update logs and channel changes tidier and more predictable.
        """
        await self.bot.wait_until_ready()
        now = datetime.now()
        minutes_to_wait = 10 - (now.minute % 10)
        seconds_to_wait = (minutes_to_wait * 60) - now.second
        log.info(f"Waiting {seconds_to_wait:.0f}s to align main clock loop.")
        try:
            await asyncio.sleep(seconds_to_wait)
        except asyncio.CancelledError:
            pass

    # ==========================
    # Autocomplete Helpers
    # ==========================
    async def timezone_autocomplete(
        self, interaction: discord.Interaction, current: str
    ) -> list[app_commands.Choice[str]]:
        """
        Autocomplete handler for timezone inputs.

        Parameters
        ----------
        interaction : discord.Interaction
            The interaction that triggered the autocomplete.
        current : str
            Current typed string from the user.

        Returns
        -------
        list[app_commands.Choice[str]]
            Up to 25 matching timezone choices.
        """
        current = current.lower()
        return [
            app_commands.Choice(name=tz, value=tz)
            for tz in self.all_timezones
            if current in tz.lower()
        ][:25]

    # ==========================
    # Slash Commands
    # ==========================
    def register_commands(self):
        """
        Register all Date/Time related slash commands.

        Commands
        --------
        /t1-setup-clock
            Create or update a timezone clock configuration.
        /t2-list-clocks
            List all active clock configurations for this server.
        /t3-remove-clock
            Remove a clock configuration by its time channel.
        """

        @self.bot.tree.command(
            name="t1-setup-clock",
            description="Create a timezone clock (Time + Date channels).",
        )
        @app_commands.checks.has_permissions(manage_channels=True)
        @app_commands.describe(
            timezone="Select Region (e.g. Asia/Tokyo)",
            time_channel="Channel for HH:MM",
            date_channel="Channel for Date (Optional)",
        )
        @app_commands.autocomplete(timezone=self.timezone_autocomplete)
        async def setup_clock(
            interaction: discord.Interaction,
            timezone: str,
            time_channel: discord.VoiceChannel,
            date_channel: discord.VoiceChannel = None,
        ):
            """
            Set up or update a clock configuration for a timezone.

            Parameters
            ----------
            timezone : str
                Valid timezone (e.g. 'Asia/Tokyo').
            time_channel : discord.VoiceChannel
                Voice channel to show time (HH:MM).
            date_channel : discord.VoiceChannel, optional
                Optional voice channel to show date (DD Mon, YYYY).
            """
            await interaction.response.defer(ephemeral=True)

            if timezone not in pytz.all_timezones:
                await interaction.followup.send("❌ Invalid Timezone.", ephemeral=True)
                return

            date_ch_id = str(date_channel.id) if date_channel else None

            query = """
                INSERT INTO public.server_time_configs (guild_id, timezone, time_channel_id, date_channel_id, needs_update)
                VALUES ($1, $2, $3, $4, TRUE)
                ON CONFLICT (time_channel_id) DO UPDATE SET timezone=$2, date_channel_id=$4, needs_update=TRUE
            """
            await self.pool.execute(
                query,
                str(interaction.guild.id),
                timezone,
                str(time_channel.id),
                date_ch_id,
            )

            await interaction.followup.send(
                f"✅ Clock Configured for **{timezone}**!\n"
                f"🕒 Time: {time_channel.mention}\n"
                f"{'📅 Date: ' + date_channel.mention if date_channel else ''}\n"
                f"⚡ Updating immediately...",
                ephemeral=True,
            )

        @self.bot.tree.command(
            name="t2-list-clocks",
            description="List all active time clocks in this server.",
        )
        @app_commands.checks.has_permissions(manage_channels=True)
        async def list_clocks(interaction: discord.Interaction):
            """
            List all configured clocks for the current guild.

            Shows:
            - Time channel
            - Optional date channel
            - Timezone and ID for reference
            """
            await interaction.response.defer(ephemeral=True)

            configs = await self.pool.fetch(
                "SELECT * FROM public.server_time_configs WHERE guild_id = $1",
                str(interaction.guild.id),
            )

            if not configs:
                await interaction.followup.send(
                    "❌ No time clocks configured for this server.", ephemeral=True
                )
                return

            embed = discord.Embed(
                title="⏰ Active Time Clocks", color=discord.Color.blue()
            )

            for conf in configs:
                tz = conf["timezone"]
                flag = self.emoji_for_timezone(tz)
                time_ch = interaction.guild.get_channel(int(conf["time_channel_id"]))
                date_ch = (
                    interaction.guild.get_channel(int(conf["date_channel_id"]))
                    if conf["date_channel_id"]
                    else None
                )

                val = f"**Time:** {time_ch.mention if time_ch else '`Deleted`'}\n"
                if date_ch:
                    val += f"**Date:** {date_ch.mention}\n"
                val += f"**ID:** `{conf['id']}`"

                embed.add_field(name=f"{flag} {tz}", value=val, inline=False)

            await interaction.followup.send(embed=embed, ephemeral=True)

        @self.bot.tree.command(
            name="t3-remove-clock",
            description="Remove a time clock configuration.",
        )
        @app_commands.checks.has_permissions(manage_channels=True)
        @app_commands.describe(
            time_channel="The time channel associated with the clock you want to remove."
        )
        async def remove_clock(
            interaction: discord.Interaction, time_channel: discord.VoiceChannel
        ):
            """
            Remove a clock configuration by its associated time channel.

            Parameters
            ----------
            time_channel : discord.VoiceChannel
                The voice channel currently used to display time.
            """
            await interaction.response.defer(ephemeral=True)

            result = await self.pool.execute(
                "DELETE FROM public.server_time_configs WHERE guild_id = $1 AND time_channel_id = $2",
                str(interaction.guild.id),
                str(time_channel.id),
            )

            if "DELETE 1" in result:
                await interaction.followup.send(
                    f"✅ Removed clock configuration for {time_channel.mention}.",
                    ephemeral=True,
                )
            else:
                await interaction.followup.send(
                    f"❌ Could not find a clock configuration using {time_channel.mention}.",
                    ephemeral=True,
                )

        log.info("Dynamic Clock commands registered.")
