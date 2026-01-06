# v5.0.0
# v4.0.0
import discord
from discord import app_commands
from discord.ext import commands, tasks
import asyncpg
import logging
from datetime import datetime, timedelta
import pytz
from dateutil.relativedelta import relativedelta
import re
import secrets
import asyncio

log = logging.getLogger(__name__)


class ReminderManager:
    """
    Manages reminder scheduling, execution, and Discord slash-command control.

    Features
    --------
    - Timezone-aware reminder scheduling (DB uses UTC, user-facing times local).
    - Flexible interval strings (e.g. '10m', '2h', '1d', '2w', '1M', '1y', or combinations).
    - Background polling task to dispatch due reminders.
    - Slash commands for listing, deleting, and pausing/remuming reminders.
    """

    def __init__(self, bot: commands.Bot, pool: asyncpg.Pool):
        """
        Initialize a ReminderManager instance.

        Parameters
        ----------
        bot : commands.Bot
            The Discord bot instance.
        pool : asyncpg.Pool
            PostgreSQL connection pool used for reminder persistence.
        """
        self.bot = bot
        self.pool = pool
        self.default_timezone = "Asia/Kolkata"  # Fallback

    async def start(self):
        """
        Start the reminder subsystem.

        This will begin the background polling loop that checks for reminders
        due to be sent.
        """
        log.info("🔔 Reminder Manager initialized")
        self.check_reminders_task.start()

    def stop(self):
        """
        Stop the reminder subsystem.

        Cancels the background polling task if it is currently running.
        """
        if self.check_reminders_task.is_running():
            self.check_reminders_task.cancel()
        log.info("ReminderManager task stopped.")

    def _calculate_next_run(self, current_run: datetime, interval: str):
        """
        Calculate the next execution time for a reminder.

        Interval Format
        ---------------
        The `interval` string is a compact descriptor that supports:
        - y  : years
        - M  : months
        - w  : weeks
        - d  : days
        - h  : hours
        - m  : minutes

        Examples
        --------
        - "10m"      → 10 minutes
        - "2h"       → 2 hours
        - "1d2h"     → 1 day and 2 hours
        - "1w3d10m"  → 1 week, 3 days, 10 minutes

        Parameters
        ----------
        current_run : datetime
            The current execution timestamp for the reminder.
        interval : str
            The encoded interval string or "once" for non-repeating reminders.

        Returns
        -------
        datetime | None
            The next run time, or None if the reminder should not repeat.
        """
        if interval == "once":
            return None

        matches = re.findall(r"(\d+)([yMwdhm])", interval)
        if not matches:
            return None

        delta_args = {}
        for amount, unit in matches:
            amount = int(amount)
            if unit == "y":
                delta_args["years"] = delta_args.get("years", 0) + amount
            elif unit == "M":
                delta_args["months"] = delta_args.get("months", 0) + amount
            elif unit == "w":
                delta_args["weeks"] = delta_args.get("weeks", 0) + amount
            elif unit == "d":
                delta_args["days"] = delta_args.get("days", 0) + amount
            elif unit == "h":
                delta_args["hours"] = delta_args.get("hours", 0) + amount
            elif unit == "m":
                delta_args["minutes"] = delta_args.get("minutes", 0) + amount

        return current_run + relativedelta(**delta_args)

    # ==========================
    # Background Reminder Loop
    # ==========================
    @tasks.loop(seconds=30)
    async def check_reminders_task(self):
        """
        Periodically check and dispatch due reminders.

        Runs every 30 seconds and:
        - Fetches reminders with `status = 'active'` whose `next_run` is due.
        - Sends each reminder (if the bot is still running).
        - Delegates per-reminder processing to `_send_reminder`.
        """
        if self.bot.is_closed():
            return

        now_utc = datetime.now(pytz.UTC)

        try:
            async with self.pool.acquire() as conn:
                due_reminders = await conn.fetch(
                    """
                    SELECT * FROM public.reminders 
                    WHERE status = 'active' 
                    AND next_run <= $1
                    """,
                    now_utc,
                )

                for reminder in due_reminders:
                    if self.bot.is_closed():
                        break
                    await self._send_reminder(conn, reminder)

        except asyncio.CancelledError:
            raise
        except Exception as e:
            if not self.bot.is_closed():
                log.error(f"Error checking reminders: {e}")

    async def _send_reminder(self, conn, reminder):
        """
        Send a single reminder and schedule its next run.

        Behavior
        --------
        - Resolves the target guild and channel.
        - Optionally mentions a role.
        - Skips sending if the reminder is older than 5 minutes (bot offline, etc.).
        - Updates `next_run`, `last_run`, and `run_count` for repeating reminders.
        - Marks one-time reminders as `completed`.

        Parameters
        ----------
        conn : asyncpg.Connection
            An active database connection.
        reminder : asyncpg.Record
            The reminder row containing scheduling and message information.
        """
        try:
            guild = self.bot.get_guild(int(reminder["guild_id"]))
            if not guild:
                return

            channel = guild.get_channel(int(reminder["channel_id"]))
            if not channel:
                log.warning(
                    f"Channel {reminder['channel_id']} not found for reminder {reminder['reminder_id']}"
                )
                return

            content = reminder["message"]
            if reminder["role_id"]:
                content = f"<@&{reminder['role_id']}> {content}"

            now_utc = datetime.now(pytz.UTC)
            reminder_time = reminder["next_run"]
            if reminder_time.tzinfo is None:
                reminder_time = reminder_time.replace(tzinfo=pytz.UTC)

            time_diff = (now_utc - reminder_time).total_seconds()

            if time_diff > 300:  # 5 minutes threshold
                log.info(
                    f"⏭️ Skipping expired reminder {reminder['reminder_id']} "
                    f"(Due: {reminder_time}, Delay: {int(time_diff)}s)"
                )
            else:
                try:
                    await channel.send(content)
                    log.info(f"✅ Reminder {reminder['reminder_id']} sent")
                except discord.Forbidden:
                    log.warning(f"Missing permissions in channel {channel.name}")

            next_run = self._calculate_next_run(
                reminder["next_run"], reminder["interval"]
            )

            if next_run:
                await conn.execute(
                    """
                    UPDATE public.reminders 
                    SET next_run = $1, last_run = NOW(), run_count = run_count + 1
                    WHERE reminder_id = $2
                    """,
                    next_run,
                    reminder["reminder_id"],
                )
            else:
                await conn.execute(
                    """
                    UPDATE public.reminders 
                    SET status = 'completed', last_run = NOW(), run_count = run_count + 1
                    WHERE reminder_id = $1
                    """,
                    reminder["reminder_id"],
                )

        except Exception as e:
            log.error(f"Error processing reminder {reminder['reminder_id']}: {e}")

    @check_reminders_task.before_loop
    async def before_check_reminders(self):
        """
        Wait for the bot to be fully ready before starting the reminder loop.
        """
        await self.bot.wait_until_ready()

    # ==========================
    # Slash Command Registration
    # ==========================
    def register_commands(self):
        """
        Register all reminder-related application commands.

        Commands
        --------
        /r1-list
            List all active and paused reminders for the current guild.
        /r2-delete
            Mark a reminder as deleted.
        /r3-pause
            Toggle between active/paused for a reminder.
        """

        @self.bot.tree.command(name="r1-list", description="List all active reminders")
        async def list_reminders(interaction: discord.Interaction):
            """
            List active and paused reminders in the current guild.

            Displays up to the first 10 reminders ordered by `next_run`,
            including:
            - Reminder ID
            - Status (active/paused)
            - Next run time (relative timestamp)
            - Interval string
            - Truncated reminder message
            """
            await interaction.response.defer(ephemeral=True)
            reminders = await self.pool.fetch(
                "SELECT * FROM public.reminders WHERE guild_id = $1 AND status IN ('active', 'paused') ORDER BY next_run ASC",
                str(interaction.guild.id),
            )

            if not reminders:
                await interaction.followup.send(
                    "📭 No active reminders.", ephemeral=True
                )
                return

            embed = discord.Embed(title="🔔 Reminders", color=discord.Color.green())
            for r in reminders[:10]:
                next_run_ts = int(r["next_run"].timestamp())
                status_icon = "⏸️" if r["status"] == "paused" else "✅"
                embed.add_field(
                    name=f"{status_icon} ID: {r['reminder_id']}",
                    value=f"**Next:** <t:{next_run_ts}:R>\n**Interval:** {r['interval']}\n**Msg:** {r['message'][:50]}",
                    inline=False,
                )
            await interaction.followup.send(embed=embed, ephemeral=True)

            # Note: You might want to add pagination or filters if reminder count grows large.

        @self.bot.tree.command(name="r2-delete", description="Delete a reminder")
        async def delete_reminder(interaction: discord.Interaction, reminder_id: str):
            """
            Soft-delete a reminder by setting its status to `deleted`.

            Parameters
            ----------
            reminder_id : str
                The identifier of the reminder to delete.
            """
            await interaction.response.defer(ephemeral=True)
            res = await self.pool.execute(
                "UPDATE public.reminders SET status = 'deleted' WHERE reminder_id = $1 AND guild_id = $2",
                reminder_id,
                str(interaction.guild.id),
            )
            if "UPDATE 0" in res:
                await interaction.followup.send(
                    f"❌ Reminder `{reminder_id}` not found.", ephemeral=True
                )
            else:
                await interaction.followup.send(
                    f"✅ Reminder `{reminder_id}` deleted.", ephemeral=True
                )

        @self.bot.tree.command(
            name="r3-pause", description="Pause or resume a reminder"
        )
        async def pause_reminder(interaction: discord.Interaction, reminder_id: str):
            """
            Toggle the active/paused state of a reminder.

            If the reminder is currently `active`, it will be set to `paused`.
            If it is `paused`, it will be set back to `active`.
            """
            await interaction.response.defer(ephemeral=True)
            row = await self.pool.fetchrow(
                "SELECT status FROM public.reminders WHERE reminder_id = $1 AND guild_id = $2",
                reminder_id,
                str(interaction.guild.id),
            )

            if not row:
                await interaction.followup.send("❌ Not found.", ephemeral=True)
                return

            new_status = "paused" if row["status"] == "active" else "active"
            await self.pool.execute(
                "UPDATE public.reminders SET status = $1 WHERE reminder_id = $2",
                new_status,
                reminder_id,
            )
            await interaction.followup.send(
                f"✅ Reminder `{reminder_id}` is now **{new_status}**.", ephemeral=True
            )

        log.info("✅ Reminder Slash Commands registered.")
