# v4.0.0
import discord
from discord import app_commands
from discord.ext import commands, tasks
from datetime import datetime, timezone, timedelta
import asyncio
import asyncpg
import logging
import aiohttp
import feedparser
import re
import os

log = logging.getLogger(__name__)
IST = timezone(timedelta(hours=5, minutes=30))

YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")


class YouTubeManager:
    """
    Manages YouTube upload notifications for Discord guilds.

    Key responsibilities:
    - Resolve YouTube channels from @handles / URLs using the YouTube Data API (if configured).
    - Fetch channel uploads using the official YouTube RSS feed (more reliable than full API polling).
    - Periodically check for new videos and send notifications to configured Discord channels.
    - Maintain logs in the database to avoid duplicate notifications and control seeding behavior.
    """

    def __init__(self, bot: commands.Bot, pool: asyncpg.Pool):
        """
        Initialize the YouTubeManager.

        Parameters
        ----------
        bot : commands.Bot
            The Discord bot instance.
        pool : asyncpg.Pool
            The connection pool for the PostgreSQL database.
        """
        self.bot = bot
        self.pool = pool
        self.session = None
        self.youtube_api_key = YOUTUBE_API_KEY

        log.info("YouTube Notification system (RSS) has been initialized.")
        if self.youtube_api_key:
            log.info("✅ YouTube API key loaded for channel ID lookup")
        else:
            log.warning("⚠️ YouTube API key not found - will use web scraping fallback")

    async def start(self):
        """
        Start the YouTubeManager.

        Creates a shared aiohttp.ClientSession and starts the periodic
        task that checks for new YouTube videos.
        """
        self.session = aiohttp.ClientSession()
        self.check_for_videos.start()

    async def stop(self):
        """
        Stop the YouTubeManager.

        Cancels the background video checking task and safely closes
        the aiohttp session.
        """
        if self.check_for_videos.is_running():
            self.check_for_videos.cancel()

        if self.session:
            await self.session.close()
            self.session = None

        log.info("YouTubeManager stopped.")

    async def close(self):
        """
        Backwards-compatible alias for stop().

        Some parts of the codebase may still call `close()` directly.
        """
        await self.stop()

    async def fetch_rss_feed(self, yt_channel_id: str):
        """
        Fetch and parse the YouTube RSS feed for a given channel.

        Parameters
        ----------
        yt_channel_id : str
            The YouTube channel ID (e.g. starts with 'UC').

        Returns
        -------
        feedparser.FeedParserDict | None
            Parsed feed object on success, or None on failure.
        """
        rss_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={yt_channel_id}"
        try:
            async with self.session.get(rss_url, timeout=10) as response:
                if response.status != 200:
                    if response.status in (404, 429, 500, 502, 503, 504):
                        log.warning(
                            f"YouTube RSS temporary failure ({response.status}) for {yt_channel_id}"
                        )
                    else:
                        log.error(
                            f"YouTube RSS unexpected status ({response.status}) for {yt_channel_id}"
                        )
                    return None
                xml_content = await response.text()
                feed = await self.bot.loop.run_in_executor(
                    None, feedparser.parse, xml_content
                )
                return feed
        except Exception as e:
            log.error(f"Error fetching RSS feed for channel {yt_channel_id}: {e}")
            return None

    def extract_video_info(self, entry):
        """
        Extract structured video information from a single RSS entry.

        Parameters
        ----------
        entry : feedparser.FeedParserDict
            An individual entry from the RSS feed.

        Returns
        -------
        dict | None
            Dictionary with keys: video_id, title, link, channel_name, published_at;
            or None if extraction fails.
        """
        try:
            video_id = entry.get("yt_videoid")
            published_str = entry.get("published")
            if not video_id or not published_str:
                return None
            published_at = datetime.strptime(published_str, "%Y-%m-%dT%H:%M:%S%z")
            return {
                "video_id": video_id,
                "title": entry.get("title", "Untitled"),
                "link": entry.get(
                    "link", f"https://www.youtube.com/watch?v={video_id}"
                ),
                "channel_name": entry.get("author", "Unknown Channel"),
                "published_at": published_at,
            }
        except Exception as e:
            log.error(f"Error extracting video info from RSS entry: {e}")
            return None

    # ===========================
    # YouTube API lookup helpers
    # ===========================
    async def search_channel_by_handle_api(self, handle: str):
        """
        Resolve a YouTube channel by @handle or URL using the YouTube Data API.

        Parameters
        ----------
        handle : str
            A YouTube handle or URL (e.g. '@creator', 'https://youtube.com/@creator').

        Returns
        -------
        dict | None
            Dictionary with channel_id, channel_name, thumbnail, custom_url;
            or None if lookup fails or API key is missing.
        """
        if not self.youtube_api_key:
            log.warning("YouTube API key not available")
            return None

        clean_handle = handle.strip()

        # If user passed a full URL, extract the last path part
        if "youtube.com" in clean_handle:
            parts = clean_handle.rstrip("/").split("/")
            clean_handle = parts[-1]

        # Remove leading '@' if still present
        clean_handle = clean_handle.lstrip("@").strip()

        if not clean_handle:
            log.warning("Empty handle after cleaning")
            return None

        url = "https://www.googleapis.com/youtube/v3/channels"
        params = {
            "part": "snippet",
            "forHandle": f"@{clean_handle}",
            "key": self.youtube_api_key,
        }

        try:
            async with self.session.get(url, params=params, timeout=10) as response:
                if response.status != 200:
                    log.error(
                        f"YouTube channels.list(forHandle) returned status {response.status}"
                    )
                    error_data = await response.text()
                    log.error(f"API Error response: {error_data}")
                    return None

                data = await response.json()
                items = data.get("items", [])
                if not items:
                    log.warning(f"No channel found for handle '@{clean_handle}'")
                    return None

                item = items[0]
                snippet = item["snippet"]

                custom_url = snippet.get("customUrl", "")
                thumbnail = snippet.get("thumbnails", {}).get("default", {}).get("url")

                log.info(
                    f"✅ Found channel by handle '@{clean_handle}': "
                    f"{snippet.get('title')} ({item['id']}) - customUrl={custom_url}"
                )

                return {
                    "channel_id": item["id"],
                    "channel_name": snippet.get("title", "Unknown Channel"),
                    "thumbnail": thumbnail,
                    "custom_url": custom_url,
                }

        except Exception as e:
            log.error(f"Error searching YouTube API by handle: {e}", exc_info=True)
            return None

    async def get_channel_by_id_api(self, channel_id: str):
        """
        Retrieve YouTube channel information by direct channel ID using the API.

        Parameters
        ----------
        channel_id : str
            The YouTube channel ID (e.g. 'UC...').

        Returns
        -------
        dict | None
            Dictionary with channel_id, channel_name, thumbnail, custom_url;
            or None if lookup fails or API key is missing.
        """
        if not self.youtube_api_key:
            return None

        url = "https://www.googleapis.com/youtube/v3/channels"
        params = {"part": "snippet", "id": channel_id, "key": self.youtube_api_key}

        try:
            async with self.session.get(url, params=params, timeout=10) as response:
                if response.status != 200:
                    return None

                data = await response.json()

                if "items" in data and data["items"]:
                    item = data["items"][0]
                    return {
                        "channel_id": item["id"],
                        "channel_name": item["snippet"]["title"],
                        "thumbnail": item["snippet"]["thumbnails"]["default"]["url"],
                        "custom_url": item["snippet"].get("customUrl", ""),
                    }
        except Exception as e:
            log.error(f"Error getting channel by ID: {e}")

        return None

    async def seed_channel(self, guild_id: str, yt_channel_id: str) -> int:
        """
        Seed recent videos for a newly configured channel.

        Fetches the latest videos via RSS and logs them in the database:
        - Older than 1 hour -> 'none' status (no notification).
        - Newer than 1 hour -> 'seeded' status (no notification, but tracked).

        Returns
        -------
        int
            Number of videos seeded (inserted into logs).
        """
        feed = await self.fetch_rss_feed(yt_channel_id)
        if not feed or not feed.entries:
            return 0

        seeded_count = 0
        skipped_old = 0
        notified_new = 0

        for entry in feed.entries[:15]:
            video_info = self.extract_video_info(entry)
            if not video_info:
                continue

            video_id = video_info["video_id"]
            published_at = video_info["published_at"]

            age_seconds = (
                datetime.now(IST) - published_at.astimezone(IST)
            ).total_seconds()

            exists = await self.pool.fetchval(
                "SELECT 1 FROM public.youtube_notification_logs WHERE guild_id = $1 AND yt_channel_id = $2 AND video_id = $3",
                guild_id,
                yt_channel_id,
                video_id,
            )

            if exists:
                continue

            if age_seconds > 3600:
                status = "none"
                skipped_old += 1
            else:
                status = "seeded"
                notified_new += 1

            await self.pool.execute(
                """INSERT INTO public.youtube_notification_logs 
                (guild_id, yt_channel_id, video_id, video_status) 
                VALUES ($1, $2, $3, $4) 
                ON CONFLICT DO NOTHING""",
                guild_id,
                yt_channel_id,
                video_id,
                status,
            )
            seeded_count += 1
        
        log.info(
            f"✅ Seeded {seeded_count} videos for guild {guild_id}, channel {yt_channel_id} "
            f"({skipped_old} old, {notified_new} recent)"
        )
        return seeded_count

    # ===========================
    # Background polling task
    # ===========================
    @tasks.loop(minutes=15)
    async def check_for_videos(self):
        """
        Periodically check configured YouTube channels for new videos.

        Runs every 15 minutes and follows this logic:
        1. Fetch enabled notification configurations from the database.
        2. For each configuration, fetch the RSS feed for the channel.
        3. For each video in the feed:
           - If already logged: skip.
           - If older than 60 minutes: log with `video_status = 'none'` (no notification).
           - If newer than 60 minutes: send a Discord notification and log with
             `video_status = 'notified'`.
        """
        if self.bot.is_closed():
            return

        log.info("🔍 Running YouTube RSS notification check...")

        configs = await self.pool.fetch(
            "SELECT * FROM public.youtube_notification_config WHERE is_enabled = TRUE"
        )

        if not configs:
            log.info("ℹ️ No active YouTube notification configs found")
            return

        log.info(f"📊 Checking {len(configs)} YouTube notification config(s)")

        for config in configs:
            guild_id_str = config["guild_id"]
            yt_channel_id = config["yt_channel_id"]
            yt_channel_name = config.get("yt_channel_name", "Unknown Channel")

            try:
                feed = await self.fetch_rss_feed(yt_channel_id)
                if not feed or not feed.entries:
                    log.debug(f"No entries in RSS feed for channel {yt_channel_id}")
                    continue

                for entry in feed.entries:
                    video_info = self.extract_video_info(entry)
                    if not video_info:
                        continue

                    video_id = video_info["video_id"]
                    published_at = video_info["published_at"]

                    age_seconds = (
                        datetime.now(IST) - published_at.astimezone(IST)
                    ).total_seconds()

                    log_exists = await self.pool.fetchval(
                        "SELECT 1 FROM public.youtube_notification_logs WHERE guild_id = $1 AND yt_channel_id = $2 AND video_id = $3",
                        guild_id_str,
                        yt_channel_id,
                        video_id,
                    )

                    if log_exists:
                        continue

                    if age_seconds > 3600:
                        log.info(
                            f"📦 Skipping old video ({age_seconds/3600:.2f} hours old): "
                            f"{video_id} for guild {guild_id_str}"
                        )
                        await self.pool.execute(
                            """INSERT INTO public.youtube_notification_logs 
                            (guild_id, yt_channel_id, video_id, video_status) 
                            VALUES ($1, $2, $3, 'none') 
                            ON CONFLICT DO NOTHING""",
                            guild_id_str,
                            yt_channel_id,
                            video_id,
                        )
                    else:
                        log.info(
                            f"🆕 New video detected for guild {guild_id_str} on channel {yt_channel_name}: "
                            f"{video_info['title']} (published {age_seconds/60:.1f} minutes ago)"
                        )

                        await self.send_notification(config, video_info)

                        await self.pool.execute(
                            """INSERT INTO public.youtube_notification_logs 
                            (guild_id, yt_channel_id, video_id, video_status) 
                            VALUES ($1, $2, $3, 'notified') 
                            ON CONFLICT DO NOTHING""",
                            guild_id_str,
                            yt_channel_id,
                            video_id,
                        )

                    await asyncio.sleep(0.5)

            except Exception as e:
                log.error(
                    f"❌ Error processing YouTube channel {yt_channel_id} for guild {guild_id_str}: {e}",
                    exc_info=True,
                )

    async def send_notification(self, config: dict, video_info: dict):
        """
        Send a YouTube upload notification to the configured Discord channel.

        Parameters
        ----------
        config : dict
            Row from `youtube_notification_config` containing guild/channel/role info.
        video_info : dict
            Extracted video metadata from `extract_video_info`.
        """
        guild = self.bot.get_guild(int(config["guild_id"]))
        if not guild:
            log.warning(f"Guild {config['guild_id']} not found")
            return

        channel = self.bot.get_channel(int(config["target_channel_id"]))
        if not channel:
            log.warning(
                f"Channel {config['target_channel_id']} not found in guild {guild.id}"
            )
            return

        role = (
            guild.get_role(int(config["mention_role_id"]))
            if config.get("mention_role_id")
            else None
        )

        message_template = config.get(
            "custom_message",
            "🔔 {@role} **{channel_name}** has uploaded a new video!\n\n**{video_title}**\n{video_url}",
        )

        message = message_template.replace("{channel_name}", video_info["channel_name"])
        message = message.replace("{video_title}", video_info["title"])
        message = message.replace("{video_url}", video_info["link"])
        message = message.replace("{@everyone}", "@everyone")
        message = message.replace("{@here}", "@here")

        if role:
            message = message.replace("{@role}", role.mention)
        else:
            message = message.replace("{@role} ", "")
            message = message.replace("{@role}", "")

        message = message.replace("  ", " ").strip()

        try:
            await channel.send(message, allowed_mentions=discord.AllowedMentions.all())
            log.info(
                f"✅ Sent notification for video {video_info['video_id']} "
                f"to guild {config['guild_id']} in channel {channel.name}"
            )
        except discord.Forbidden:
            log.warning(
                f"⚠️ Missing permissions to send YouTube notification in channel {channel.id} "
                f"of guild {guild.id}"
            )
        except Exception as e:
            log.error(f"❌ Failed to send YouTube notification: {e}", exc_info=True)

    @check_for_videos.before_loop
    async def before_check_for_videos(self):
        """
        Align the periodic task to run on 15-minute boundaries.

        Waits until the bot is ready, then sleeps until the next quarter hour
        (e.g. hh:00, hh:15, hh:30, hh:45) in IST before the first run.
        """
        await self.bot.wait_until_ready()
        now = datetime.now(IST)
        minutes_to_wait = 15 - (now.minute % 15)
        await asyncio.sleep((minutes_to_wait * 60) - now.second)

    # ===========================
    # Slash command registration
    # ===========================
    def register_commands(self):
        """
        Register all YouTube-related application commands (slash commands).

        Commands
        --------
        /y1-find-youtube-channel-id
            Resolve a YouTube channel ID from a URL or @handle.
        /y2-setup-youtube-notifications
            Configure RSS-based upload notifications for a channel in this server.
        /y3-remove-youtube-notifications
            Remove an existing notification configuration.
        /y4-list-youtube-notifications
            List all notification configurations for this server.
        /y5-test-rss-feed
            Test the RSS feed and preview the latest videos.
        """

        @self.bot.tree.command(
            name="y1-find-youtube-channel-id",
            description="Find the Channel ID for a YouTube channel URL or @handle.",
        )
        @app_commands.describe(
            channel_input="YouTube channel URL, @handle, or username (e.g., @ankitpurohitvlogs)"
        )
        async def find_youtube_channel_id(
            interaction: discord.Interaction, channel_input: str
        ):
            """
            Resolve a YouTube channel ID from various input formats.

            Accepted formats:
            - Direct channel ID (starts with 'UC').
            - YouTube channel URL (including /channel/, /@handle, etc.).
            - @handle or username-style inputs.
            """
            await interaction.response.defer(ephemeral=True)
            channel_id = None
            channel_name = None
            thumbnail = None
            custom_url = ""

            try:
                if channel_input.startswith("UC") and len(channel_input) == 24:
                    channel_id = channel_input
                    log.info(f"Input '{channel_input}' is a direct channel ID.")

                elif "/channel/" in channel_input:
                    match = re.search(r"/channel/([A-Za-z0-9_-]{24})", channel_input)
                    if match:
                        channel_id = match.group(1)
                        log.info(f"Extracted channel ID from URL: {channel_id}")

                else:
                    search_term = channel_input.strip()

                    if search_term.startswith("@"):
                        search_term = search_term[1:]

                    if "youtube.com" in search_term:
                        parts = search_term.rstrip("/").split("/")
                        search_term = parts[-1]
                        if search_term.startswith("@"):
                            search_term = search_term[1:]

                    if not search_term:
                        await interaction.followup.send(
                            "❌ Input is empty. Please provide a valid handle or URL."
                        )
                        return

                    if not self.youtube_api_key:
                        await interaction.followup.send(
                            "❌ YouTube API key is not configured. Cannot search for channels.\n"
                            "Please provide the direct channel ID starting with `UC`."
                        )
                        return

                    log.info(
                        f"Searching for channel via channels.list(forHandle): {search_term}"
                    )

                    api_result = await self.search_channel_by_handle_api(search_term)
                    if api_result:
                        channel_id = api_result["channel_id"]
                        channel_name = api_result["channel_name"]
                        thumbnail = api_result.get("thumbnail")
                        custom_url = api_result.get("custom_url", "")
                        log.info(
                            f"✅ Found via API by handle: {channel_name} ({channel_id}) - {custom_url}"
                        )
                    else:
                        log.warning(f"API handle lookup failed for: {search_term}")

                if not channel_id:
                    log.warning(f"API search failed for input: '{channel_input}'")
                    await interaction.followup.send(
                        "❌ Could not find channel. Please make sure:\n"
                        "• The @handle is spelled **exactly** as it appears on YouTube\n"
                        "• Example: `@ajaypandey` or `@ankitpurohitvlogs`\n"
                        "• Or provide the direct channel ID: `UCxxxxxxxxxxxxxxxxxxxxxx`\n\n"
                        "**Tip:** Visit the channel on YouTube and copy the @handle from the URL."
                    )
                    return

                log.info(f"Verifying channel ID via RSS: {channel_id}")

                feed = await self.fetch_rss_feed(channel_id)
                if not feed or not feed.feed:
                    log.error(f"RSS verification failed for ID '{channel_id}'")
                    await interaction.followup.send(
                        f"❌ Found potential ID `{channel_id}`, but couldn't verify it.\n"
                        "The channel might have no public videos or the ID might be incorrect."
                    )
                    return

                if not channel_name:
                    channel_name = feed.feed.get("title", "Unknown Channel")

                channel_url = f"https://www.youtube.com/channel/{channel_id}"

                embed = discord.Embed(
                    title="🎬 YouTube Channel Found",
                    description=f"Successfully found the channel!",
                    color=0xFF0000,
                )

                if thumbnail:
                    embed.set_thumbnail(url=thumbnail)

                embed.add_field(
                    name="📺 Channel Name", value=channel_name, inline=False
                )
                embed.add_field(
                    name="🆔 Channel ID", value=f"```{channel_id}```", inline=False
                )
                embed.add_field(
                    name="🔗 Channel URL",
                    value=f"[Visit Channel]({channel_url})",
                    inline=False,
                )

                if custom_url:
                    embed.add_field(
                        name="📌 Handle", value=f"`{custom_url}`", inline=False
                    )

                embed.set_footer(
                    text="✅ Found via YouTube API • Copy the Channel ID for /y2-setup-youtube-notifications"
                )

                await interaction.followup.send(embed=embed)
                log.info(
                    f"✅ Successfully found and verified channel: {channel_name} ({channel_id})"
                )

            except asyncio.TimeoutError:
                log.error(f"Timeout searching for '{channel_input}'")
                await interaction.followup.send(
                    "❌ The request timed out. Please try again in a moment."
                )
            except Exception as e:
                log.error(f"Error in /y1-find-youtube-channel-id: {e}", exc_info=True)
                await interaction.followup.send(
                    f"❌ An unexpected error occurred:\n```{str(e)[:200]}```\n"
                    "Please check the logs or try again."
                )

        @self.bot.tree.command(
            name="y2-setup-youtube-notifications",
            description="Set up notifications for a YouTube channel.",
        )
        @app_commands.checks.has_permissions(manage_guild=True)
        async def setup_notifications(
            interaction: discord.Interaction,
            youtube_channel_id: str,
            notification_channel: discord.TextChannel,
            role_to_mention: discord.Role,
            custom_message: str = None,
        ):
            """
            Configure or update YouTube upload notifications for this guild.

            Behavior
            --------
            - Validates the channel ID via RSS.
            - Inserts or updates the `youtube_notification_config` row.
            - Seeds recent videos into `youtube_notification_logs`:
              * Videos older than 60 minutes → `video_status = 'none'` (no notification).
              * Videos newer than 60 minutes → `video_status = 'seeded'`
                (ensures only *future* uploads trigger notifications).
            """
            await interaction.response.defer(ephemeral=True)

            if not youtube_channel_id.startswith("UC"):
                await interaction.followup.send(
                    "❌ That is not a valid YouTube Channel ID. It must start with `UC`.\nUse `/y1-find-youtube-channel-id` to find it."
                )
                return

            try:
                feed = await self.fetch_rss_feed(youtube_channel_id)
                if not feed or not feed.feed:
                    await interaction.followup.send(
                        "❌ Could not find a channel with that ID. Please double-check it."
                    )
                    return

                channel_name = feed.feed.get("title", "Unknown Channel")
                guild_id = str(interaction.guild_id)

                existing = await self.pool.fetchrow(
                    "SELECT * FROM public.youtube_notification_config WHERE guild_id = $1 AND yt_channel_id = $2",
                    guild_id,
                    youtube_channel_id,
                )

                default_message = (
                    "🔔 {@role} **{channel_name}** has uploaded a new video!\n\n"
                    "**{video_title}**\n{video_url}"
                )

                final_message = custom_message if custom_message else default_message

                if existing:
                    fields = [
                        "target_channel_id = $1",
                        "mention_role_id = $2",
                        "is_enabled = TRUE",
                        "yt_channel_name = $5",
                        "updated_at = NOW()",
                    ]
                    params = [
                        str(notification_channel.id),
                        str(role_to_mention.id),
                        guild_id,
                        youtube_channel_id,
                        channel_name,
                    ]

                    if custom_message:
                        fields.append(f"custom_message = ${len(params) + 1}")
                        params.append(custom_message)

                    await self.pool.execute(
                        f"""UPDATE public.youtube_notification_config 
                        SET {', '.join(fields)}
                        WHERE guild_id = $3 AND yt_channel_id = $4""",
                        *params,
                    )

                    await interaction.followup.send(
                        f"✅ Updated YouTube notifications for **{channel_name}**.\n"
                        f"Notifications will be posted in {notification_channel.mention} with {role_to_mention.mention}."
                    )
                else:
                    await self.pool.execute(
                        """INSERT INTO public.youtube_notification_config 
                        (guild_id, yt_channel_id, target_channel_id, mention_role_id, 
                            is_enabled, yt_channel_name, custom_message) 
                        VALUES ($1, $2, $3, $4, TRUE, $5, $6)""",
                        guild_id,
                        youtube_channel_id,
                        str(notification_channel.id),
                        str(role_to_mention.id),
                        channel_name,
                        final_message,
                    )

                    await interaction.followup.send(
                        f"✅ Set up YouTube notifications for **{channel_name}**!\n"
                        f"Notifications will be posted in {notification_channel.mention} with {role_to_mention.mention}.\n\n"
                        f"🔄 Seeding recent videos to prevent old notifications..."
                    )

                    seeded_count = await self.seed_channel(guild_id, youtube_channel_id)

                    await interaction.channel.send(
                        f"✅ **Seeding Complete!** Seeded {seeded_count} videos from **{channel_name}**.",
                        delete_after=45,
                    )

            except Exception as e:
                log.error(f"Error in setup_notifications: {e}", exc_info=True)
                await interaction.followup.send(
                    f"❌ An error occurred while setting up notifications: {str(e)[:200]}"
                )

        @self.bot.tree.command(
            name="y3-remove-youtube-notifications",
            description="Remove YouTube notifications for a channel.",
        )
        @app_commands.checks.has_permissions(manage_guild=True)
        @app_commands.describe(
            youtube_channel_id="The ID of the YouTube channel (starts with UC)."
        )
        async def remove_notifications(
            interaction: discord.Interaction, youtube_channel_id: str
        ):
            """
            Remove a YouTube notification configuration for this guild.

            Parameters
            ----------
            youtube_channel_id : str
                The YouTube channel ID whose config should be removed.
            """
            await interaction.response.defer(ephemeral=True)
            guild_id = str(interaction.guild_id)

            result = await self.pool.execute(
                "DELETE FROM public.youtube_notification_config WHERE guild_id = $1 AND yt_channel_id = $2",
                guild_id,
                youtube_channel_id,
            )

            if "DELETE 0" in result:
                await interaction.followup.send(
                    "❌ No notifications found for that channel ID in this server."
                )
            else:
                await interaction.followup.send(
                    f"✅ Removed YouTube notifications for channel `{youtube_channel_id}`."
                )

        @self.bot.tree.command(
            name="y4-list-youtube-notifications",
            description="List all YouTube notification configurations for this server.",
        )
        @app_commands.checks.has_permissions(manage_guild=True)
        async def list_notifications(interaction: discord.Interaction):
            """
            List all configured YouTube notification entries for this guild.

            Sends an embed summarizing:
            - Channel name and ID
            - Status (enabled/disabled)
            - Target text channel
            - Mention role
            """
            await interaction.response.defer(ephemeral=True)
            guild_id = str(interaction.guild_id)

            configs = await self.pool.fetch(
                "SELECT * FROM public.youtube_notification_config WHERE guild_id = $1 ORDER BY yt_channel_name",
                guild_id,
            )

            if not configs:
                await interaction.followup.send(
                    "ℹ️ No YouTube notification configurations found for this server."
                )
                return

            embed = discord.Embed(
                title=f"📺 YouTube Notifications for {interaction.guild.name}",
                color=0xFF0000,
            )

            for config in configs:
                status = "✅ Enabled" if config["is_enabled"] else "❌ Disabled"
                channel = self.bot.get_channel(int(config["target_channel_id"]))
                role_id = config.get("mention_role_id")
                role = interaction.guild.get_role(int(role_id)) if role_id else None
                channel_name = config.get("yt_channel_name") or "Unknown Name"

                embed.add_field(
                    name=f"🎬 {channel_name}",
                    value=f"**ID:** `{config['yt_channel_id']}`\n"
                    f"**Status:** {status}\n"
                    f"**Posts in:** {channel.mention if channel else '`Channel Deleted`'}\n"
                    f"**Mentions:** {role.mention if role else '`@here`'}",
                    inline=False,
                )

            await interaction.followup.send(embed=embed)

        @self.bot.tree.command(
            name="y5-test-rss-feed",
            description="Test the RSS feed for a YouTube channel and see the latest videos.",
        )
        @app_commands.checks.has_permissions(manage_guild=True)
        @app_commands.describe(
            youtube_channel_id="The ID of the YouTube channel (starts with UC)."
        )
        async def test_rss_feed(
            interaction: discord.Interaction, youtube_channel_id: str
        ):
            """
            Test and preview the RSS feed for a given YouTube channel.

            Shows the 5 most recent videos with:
            - Relative publish time
            - Direct links to the videos
            """
            await interaction.response.defer(ephemeral=True)

            try:
                feed = await self.fetch_rss_feed(youtube_channel_id)
                if not feed or not feed.entries:
                    await interaction.followup.send(
                        "❌ Could not fetch RSS feed or no videos found for this channel. Please verify the Channel ID."
                    )
                    return

                channel_name = feed.feed.get("title", "Unknown Channel")
                embed = discord.Embed(
                    title=f"🎬 RSS Feed Test: {channel_name}",
                    description=f"Found {len(feed.entries)} video(s) in the feed. Showing the 5 most recent:",
                    color=0xFF0000,
                )

                for i, entry in enumerate(feed.entries[:5]):
                    video_info = self.extract_video_info(entry)
                    if not video_info:
                        continue

                    embed.add_field(
                        name=f"{i+1}. {video_info['title'][:250]}",
                        value=f"**Published:** {discord.utils.format_dt(video_info['published_at'], 'R')}\n"
                        f"**Link:** [Watch Video]({video_info['link']})",
                        inline=False,
                    )

                await interaction.followup.send(embed=embed)

            except Exception as e:
                log.error(f"Error in test_rss_feed: {e}", exc_info=True)
                await interaction.followup.send(f"❌ An error occurred: {str(e)[:200]}")

        log.info("💻 YouTube Notification commands (RSS + API) registered.")
