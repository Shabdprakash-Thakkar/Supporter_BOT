# v5.0.0
# v4.0.0
import discord
import os
from discord import app_commands
from discord.ext import commands
from datetime import datetime, timezone
import asyncpg
import logging

log = logging.getLogger(__name__)


class OwnerActionsManager:
    """
    Manages owner-exclusive actions such as guild listing, forced leave,
    and maintaining a ban list for problematic servers.

    Responsibilities
    ----------------
    - Provide a helper to check whether a guild is banned.
    - Expose owner-only slash commands for:
      * Listing all guilds the bot is currently in.
      * Forcing the bot to leave a specific guild.
      * Banning a guild and leaving it.
      * Removing a guild from the ban list.
    """

    def __init__(self, bot: commands.Bot, pool: asyncpg.Pool):
        """
        Initialize the OwnerActionsManager.

        Parameters
        ----------
        bot : commands.Bot
            The main Discord bot instance.
        pool : asyncpg.Pool
            Connection pool to the PostgreSQL database.
        """
        self.bot = bot
        self.pool = pool
        log.info("Owner Actions system has been initialized.")

    async def is_guild_banned(self, guild_id: int) -> bool:
        """
        Check whether a given guild ID is present in the banned_guilds table.

        Parameters
        ----------
        guild_id : int
            The ID of the guild to check.

        Returns
        -------
        bool
            True if the guild is banned, False otherwise.
            If the database check fails, returns False as a fail-safe.
        """
        try:
            query = "SELECT 1 FROM public.banned_guilds WHERE guild_id = $1"
            is_banned = await self.pool.fetchval(query, str(guild_id))
            return is_banned is not None
        except Exception as e:
            log.error(f"Error checking if guild {guild_id} is banned: {e}")
            return False

    # ==========================
    # Slash Command Registration
    # ==========================
    def register_commands(self):
        """
        Register all owner-only application commands.

        Commands
        --------
        /o1-serverlist
            List all servers the bot is currently in.
        /o2-leaveserver
            Force the bot to leave a specific server.
        /o3-banguild
            Ban a server and force the bot to leave.
        /o4-unbanguild
            Remove a server from the ban list.
        """

        async def is_bot_owner(interaction: discord.Interaction) -> bool:
            """
            Check whether the invoking user is the bot owner.

            Used as a reusable check for all owner-only commands.
            """
            env_owner_id = os.getenv("DISCORD_BOT_OWNER_ID")
            if env_owner_id:
                return str(interaction.user.id) == str(env_owner_id)
            return await self.bot.is_owner(interaction.user)

        @self.bot.tree.command(
            name="o1-serverlist",
            description="Lists all servers the bot is in (Bot Owner only).",
        )
        @app_commands.check(is_bot_owner)
        async def serverlist(interaction: discord.Interaction):
            """
            Display a list of all guilds the bot is a member of.

            Includes:
            - Guild name
            - Guild ID
            - Member count
            """
            await interaction.response.defer(ephemeral=True)

            description = ""
            for guild in sorted(self.bot.guilds, key=lambda g: g.name):
                description += f"- **{guild.name}** (ID: `{guild.id}`) [Member: **{guild.member_count}**]\n"

            embed = discord.Embed(
                title=f"🔎 Bot is in {len(self.bot.guilds)} Servers",
                description=description,
                color=discord.Color.blurple(),
            )
            await interaction.followup.send(embed=embed)

        @self.bot.tree.command(
            name="o2-leaveserver",
            description="Forces the bot to leave a specific server (Bot Owner only).",
        )
        @app_commands.check(is_bot_owner)
        @app_commands.describe(guild_id="The ID of the server to leave.")
        async def leaveserver(interaction: discord.Interaction, guild_id: str):
            """
            Force the bot to leave a specified guild.

            Parameters
            ----------
            guild_id : str
                The ID of the guild to leave.
            """
            await interaction.response.defer(ephemeral=True)
            try:
                guild = self.bot.get_guild(int(guild_id))
                if not guild:
                    await interaction.followup.send(
                        f"❌ I am not a member of a server with the ID `{guild_id}`."
                    )
                    return

                await guild.leave()
                log.info(f"Owner forced bot to leave server: {guild.name} ({guild.id})")
                await interaction.followup.send(
                    f"✅ Successfully left the server: **{guild.name}** (`{guild.id}`)."
                )
            except ValueError:
                await interaction.followup.send(
                    "❌ Invalid Guild ID format. Please provide a numeric ID."
                )
            except Exception as e:
                log.error(f"Error during /leaveserver command: {e}")
                await interaction.followup.send(
                    "❌ An unexpected error occurred while trying to leave the server."
                )

        @self.bot.tree.command(
            name="o3-banguild",
            description="Bans a server and forces the bot to leave (Bot Owner only).",
        )
        @app_commands.check(is_bot_owner)
        @app_commands.describe(guild_id="The ID of the server to ban.")
        async def banguild(interaction: discord.Interaction, guild_id: str):
            """
            Ban a guild and ensure the bot is not present in it.

            Behavior
            --------
            - Inserts or updates a row in `banned_guilds` with the current timestamp.
            - If the bot is currently in the guild, it leaves immediately.
            """
            await interaction.response.defer(ephemeral=True)
            try:
                query = """
                    INSERT INTO public.banned_guilds (guild_id, banned_at, banned_by)
                    VALUES ($1, NOW(), $2)
                    ON CONFLICT (guild_id) DO UPDATE SET
                      banned_at = NOW(),
                      banned_by = $2;
                """
                await self.pool.execute(query, guild_id, str(interaction.user.id))

                guild = self.bot.get_guild(int(guild_id))
                if guild:
                    await guild.leave()
                    log.warning(
                        f"Owner BANNED and left server: {guild.name} ({guild.id})"
                    )
                    await interaction.followup.send(
                        f"✅ Server **{guild.name}** (`{guild_id}`) has been banned and I have left."
                    )
                else:
                    log.warning(
                        f"Owner BANNED server ID: {guild_id} (not currently a member)"
                    )
                    await interaction.followup.send(
                        f"✅ Server ID `{guild_id}` has been added to the ban list. I was not a member of it."
                    )
            except ValueError:
                await interaction.followup.send(
                    "❌ Invalid Guild ID format. Please provide a numeric ID."
                )
            except Exception as e:
                log.error(f"Error during /banguild command: {e}")
                await interaction.followup.send(
                    "❌ An unexpected error occurred while banning the server."
                )

        @self.bot.tree.command(
            name="o4-unbanguild",
            description="Removes a server from the ban list (Bot Owner only).",
        )
        @app_commands.check(is_bot_owner)
        @app_commands.describe(guild_id="The ID of the server to unban.")
        async def unbanguild(interaction: discord.Interaction, guild_id: str):
            """
            Remove a guild from the ban list.

            Parameters
            ----------
            guild_id : str
                The ID of the guild to unban.
            """
            await interaction.response.defer(ephemeral=True)
            try:
                result = await self.pool.execute(
                    "DELETE FROM public.banned_guilds WHERE guild_id = $1", guild_id
                )

                if result == "DELETE 1":
                    log.info(f"Owner UNBANNED server ID: {guild_id}")
                    await interaction.followup.send(
                        f"✅ Server ID `{guild_id}` has been unbanned."
                    )
                else:
                    await interaction.followup.send(
                        f"❌ Server ID `{guild_id}` was not found in the ban list."
                    )
            except Exception as e:
                log.error(f"Error during /unbanguild command: {e}")
                await interaction.followup.send("❌ An unexpected error occurred.")

        log.info("💻 Owner Action commands registered.")
