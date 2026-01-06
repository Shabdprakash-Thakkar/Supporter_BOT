# v5.0.0
# v4.0.0
import discord
from discord import app_commands
from discord.ext import commands
import re
import asyncio
import asyncpg
import logging

log = logging.getLogger(__name__)


class NoTextManager:
    """
    Manages granular channel content restrictions using bitwise flags.

    Key Features
    ------------
    - Fine-grained control over message content by channel.
    - Supports combinations like:
      * "allow text + links, block Discord invites + media"
      * "media-only channels"
      * "no links" or "no Discord invites" channels.
    - Global bypass roles and per-channel immune roles.
    - Forwarded/quoted content support via message snapshots.
    """

    # ==========================
    # Content Type Bit Flags
    # ==========================
    CONTENT_TYPES = {
        "PLAIN_TEXT": 1,  # 0b00000001
        "DISCORD_INVITES": 2,  # 0b00000010
        "MEDIA_LINKS": 4,  # 0b00000100
        "ALL_LINKS": 8,  # 0b00001000
        "MEDIA_FILES": 16,  # 0b00010000
        "FILE_ATTACHMENTS": 32,  # 0b00100000
        "EMBEDS": 64,  # 0b01000000
        "SOCIAL_MEDIA_LINKS": 128,  # 0b10000000
    }

    def __init__(self, bot: commands.Bot, pool: asyncpg.Pool):
        """
        Initialize the NoTextManager.

        Parameters
        ----------
        bot : commands.Bot
            The Discord bot instance.
        pool : asyncpg.Pool
            Connection pool for accessing configuration tables.
        """
        self.bot = bot
        self.pool = pool

        # ==========================
        # URL & Content Regex Setup
        # ==========================
        self.url_pattern = re.compile(
            r"http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|"
            r"(?:%[0-9a-fA-F][0-9a-fA-F]))+"
        )
        self.discord_link_pattern = re.compile(
            r"(?:https?://)?(?:www\.)?discord(?:app\.com/invite|\.gg)/[a-zA-Z0-9]+"
        )
        self.media_link_pattern = re.compile(
            r"https?://\S+\.(?:png|jpe?g|gif|webp|bmp|svg|ico|mp4|mov|webm|avi|mkv|flv|"
            r"wmv|mp3|wav|ogg|flac|m4a|aac|wma)(?:\?\S*)?$",
            re.IGNORECASE,
        )
        self.social_media_pattern = re.compile(
            r"https?://(?:www\.)?(?:instagram\.com|youtube\.com|youtu\.be|tiktok\.com|"
            r"facebook\.com|fb\.com|twitter\.com|x\.com|twitch\.tv|snapchat\.com|"
            r"quora\.com|reddit\.com|t\.me|telegram\.org)/\S+",
            re.IGNORECASE,
        )

        log.info("✅ No-Text system initialized with granular content filtering")

    async def start(self):
        """
        Activate the manager by registering the on_message listener.
        """
        self.bot.add_listener(self.on_message, "on_message")

    async def is_bypass(self, member: discord.Member) -> bool:
        """
        Determine whether a member bypasses all restrictions.

        Global bypass rules
        -------------------
        - Members with administrator permission always bypass.
        - Roles listed in `public.bypass_roles` for the guild also bypass.

        Parameters
        ----------
        member : discord.Member
            The member to evaluate.

        Returns
        -------
        bool
            True if the member is exempt from all restrictions, otherwise False.
        """
        if member.guild_permissions.administrator:
            return True

        async with self.pool.acquire() as conn:
            bypass_roles = await conn.fetch(
                "SELECT role_id FROM public.bypass_roles WHERE guild_id = $1",
                str(member.guild.id),
            )

        if not bypass_roles:
            return False

        bypass_role_ids = {int(r["role_id"]) for r in bypass_roles}
        member_role_ids = {r.id for r in member.roles}

        return not bypass_role_ids.isdisjoint(member_role_ids)

    def _scan_single_source(self, content: str, attachments: list, embeds: list) -> int:
        """
        Inspect a single message source and return its content-type flags.

        Parameters
        ----------
        content : str
            Message text content.
        attachments : list
            List of attachments on the message.
        embeds : list
            List of embeds on the message.

        Returns
        -------
        int
            Bitwise OR of detected content-type flags.
        """
        detected = 0

        # Plain text (text after stripping URLs)
        if content and content.strip():
            content_without_urls = self.url_pattern.sub("", content).strip()
            if content_without_urls:
                detected |= self.CONTENT_TYPES["PLAIN_TEXT"]

        # Discord invite links
        if content and self.discord_link_pattern.search(content):
            detected |= self.CONTENT_TYPES["DISCORD_INVITES"]

        # Social media links
        if content and self.social_media_pattern.search(content):
            detected |= self.CONTENT_TYPES["SOCIAL_MEDIA_LINKS"]

        # Media links (direct URLs to media files)
        if content and self.media_link_pattern.search(content):
            detected |= self.CONTENT_TYPES["MEDIA_LINKS"]

        # Generic links (anything that is not invite/media/social)
        if content:
            all_urls = self.url_pattern.findall(content)
            for url in all_urls:
                if (
                    not self.discord_link_pattern.match(url)
                    and not self.media_link_pattern.match(url)
                    and not self.social_media_pattern.match(url)
                ):
                    detected |= self.CONTENT_TYPES["ALL_LINKS"]
                    break

        # Attachments (media files vs generic files)
        for attachment in attachments:
            ctype = getattr(attachment, "content_type", "") or ""
            if ctype.startswith(("image/", "video/", "audio/")):
                detected |= self.CONTENT_TYPES["MEDIA_FILES"]
            else:
                detected |= self.CONTENT_TYPES["FILE_ATTACHMENTS"]

        # Embeds
        if embeds:
            detected |= self.CONTENT_TYPES["EMBEDS"]

        return detected

    def detect_content_types(self, message: discord.Message) -> int:
        """
        Detect content types present in a message and its snapshots.

        This accounts for:
        - The original message content, attachments, and embeds.
        - Any forwarded/quoted content available via `message.snapshots`.

        Parameters
        ----------
        message : discord.Message
            Discord message object to analyze.

        Returns
        -------
        int
            Bitwise OR of all detected content-type flags.
        """
        detected = 0
        detected |= self._scan_single_source(
            message.content, message.attachments, message.embeds
        )

        if hasattr(message, "snapshots") and message.snapshots:
            for snapshot in message.snapshots:
                snap_content = getattr(snapshot, "content", "")
                snap_attachments = getattr(snapshot, "attachments", [])
                snap_embeds = getattr(snapshot, "embeds", [])
                detected |= self._scan_single_source(
                    snap_content, snap_attachments, snap_embeds
                )

        return detected

    def get_content_type_names(self, flags: int) -> list:
        """
        Convert bitwise content-type flags to human-readable names.

        Parameters
        ----------
        flags : int
            Bitmask of content types.

        Returns
        -------
        list[str]
            List of lowercase, space-separated content type labels.
        """
        names = []
        for name, value in self.CONTENT_TYPES.items():
            if flags & value:
                names.append(name.lower().replace("_", " "))
        return names

    async def on_message(self, message: discord.Message):
        """
        Core message handler that enforces channel content restrictions.

        Evaluation order
        ----------------
        1. Ignore bots, DMs, and members with global bypass.
        2. Fetch channel-specific restriction configuration.
        3. Check per-channel immune roles (skip if member has any).
        4. Detect message content type flags.
        5. Enforce:
           - Explicit blocked types (`blocked_content_types` bitmask).
           - Allowed-only types (`allowed_content_types` bitmask).
        6. Optionally send a redirect hint to another channel and clean it up.
        """
        if (
            message.author.bot
            or not message.guild
            or await self.is_bypass(message.author)
        ):
            return

        guild_id = str(message.guild.id)
        channel_id = str(message.channel.id)

        async with self.pool.acquire() as conn:
            config = await conn.fetchrow(
                """SELECT restriction_type, redirect_channel_id, 
                          allowed_content_types, blocked_content_types,
                          immune_roles
                   FROM public.channel_restrictions_v2 
                   WHERE guild_id = $1 AND channel_id = $2""",
                guild_id,
                channel_id,
            )

        if not config:
            return

        # Per-channel immune roles
        immune_roles_db = config["immune_roles"]
        if immune_roles_db:
            user_role_ids = {str(r.id) for r in message.author.roles}
            if not user_role_ids.isdisjoint(set(immune_roles_db)):
                return

        allowed_flags = config["allowed_content_types"] or 0
        blocked_flags = config["blocked_content_types"] or 0
        redirect_channel_id = config["redirect_channel_id"]

        try:
            detected_content = self.detect_content_types(message)

            if detected_content == 0:
                return

            # Explicit block rules
            if detected_content & blocked_flags:
                blocked_types = self.get_content_type_names(
                    detected_content & blocked_flags
                )
                log.debug(
                    f"Blocked in {message.channel.name}: {', '.join(blocked_types)}"
                )
                await message.delete()

                if redirect_channel_id:
                    redirect_channel = self.bot.get_channel(int(redirect_channel_id))
                    if redirect_channel:
                        warn_msg = await message.channel.send(
                            f"🚫 {message.author.mention}, this channel doesn't allow **{', '.join(blocked_types)}**. "
                            f"Please use {redirect_channel.mention} instead."
                        )
                        await asyncio.sleep(15)
                        try:
                            await warn_msg.delete()
                        except:
                            pass
                return

            # Allowed-only rules
            if allowed_flags > 0:
                disallowed_content = detected_content & ~allowed_flags
                if disallowed_content:
                    disallowed_types = self.get_content_type_names(disallowed_content)
                    log.debug(
                        f"Blocked in {message.channel.name}: {', '.join(disallowed_types)}"
                    )
                    await message.delete()

                    if redirect_channel_id:
                        redirect_channel = self.bot.get_channel(
                            int(redirect_channel_id)
                        )
                        if redirect_channel:
                            allowed_types = self.get_content_type_names(allowed_flags)
                            warn_msg = await message.channel.send(
                                f"🚫 {message.author.mention}, this channel only allows **{', '.join(allowed_types)}**. "
                                f"Please use {redirect_channel.mention} for other content."
                            )
                            await asyncio.sleep(15)
                            try:
                                await warn_msg.delete()
                            except:
                                pass
                    return

        except discord.Forbidden:
            log.warning(f"Missing permissions to delete message in {channel_id}")
        except discord.NotFound:
            pass
        except Exception as e:
            log.error(f"Error in NoTextManager on_message: {e}", exc_info=True)

    # ==========================
    # Slash Command Registration
    # ==========================
    def register_commands(self):
        """
        Register all slash commands related to content restrictions.

        Commands
        --------
        /n1-setup-no-text
            Media-only channel (links/media allowed, text blocked).
        /n2-remove-restriction
            Remove any restriction from a channel.
        /n3-bypass-no-text
            Configure global bypass roles.
        /n4-show-bypass-roles
            List global bypass roles.
        /n5-remove-bypass-role
            Revoke bypass ability from a role.
        /n6-no-discord-link
            Block Discord invite links in a channel.
        /n7-no-links
            Block all links in a channel.
        /n8-setup-text-only
            Text-only channel configuration.
        /n9-immune-role
            Add/remove per-channel immune roles.
        """

        @self.bot.tree.command(
            name="n1-setup-no-text",
            description="Configure a channel to only allow media and links (media-only).",
        )
        @app_commands.checks.has_permissions(manage_channels=True)
        async def setup_no_text(
            interaction: discord.Interaction,
            channel: discord.TextChannel,
            redirect_channel: discord.TextChannel,
        ):
            """
            Configure a media-only rule for a channel.

            Allows:
            - Media files
            - Media links
            - Social media links
            - Embeds

            Redirects text-only attempts to the specified redirect channel.
            """
            await interaction.response.defer(ephemeral=True)

            existing = await self.pool.fetchval(
                "SELECT id FROM public.channel_restrictions_v2 WHERE guild_id = $1 AND channel_id = $2",
                str(interaction.guild.id),
                str(channel.id),
            )

            if existing:
                await interaction.followup.send(
                    f"❌ {channel.mention} already has a restriction. Please remove it first.",
                    ephemeral=True,
                )
                return

            query = """
                INSERT INTO public.channel_restrictions_v2 
                (guild_id, channel_id, channel_name, restriction_type, allowed_content_types, blocked_content_types, redirect_channel_id, redirect_channel_name, configured_by)
                VALUES ($1, $2, $3, 'media_only', $4, 0, $5, $6, $7)
            """

            allowed_flags = 16 | 4 | 128 | 64

            await self.pool.execute(
                query,
                str(interaction.guild.id),
                str(channel.id),
                channel.name,
                allowed_flags,
                str(redirect_channel.id),
                redirect_channel.name,
                str(interaction.user.id),
            )
            await interaction.followup.send(
                f"✅ Media-only rule has been set for {channel.mention}. Text-only messages will be redirected to {redirect_channel.mention}.",
                ephemeral=True,
            )

        @self.bot.tree.command(
            name="n2-remove-restriction",
            description="Remove ANY content restriction from a channel.",
        )
        @app_commands.checks.has_permissions(manage_channels=True)
        async def remove_restriction(
            interaction: discord.Interaction, channel: discord.TextChannel
        ):
            """
            Remove all configured restrictions from a channel.
            """
            await interaction.response.defer(ephemeral=True)
            result = await self.pool.execute(
                "DELETE FROM public.channel_restrictions_v2 WHERE guild_id = $1 AND channel_id = $2",
                str(interaction.guild.id),
                str(channel.id),
            )

            if "DELETE 1" in result:
                await interaction.followup.send(
                    f"✅ Content restrictions have been removed from {channel.mention}.",
                    ephemeral=True,
                )
            else:
                await interaction.followup.send(
                    f"❌ {channel.mention} does not have any active restrictions.",
                    ephemeral=True,
                )

        @self.bot.tree.command(
            name="n3-bypass-no-text",
            description="Allow a role to bypass all message restrictions.",
        )
        @app_commands.checks.has_permissions(manage_roles=True)
        async def bypass_no_text(interaction: discord.Interaction, role: discord.Role):
            """
            Grant a role global bypass ability for all restrictions in the guild.
            """
            await interaction.response.defer(ephemeral=True)
            query = (
                "INSERT INTO public.bypass_roles "
                "(guild_id, role_id, guild_name, role_name) "
                "VALUES ($1, $2, $3, $4) "
                "ON CONFLICT (guild_id, role_id) DO NOTHING"
            )
            await self.pool.execute(
                query,
                str(interaction.guild.id),
                str(role.id),
                interaction.guild.name,
                role.name,
            )
            await interaction.followup.send(
                f"✅ {role.mention} can now bypass all channel restrictions.",
                ephemeral=True,
            )

        @self.bot.tree.command(
            name="n4-show-bypass-roles",
            description="Show all roles that can bypass restrictions.",
        )
        @app_commands.checks.has_permissions(manage_roles=True)
        async def show_bypass_roles(interaction: discord.Interaction):
            """
            List all roles configured as global bypass roles in this guild.
            """
            await interaction.response.defer(ephemeral=True)
            roles = await self.pool.fetch(
                "SELECT role_id, role_name FROM public.bypass_roles WHERE guild_id = $1",
                str(interaction.guild.id),
            )
            if not roles:
                await interaction.followup.send(
                    "❌ No bypass roles are configured for this server.", ephemeral=True
                )
                return

            description = (
                "Users with these roles can ignore all channel message restrictions:\n"
            )
            for record in roles:
                role = interaction.guild.get_role(int(record["role_id"]))
                if role:
                    description += f"\n• {role.mention}"
                else:
                    role_name = record["role_name"]
                    description += f"\n• `{role_name}` (Deleted Role)"

            embed = discord.Embed(
                title="🛡️ Bypass Roles",
                description=description,
                color=discord.Color.gold(),
            )
            await interaction.followup.send(embed=embed, ephemeral=True)

        @self.bot.tree.command(
            name="n5-remove-bypass-role", description="Remove a role's bypass ability."
        )
        @app_commands.checks.has_permissions(manage_roles=True)
        async def remove_bypass_role(
            interaction: discord.Interaction, role: discord.Role
        ):
            """
            Remove a role from the global bypass role list.
            """
            await interaction.response.defer(ephemeral=True)
            result = await self.pool.execute(
                "DELETE FROM public.bypass_roles WHERE guild_id = $1 AND role_id = $2",
                str(interaction.guild.id),
                str(role.id),
            )
            if result == "DELETE 1":
                await interaction.followup.send(
                    f"✅ {role.mention} can no longer bypass channel restrictions.",
                    ephemeral=True,
                )
            else:
                await interaction.followup.send(
                    f"❌ {role.mention} was not configured as a bypass role.",
                    ephemeral=True,
                )

        @self.bot.tree.command(
            name="n6-no-discord-link",
            description="Silently delete Discord invite links in a channel.",
        )
        @app_commands.checks.has_permissions(manage_channels=True)
        async def no_discord_link(
            interaction: discord.Interaction, channel: discord.TextChannel
        ):
            """
            Configure a channel to silently delete Discord invite links.
            """
            await interaction.response.defer(ephemeral=True)

            existing = await self.pool.fetchval(
                "SELECT id FROM public.channel_restrictions_v2 WHERE guild_id = $1 AND channel_id = $2",
                str(interaction.guild.id),
                str(channel.id),
            )

            if existing:
                await interaction.followup.send(
                    f"❌ {channel.mention} already has a restriction. Please remove it first using `/n2-remove-restriction`.",
                    ephemeral=True,
                )
                return

            query = """
                INSERT INTO public.channel_restrictions_v2 
                (guild_id, channel_id, channel_name, restriction_type, allowed_content_types, blocked_content_types, configured_by)
                VALUES ($1, $2, $3, 'block_invites', 0, 2, $4)
            """

            await self.pool.execute(
                query,
                str(interaction.guild.id),
                str(channel.id),
                channel.name,
                str(interaction.user.id),
            )
            await interaction.followup.send(
                f"✅ Discord invite links will now be deleted in {channel.mention}.",
                ephemeral=True,
            )

        @self.bot.tree.command(
            name="n7-no-links", description="Silently delete ALL links in a channel."
        )
        @app_commands.checks.has_permissions(manage_channels=True)
        async def no_links(
            interaction: discord.Interaction, channel: discord.TextChannel
        ):
            """
            Configure a channel to silently delete all hyperlinks.
            """
            await interaction.response.defer(ephemeral=True)

            existing = await self.pool.fetchval(
                "SELECT id FROM public.channel_restrictions_v2 WHERE guild_id = $1 AND channel_id = $2",
                str(interaction.guild.id),
                str(channel.id),
            )

            if existing:
                await interaction.followup.send(
                    f"❌ {channel.mention} already has a restriction. Please remove it first using `/n2-remove-restriction`.",
                    ephemeral=True,
                )
                return

            query = """
                INSERT INTO public.channel_restrictions_v2 
                (guild_id, channel_id, channel_name, restriction_type, allowed_content_types, blocked_content_types, configured_by)
                VALUES ($1, $2, $3, 'block_all_links', 0, 8, $4)
            """

            await self.pool.execute(
                query,
                str(interaction.guild.id),
                str(channel.id),
                channel.name,
                str(interaction.user.id),
            )
            await interaction.followup.send(
                f"✅ All links will now be deleted in {channel.mention}.",
                ephemeral=True,
            )

        @self.bot.tree.command(
            name="n8-setup-text-only",
            description="Configure a channel to only allow plain text (no media).",
        )
        @app_commands.checks.has_permissions(manage_channels=True)
        async def setup_text_only(
            interaction: discord.Interaction,
            channel: discord.TextChannel,
            redirect_channel: discord.TextChannel,
        ):
            """
            Configure a text-only rule for a channel.

            Only plain text content is allowed, everything else is blocked
            and users are redirected to the specified redirect channel.
            """
            await interaction.response.defer(ephemeral=True)

            existing = await self.pool.fetchval(
                "SELECT id FROM public.channel_restrictions_v2 WHERE guild_id = $1 AND channel_id = $2",
                str(interaction.guild.id),
                str(channel.id),
            )

            if existing:
                await interaction.followup.send(
                    f"❌ {channel.mention} already has a restriction. Please remove it first using `/n2-remove-restriction`.",
                    ephemeral=True,
                )
                return

            query = """
                INSERT INTO public.channel_restrictions_v2 
                (guild_id, channel_id, channel_name, restriction_type, allowed_content_types, blocked_content_types, redirect_channel_id, redirect_channel_name, configured_by)
                VALUES ($1, $2, $3, 'text_only', 1, 0, $4, $5, $6)
            """

            await self.pool.execute(
                query,
                str(interaction.guild.id),
                str(channel.id),
                channel.name,
                str(redirect_channel.id),
                redirect_channel.name,
                str(interaction.user.id),
            )
            await interaction.followup.send(
                f"✅ Text-only rule has been set for {channel.mention}. Media will be redirected to {redirect_channel.mention}.",
                ephemeral=True,
            )

        @self.bot.tree.command(
            name="n9-immune-role",
            description="Add or remove an immune role for a specific channel restriction.",
        )
        @app_commands.checks.has_permissions(manage_channels=True)
        @app_commands.describe(
            channel="The channel with the restriction",
            role="The role to make immune (or remove immunity from)",
            action="Add or Remove immunity",
        )
        @app_commands.choices(
            action=[
                app_commands.Choice(name="Add Immunity", value="add"),
                app_commands.Choice(name="Remove Immunity", value="remove"),
            ]
        )
        async def immune_role(
            interaction: discord.Interaction,
            channel: discord.TextChannel,
            role: discord.Role,
            action: app_commands.Choice[str],
        ):
            """
            Manage per-channel immune roles.

            An immune role is exempt from restrictions in a specific channel,
            even if global restrictions or bypass rules would normally apply.
            """
            await interaction.response.defer(ephemeral=True)

            existing = await self.pool.fetchrow(
                "SELECT immune_roles FROM public.channel_restrictions_v2 WHERE guild_id = $1 AND channel_id = $2",
                str(interaction.guild.id),
                str(channel.id),
            )

            if not existing:
                await interaction.followup.send(
                    f"❌ {channel.mention} does not have any restrictions set up.",
                    ephemeral=True,
                )
                return

            current_roles = existing["immune_roles"] or []
            role_id_str = str(role.id)

            if action.value == "add":
                if role_id_str in current_roles:
                    await interaction.followup.send(
                        f"⚠️ {role.mention} is already immune in {channel.mention}.",
                        ephemeral=True,
                    )
                    return

                current_roles.append(role_id_str)
                await self.pool.execute(
                    "UPDATE public.channel_restrictions_v2 SET immune_roles = $1 WHERE guild_id = $2 AND channel_id = $3",
                    current_roles,
                    str(interaction.guild.id),
                    str(channel.id),
                )
                await interaction.followup.send(
                    f"✅ {role.mention} is now immune to restrictions in {channel.mention}.",
                    ephemeral=True,
                )

            else:
                if role_id_str not in current_roles:
                    await interaction.followup.send(
                        f"⚠️ {role.mention} is not currently immune in {channel.mention}.",
                        ephemeral=True,
                    )
                    return

                current_roles.remove(role_id_str)
                await self.pool.execute(
                    "UPDATE public.channel_restrictions_v2 SET immune_roles = $1 WHERE guild_id = $2 AND channel_id = $3",
                    current_roles,
                    str(interaction.guild.id),
                    str(channel.id),
                )
                await interaction.followup.send(
                    f"✅ {role.mention} is no longer immune in {channel.mention}.",
                    ephemeral=True,
                )

        log.info("💻 All No-Text commands registered.")
