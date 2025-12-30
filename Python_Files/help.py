# v4.0.0
"""
Help System Manager.

This module handles the registration and display of the bot's main help command.
It provides a categorized overview of all available commands and features,
including dynamic checks for bot owner-only commands and a link to the web dashboard.
"""

import discord
from discord.ext import commands
from datetime import datetime, timezone
import logging

log = logging.getLogger(__name__)


class HelpManager:
    """
    Manages the help command and user-facing documentation for the bot.

    Responsibilities
    ----------------
    - Register the `/h1-help` slash command in the bot's command tree.
    - Provide a structured, categorized list of key commands.
    - Conditionally display owner-only command categories.
    - Promote the external web dashboard for visual configuration.
    """

    def __init__(self, bot: commands.Bot):
        """
        Initialize the HelpManager.

        Parameters
        ----------
        bot : commands.Bot
            The Discord bot instance.
        """
        self.bot = bot
        log.info("Help system has been initialized.")

    def register_commands(self):
        """
        Register the /h1-help slash command with the bot's command tree.

        Command
        -------
        /h1-help
            Display a categorized list of bot commands and a link to the dashboard.
        """

        @self.bot.tree.command(
            name="h1-help",
            description="Show instructions and a complete list of commands.",
        )
        async def help_command(interaction: discord.Interaction):
            """
            Display a comprehensive help embed listing commands by category.

            The help card includes:
            - General bot utility commands.
            - Leveling, analytics, YouTube notifications, time/clock, reminders,
              and channel restriction commands.
            - Owner-only commands when invoked by the bot owner.
            - A link to the web dashboard for visual configuration and analytics.
            """
            await interaction.response.defer(ephemeral=True)

            # Main help embed
            embed = discord.Embed(
                title="🤖 Supporter Bot Help",
                description=(
                    "Complete list of available commands organized by category. "
                    "Many features can also be configured via the "
                    "**[Web Dashboard](https://localhost:5000)**!"
                ),
                color=discord.Color.from_rgb(88, 101, 242),
                timestamp=datetime.now(timezone.utc),
            )

            # Command categories: General
            embed.add_field(
                name="⚙️ Bot General (1 command)",
                value="`/b1-ping` → Check bot latency and response time",
                inline=False,
            )

            # Command categories: Leveling
            embed.add_field(
                name="📊 Leveling System (7 commands)",
                value=(
                    "`/l1-level` → Check your or another user's level and XP\n"
                    "`/l2-leaderboard` → Show the top 10 users in the server\n"
                    "`/l3-setup-level-reward` → Set a role reward for a specific level\n"
                    "`/l4-level-reward-show` → Display all configured level rewards\n"
                    "`/l5-notify-level-msg` → Set the channel for level-up announcements\n"
                    "`/l6-xp-settings` → Configure XP rates for messages, images, and voice\n"
                    "`/l7-level-config` → Configure system behavior (message style, role stacking)"
                ),
                inline=False,
            )

            # Command categories: Analytics
            embed.add_field(
                name="📈 Analytics (3 commands)",
                value=(
                    "`/a1-dashboard` → View your server's analytics dashboard\n"
                    "`/a2-history` → View past weekly analytics reports\n"
                    "`/a3-generate-snapshot` → Generate an on-demand analytics snapshot"
                ),
                inline=False,
            )

            # Command categories: YouTube Notifications
            embed.add_field(
                name="📢 YouTube Notifications (5 commands)",
                value=(
                    "`/y1-find-youtube-channel-id` → Find a channel's ID from its @handle or URL\n"
                    "`/y2-setup-youtube-notifications` → Set up notifications for a YouTube channel\n"
                    "`/y3-remove-youtube-notifications` → Stop notifications for a YouTube channel\n"
                    "`/y4-list-youtube-notifications` → List all configured YouTube notifications\n"
                    "`/y5-test-rss-feed` → Test a channel's RSS feed and preview results"
                ),
                inline=False,
            )

            # Command categories: Time & Clocks
            embed.add_field(
                name="🌍 Time & Clocks (3 commands)",
                value=(
                    "`/t1-setup-clock` → Create a timezone clock channel\n"
                    "`/t2-list-clocks` → List all configured time channels\n"
                    "`/t3-remove-clock` → Remove a time channel configuration"
                ),
                inline=False,
            )

            # Command categories: Reminders
            embed.add_field(
                name="🔔 Reminders (2 commands)",
                value=(
                    "`/r1-list` → View all active reminders for this server\n"
                    "`/r2-delete` → Delete a specific reminder"
                ),
                inline=False,
            )

            # Command categories: Channel Restrictions
            embed.add_field(
                name="🚫 Channel Restrictions (9 commands)",
                value=(
                    "`/n1-setup-no-text` → Configure a media-only channel\n"
                    "`/n2-remove-restriction` → Remove all restrictions from a channel\n"
                    "`/n3-bypass-no-text` → Add a role that can bypass restrictions\n"
                    "`/n4-show-bypass-roles` → Show all roles that can bypass restrictions\n"
                    "`/n5-remove-bypass-role` → Remove a role from bypass list\n"
                    "`/n6-no-discord-link` → Block Discord invite links in a channel\n"
                    "`/n7-no-links` → Block all links in a channel\n"
                    "`/n8-setup-text-only` → Configure a text-only channel (no media)\n"
                    "`/n9-immune-role` → Add/remove immune role for specific channel"
                ),
                inline=False,
            )

            # Command categories: Ticket System
            embed.add_field(
                name="🎫 Ticket System (2 commands)",
                value=(
                    "`/tt1-setup` → Setup the ticket system\n"
                    "`/tt2-transcript` → List recent ticket transcripts"
                ),
                inline=False,
            )

            # Command categories: Join-to-Create Voice
            embed.add_field(
                name="🎙️ Join-to-Create Voice (3 commands)",
                value=(
                    "`/v1-setup` → Configure Join-to-Create voice channel system\n"
                    "`/v2-disable` → Disable the Join-to-Create system\n"
                    "`/v3-status` → Show Join-to-Create system status and statistics"
                ),
                inline=False,
            )

            # Owner-only section (visible only to bot owner)
            if await self.bot.is_owner(interaction.user):
                embed.add_field(
                    name="👑 Owner Commands (4 commands)",
                    value=(
                        "`/o1-serverlist` → Lists all servers the bot is in\n"
                        "`/o2-leaveserver` → Force the bot to leave a server by ID\n"
                        "`/o3-banguild` → Ban a server and make the bot leave\n"
                        "`/o4-unbanguild` → Unban a server, allowing it to re-invite the bot"
                    ),
                    inline=False,
                )

            # Dashboard and footer
            embed.add_field(
                name="🌐 Web Dashboard",
                value=(
                    "**Manage your server visually!**\n"
                    "Visit **https://email@example.com** to:\n"
                    "• Configure all features with a visual interface\n"
                    "• View real-time analytics and server health\n"
                    "• Manage YouTube notifications and time channels\n"
                    "• Set up leveling rewards and restrictions\n"
                    "• Access detailed analytics history"
                ),
                inline=False,
            )

            embed.set_footer(
                text=f"Server: {interaction.guild.name} • Total Commands: 40",
                icon_url=interaction.guild.icon.url if interaction.guild.icon else None,
            )

            await interaction.followup.send(embed=embed)

        log.info("💻 Help command registered.")
