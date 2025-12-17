"""
Analytics Engine for SupporterBOT.

This module provides:
- A core analytics engine (`AnalyticsEngine`) that computes server health,
  engagement tiers, leveling insights, growth trends, and generates
  persisted analytics snapshots.
- An analytics manager (`AnalyticsManager`) that schedules weekly reports,
  handles weekly stats resets, and exposes administrator-facing slash
  commands for analytics dashboards and manual snapshot generation.
"""

import discord
from discord.ext import commands, tasks
import asyncpg
import logging
from datetime import datetime, timezone, timedelta, date
from typing import Dict, List, Optional, Tuple
import pytz
import json

log = logging.getLogger(__name__)


# ======================================================================
# Core Analytics Engine
# ======================================================================


class AnalyticsEngine:
    """
    Core analytics computation engine.

    Responsibilities
    ----------------
    - Compute server health scores from activity, engagement, growth,
      and feature adoption metrics.
    - Derive engagement tiers and leveling insights from XP/level data.
    - Analyze growth trends and produce human-readable insights.
    - Generate and persist analytics snapshots in the database.
    """

    def __init__(self, pool: asyncpg.Pool):
        """
        Initialize the analytics engine.

        Parameters
        ----------
        pool : asyncpg.Pool
            PostgreSQL connection pool used for analytics queries.
        """
        self.pool = pool

    async def calculate_server_health(self, guild_id: str) -> int:
        """
        Calculate a composite server health score (0–100).

        Components
        ----------
        - Activity (40%): Messages per member per week.
        - Engagement (30%): Percentage of members with non-zero XP.
        - Growth (20%): Weekly new member growth rate.
        - Feature adoption (10%): Use of configurable features
          (level roles, YouTube feeds, time clocks, restrictions).

        Parameters
        ----------
        guild_id : str
            Guild ID as a string.

        Returns
        -------
        int
            Health score between 0 and 100. Returns 50 on error as a
            neutral fallback.
        """
        try:
            stats = await self.pool.fetchrow(
                """
                SELECT messages_this_week, new_members_this_week
                FROM public.guild_stats
                WHERE guild_id = $1
                """,
                guild_id,
            )

            member_stats = await self.pool.fetchrow(
                """
                SELECT 
                    COUNT(*) as total_members,
                    COUNT(*) FILTER (WHERE xp > 0) as active_members
                FROM public.users
                WHERE guild_id = $1
                """,
                guild_id,
            )

            features = await self.pool.fetchrow(
                """
                SELECT 
                    (SELECT COUNT(*) FROM public.level_roles WHERE guild_id = $1) as level_roles,
                    (SELECT COUNT(*) FROM public.youtube_notification_config WHERE guild_id = $1) as yt_feeds,
                    (SELECT COUNT(*) FROM public.server_time_configs WHERE guild_id = $1) as time_clocks,
                    (SELECT COUNT(*) FROM public.channel_restrictions_v2 WHERE guild_id = $1) as restrictions
                """,
                guild_id,
            )

            total_members = member_stats["total_members"] or 1
            active_members = member_stats["active_members"] or 0
            messages = stats["messages_this_week"] if stats else 0
            new_members = stats["new_members_this_week"] if stats else 0

            # Activity score (40 points): messages per member per week
            messages_per_member = messages / total_members if total_members > 0 else 0
            activity_score = min(40, (messages_per_member / 10) * 40)

            # Engagement score (30 points): active users percentage
            engagement_rate = (
                (active_members / total_members) * 100 if total_members > 0 else 0
            )
            engagement_score = min(30, (engagement_rate / 100) * 30)

            # Growth score (20 points): new members growth rate
            growth_rate = (
                (new_members / total_members) * 100 if total_members > 0 else 0
            )
            growth_score = min(20, (growth_rate / 5) * 20)

            # Feature adoption score (10 points)
            feature_count = (
                (features["level_roles"] or 0)
                + (features["yt_feeds"] or 0)
                + (features["time_clocks"] or 0)
                + (features["restrictions"] or 0)
            )
            feature_score = min(10, (feature_count / 4) * 10)

            health_score = int(
                activity_score + engagement_score + growth_score + feature_score
            )

            log.info(
                f"Health score for {guild_id}: {health_score}/100 "
                f"(Activity: {activity_score:.1f}, Engagement: {engagement_score:.1f}, "
                f"Growth: {growth_score:.1f}, Features: {feature_score:.1f})"
            )

            return health_score

        except Exception as e:
            log.error(f"Error calculating server health for {guild_id}: {e}")
            return 50

    async def get_engagement_tiers(self, guild_id: str) -> Dict:
        """
        Categorize members into engagement tiers based on XP.

        Tiers
        -----
        - Elite (Top ~5%): Highest XP earners.
        - Active (Next ~20%): Regular contributors.
        - Casual (Next ~50%): Occasional participants.
        - Inactive (Remaining): Minimal activity.

        Parameters
        ----------
        guild_id : str
            Guild ID as a string.

        Returns
        -------
        Dict
            Mapping tier names to `{"count": int, "percentage": float}`.
        """
        try:
            users = await self.pool.fetch(
                """
                SELECT user_id, xp
                FROM public.users
                WHERE guild_id = $1 AND xp > 0
                ORDER BY xp DESC
                """,
                guild_id,
            )

            total_users = len(users)
            if total_users == 0:
                return {
                    "elite": {"count": 0, "percentage": 0},
                    "active": {"count": 0, "percentage": 0},
                    "casual": {"count": 0, "percentage": 0},
                    "inactive": {"count": 0, "percentage": 0},
                }

            elite_count = max(1, int(total_users * 0.05))
            active_count = max(1, int(total_users * 0.20))
            casual_count = max(1, int(total_users * 0.50))
            inactive_count = total_users - elite_count - active_count - casual_count

            return {
                "elite": {
                    "count": elite_count,
                    "percentage": round((elite_count / total_users) * 100, 1),
                },
                "active": {
                    "count": active_count,
                    "percentage": round((active_count / total_users) * 100, 1),
                },
                "casual": {
                    "count": casual_count,
                    "percentage": round((casual_count / total_users) * 100, 1),
                },
                "inactive": {
                    "count": inactive_count,
                    "percentage": round((inactive_count / total_users) * 100, 1),
                },
            }

        except Exception as e:
            log.error(f"Error calculating engagement tiers for {guild_id}: {e}")
            return {
                "elite": {"count": 0, "percentage": 0},
                "active": {"count": 0, "percentage": 0},
                "casual": {"count": 0, "percentage": 0},
                "inactive": {"count": 0, "percentage": 0},
            }

    async def get_leveling_insights(self, guild_id: str) -> Dict:
        """
        Get leveling and XP-related insights for a guild.

        Includes
        --------
        - Total XP earned.
        - Average and maximum level.
        - User count.
        - Level distribution (level → user count).
        - Configured role rewards per level.

        Parameters
        ----------
        guild_id : str
            Guild ID as a string.

        Returns
        -------
        Dict
            Structured leveling analytics payload.
        """
        try:
            level_dist = await self.pool.fetch(
                """
                SELECT level, COUNT(*) as count
                FROM public.users
                WHERE guild_id = $1
                GROUP BY level
                ORDER BY level
                """,
                guild_id,
            )

            xp_stats = await self.pool.fetchrow(
                """
                SELECT 
                    SUM(xp) as total_xp,
                    AVG(level) as avg_level,
                    MAX(level) as max_level,
                    COUNT(*) as total_users
                FROM public.users
                WHERE guild_id = $1
                """,
                guild_id,
            )

            role_rewards = await self.pool.fetch(
                """
                SELECT level, role_name
                FROM public.level_roles
                WHERE guild_id = $1
                ORDER BY level
                """,
                guild_id,
            )

            level_distribution = {str(row["level"]): row["count"] for row in level_dist}

            return {
                "total_xp_earned": int(xp_stats["total_xp"] or 0),
                "avg_level": float(xp_stats["avg_level"] or 0),
                "max_level": int(xp_stats["max_level"] or 0),
                "total_users": int(xp_stats["total_users"] or 0),
                "level_distribution": level_distribution,
                "role_rewards": [
                    {"level": r["level"], "role": r["role_name"]} for r in role_rewards
                ],
            }

        except Exception as e:
            log.error(f"Error getting leveling insights for {guild_id}: {e}")
            return {
                "total_xp_earned": 0,
                "avg_level": 0,
                "max_level": 0,
                "total_users": 0,
                "level_distribution": {},
                "role_rewards": [],
            }

    async def get_top_contributors(self, guild_id: str, limit: int = 10) -> List[Dict]:
        """
        Retrieve the top users by XP.

        Parameters
        ----------
        guild_id : str
            Guild ID as a string.
        limit : int, optional
            Maximum number of users to return (default: 10).

        Returns
        -------
        List[Dict]
            List of contributors with `user_id`, `username`, `xp`, and `level`.
        """
        try:
            contributors = await self.pool.fetch(
                """
                SELECT user_id, username, xp, level
                FROM public.users
                WHERE guild_id = $1
                ORDER BY xp DESC
                LIMIT $2
                """,
                guild_id,
                limit,
            )

            return [
                {
                    "user_id": str(c["user_id"]),
                    "username": c["username"] or "Unknown User",
                    "xp": int(c["xp"]),
                    "level": int(c["level"]),
                }
                for c in contributors
            ]

        except Exception as e:
            log.error(f"Error getting top contributors for {guild_id}: {e}")
            return []

    async def get_growth_trends(self, guild_id: str) -> Dict:
        """
        Analyze week-over-week growth trends for messages and new members.

        Parameters
        ----------
        guild_id : str
            Guild ID as a string.

        Returns
        -------
        Dict
            Contains `message_trend`, `member_trend`, and current counts.
        """
        try:
            current_stats = await self.pool.fetchrow(
                """
                SELECT messages_this_week, new_members_this_week
                FROM public.guild_stats
                WHERE guild_id = $1
                """,
                guild_id,
            )

            last_snapshot = await self.pool.fetchrow(
                """
                SELECT messages_count, new_members_count
                FROM public.analytics_snapshots
                WHERE guild_id = $1
                ORDER BY snapshot_date DESC
                LIMIT 1
                """,
                guild_id,
            )

            current_messages = (
                current_stats["messages_this_week"] if current_stats else 0
            )
            current_members = (
                current_stats["new_members_this_week"] if current_stats else 0
            )

            if last_snapshot:
                last_messages = last_snapshot["messages_count"]
                last_members = last_snapshot["new_members_count"]

                message_trend = "stable"
                if current_messages > last_messages * 1.1:
                    message_trend = "up"
                elif current_messages < last_messages * 0.9:
                    message_trend = "down"

                member_trend = "stable"
                if current_members > last_members * 1.1:
                    member_trend = "up"
                elif current_members < last_members * 0.9:
                    member_trend = "down"
            else:
                message_trend = "stable"
                member_trend = "stable"

            return {
                "message_trend": message_trend,
                "member_trend": member_trend,
                "current_messages": current_messages,
                "current_members": current_members,
            }

        except Exception as e:
            log.error(f"Error calculating growth trends for {guild_id}: {e}")
            return {
                "message_trend": "stable",
                "member_trend": "stable",
                "current_messages": 0,
                "current_members": 0,
            }

    async def generate_insights(self, guild_id: str, analytics_data: Dict) -> List[str]:
        """
        Generate human-readable insights and recommendations from analytics data.

        Parameters
        ----------
        guild_id : str
            Guild ID as a string.
        analytics_data : Dict
            Aggregated analytics context used for rule-based insights.

        Returns
        -------
        List[str]
            Up to 6 short insight strings.
        """
        insights: List[str] = []

        try:
            health_score = analytics_data.get("health_score", 50)
            if health_score >= 80:
                insights.append(
                    "🎉 Excellent server health! Your community is thriving."
                )
            elif health_score >= 60:
                insights.append("✅ Good server health. Keep up the engagement!")
            elif health_score >= 40:
                insights.append(
                    "⚠️ Server health needs attention. Consider boosting activity."
                )
            else:
                insights.append(
                    "🚨 Low server health. Focus on member engagement and activity."
                )

            messages = analytics_data.get("messages_count", 0)
            total_members = analytics_data.get("total_members", 1)
            messages_per_member = messages / total_members if total_members > 0 else 0

            if messages_per_member < 5:
                insights.append(
                    "📉 Low message activity. Try hosting events or discussions to boost engagement."
                )
            elif messages_per_member > 20:
                insights.append(
                    "🔥 High message activity! Your members are very engaged."
                )

            message_trend = analytics_data.get("message_trend", "stable")
            member_trend = analytics_data.get("member_trend", "stable")

            if message_trend == "up" and member_trend == "up":
                insights.append(
                    "🚀 Both activity and growth are increasing! Great momentum."
                )
            elif message_trend == "down" and member_trend == "down":
                insights.append(
                    "📊 Activity and growth are declining. Consider new engagement strategies."
                )

            engagement = analytics_data.get("engagement_tiers", {})
            inactive_pct = engagement.get("inactive", {}).get("percentage", 0)

            if inactive_pct > 40:
                insights.append(
                    f"💤 {inactive_pct:.0f}% of members are inactive. Try re-engagement campaigns."
                )

            leveling = analytics_data.get("leveling_insights", {})
            max_level = leveling.get("max_level", 0)

            if max_level >= 50:
                insights.append(
                    f"🏆 Highest level reached: {max_level}! Your top members are very dedicated."
                )

            if health_score < 60:
                insights.append(
                    "💡 Tip: Configure more bot features (roles, notifications) to improve engagement."
                )

        except Exception as e:
            log.error(f"Error generating insights for {guild_id}: {e}")
            insights.append("📊 Analytics data collected successfully.")

        return insights[:6]

    async def create_snapshot(
        self, guild_id: str, tz_name: str = "UTC"
    ) -> Optional[int]:
        """
        Generate and persist an analytics snapshot for a guild.

        Parameters
        ----------
        guild_id : str
            Guild ID as a string.
        tz_name : str, optional
            Timezone name used to date the snapshot (default: 'UTC').

        Returns
        -------
        Optional[int]
            Snapshot ID on success, or None on failure.
        """
        try:
            log.info(
                f"Creating analytics snapshot for guild {guild_id} (timezone: {tz_name})"
            )

            tz = pytz.timezone(tz_name)
            now = datetime.now(tz)
            snapshot_date = now.date()
            week_number = now.isocalendar()[1]
            year = now.year

            health_score = await self.calculate_server_health(guild_id)
            engagement_tiers = await self.get_engagement_tiers(guild_id)
            leveling_insights = await self.get_leveling_insights(guild_id)
            top_contributors = await self.get_top_contributors(guild_id, 10)
            growth_trends = await self.get_growth_trends(guild_id)

            stats = await self.pool.fetchrow(
                """
                SELECT messages_this_week, new_members_this_week
                FROM public.guild_stats
                WHERE guild_id = $1
                """,
                guild_id,
            )

            member_count = await self.pool.fetchval(
                """
                SELECT COUNT(*) FROM public.users WHERE guild_id = $1
                """,
                guild_id,
            )

            active_member_count = await self.pool.fetchval(
                """
                SELECT COUNT(*) FROM public.users WHERE guild_id = $1 AND xp > 0
                """,
                guild_id,
            )

            analytics_data = {
                "health_score": health_score,
                "total_members": member_count or 0,
                "active_members": active_member_count or 0,
                "messages_count": stats["messages_this_week"] if stats else 0,
                "new_members_count": stats["new_members_this_week"] if stats else 0,
                "message_trend": growth_trends["message_trend"],
                "member_trend": growth_trends["member_trend"],
                "engagement_tiers": engagement_tiers,
                "leveling_insights": leveling_insights,
            }

            insights = await self.generate_insights(guild_id, analytics_data)

            snapshot_id = await self.pool.fetchval(
                """
                INSERT INTO public.analytics_snapshots (
                    guild_id, snapshot_date, week_number, year,
                    health_score, total_members, active_members,
                    messages_count, new_members_count,
                    elite_count, active_count, casual_count, inactive_count,
                    total_xp_earned, avg_level, max_level, level_distribution,
                    activity_heatmap, peak_hour, peak_day,
                    message_trend, member_trend,
                    top_contributors, insights,
                    timezone
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7,
                    $8, $9,
                    $10, $11, $12, $13,
                    $14, $15, $16, $17,
                    $18, $19, $20,
                    $21, $22,
                    $23, $24,
                    $25
                )
                ON CONFLICT (guild_id, snapshot_date) 
                DO UPDATE SET
                    health_score = EXCLUDED.health_score,
                    total_members = EXCLUDED.total_members,
                    active_members = EXCLUDED.active_members,
                    messages_count = EXCLUDED.messages_count,
                    new_members_count = EXCLUDED.new_members_count,
                    elite_count = EXCLUDED.elite_count,
                    active_count = EXCLUDED.active_count,
                    casual_count = EXCLUDED.casual_count,
                    inactive_count = EXCLUDED.inactive_count,
                    total_xp_earned = EXCLUDED.total_xp_earned,
                    avg_level = EXCLUDED.avg_level,
                    max_level = EXCLUDED.max_level,
                    level_distribution = EXCLUDED.level_distribution,
                    message_trend = EXCLUDED.message_trend,
                    member_trend = EXCLUDED.member_trend,
                    top_contributors = EXCLUDED.top_contributors,
                    insights = EXCLUDED.insights,
                    generated_at = NOW()
                RETURNING id
                """,
                guild_id,
                snapshot_date,
                week_number,
                year,
                health_score,
                member_count or 0,
                active_member_count or 0,
                stats["messages_this_week"] if stats else 0,
                stats["new_members_this_week"] if stats else 0,
                engagement_tiers["elite"]["count"],
                engagement_tiers["active"]["count"],
                engagement_tiers["casual"]["count"],
                engagement_tiers["inactive"]["count"],
                leveling_insights["total_xp_earned"],
                leveling_insights["avg_level"],
                leveling_insights["max_level"],
                json.dumps(leveling_insights["level_distribution"]),
                json.dumps({}),  # activity_heatmap placeholder
                None,  # peak_hour placeholder
                None,  # peak_day placeholder
                growth_trends["message_trend"],
                growth_trends["member_trend"],
                json.dumps(top_contributors),
                json.dumps(insights),
                tz_name,
            )

            log.info(
                f"✅ Created snapshot {snapshot_id} for guild {guild_id} (Week {week_number}, {year})"
            )
            return snapshot_id

        except Exception as e:
            log.error(f"❌ Error creating snapshot for {guild_id}: {e}", exc_info=True)
            return None


# ======================================================================
# Analytics Manager (Scheduling, Tasks, Commands)
# ======================================================================


class AnalyticsManager:
    """
    High-level manager for analytics scheduling and reporting.

    Responsibilities
    ----------------
    - Periodically generate weekly analytics snapshots and send reports.
    - Reset weekly stats according to each guild's timezone.
    - Expose slash commands for:
      * Viewing the analytics dashboard.
      * Viewing analytics history.
      * Manually generating a snapshot.
    """

    def __init__(self, bot: commands.Bot, pool: asyncpg.Pool):
        """
        Initialize the AnalyticsManager.

        Parameters
        ----------
        bot : commands.Bot
            The Discord bot instance.
        pool : asyncpg.Pool
            PostgreSQL connection pool.
        """
        self.bot = bot
        self.pool = pool
        self.engine = AnalyticsEngine(pool)

    async def start(self):
        """
        Start background analytics tasks.

        Tasks
        -----
        - `weekly_report_task`: periodic report generation and delivery.
        - `stats_reset_task`: weekly stats reset per guild timezone.
        """
        log.info("Starting Analytics Manager...")
        self.weekly_report_task.start()
        self.stats_reset_task.start()
        log.info("✅ Analytics Manager started")

    def stop(self):
        """
        Stop background analytics tasks.
        """
        log.info("Stopping Analytics Manager...")
        if self.weekly_report_task.is_running():
            self.weekly_report_task.cancel()
        if self.stats_reset_task.is_running():
            self.stats_reset_task.cancel()
        log.info("✅ Analytics Manager stopped")

    # ------------------------------------------------------------------
    # Background Tasks
    # ------------------------------------------------------------------
    @tasks.loop(minutes=15)
    async def weekly_report_task(self):
        """
        Periodically check whether any guild is due for a weekly report.

        Runs every 15 minutes and:
        - Checks guilds with `weekly_report_enabled = TRUE`.
        - Compares current local time against configured day/hour.
        - Ensures only one report per day per guild.
        - Creates a snapshot and sends a DM report to the guild owner.
        """
        try:
            now_utc = datetime.now(timezone.utc)

            guilds = await self.pool.fetch(
                """
                SELECT guild_id, analytics_timezone, weekly_report_day, weekly_report_hour
                FROM public.guild_settings
                WHERE weekly_report_enabled = TRUE
                """
            )

            for guild in guilds:
                try:
                    tz = pytz.timezone(guild["analytics_timezone"])
                    now_local = now_utc.astimezone(tz)

                    if (
                        now_local.weekday() == guild["weekly_report_day"]
                        and now_local.hour == guild["weekly_report_hour"]
                        and now_local.minute < 15
                    ):
                        last_report = await self.pool.fetchrow(
                            """
                            SELECT generated_at FROM public.analytics_reports
                            WHERE guild_id = $1
                            ORDER BY generated_at DESC
                            LIMIT 1
                            """,
                            guild["guild_id"],
                        )

                        if last_report:
                            last_report_date = (
                                last_report["generated_at"].astimezone(tz).date()
                            )
                            if last_report_date == now_local.date():
                                continue

                        log.info(
                            f"📊 Generating weekly report for guild {guild['guild_id']}"
                        )
                        snapshot_id = await self.engine.create_snapshot(
                            guild["guild_id"], guild["analytics_timezone"]
                        )

                        if snapshot_id:
                            await self.send_weekly_report(
                                guild["guild_id"], snapshot_id
                            )

                except Exception as e:
                    log.error(
                        f"Error processing weekly report for {guild['guild_id']}: {e}"
                    )
                    continue

        except Exception as e:
            log.error(f"Error in weekly_report_task: {e}")

    @tasks.loop(minutes=15)
    async def stats_reset_task(self):
        """
        Reset weekly stats for all guilds based on their configured timezone.

        Logic
        -----
        - Uses `weekly_reset_timezone` from `guild_settings`.
        - Resets when local time hits Monday 00:00 within the 15-minute window.
        - Resets message and new member counters in `guild_stats`.
        """
        try:
            now_utc = datetime.now(timezone.utc)

            guilds = await self.pool.fetch(
                """
                SELECT gs.guild_id, gs.weekly_reset_timezone, gst.last_reset
                FROM public.guild_settings gs
                LEFT JOIN public.guild_stats gst ON gs.guild_id = gst.guild_id
                """
            )

            for guild in guilds:
                try:
                    tz = pytz.timezone(guild["weekly_reset_timezone"])
                    now_local = now_utc.astimezone(tz)

                    if guild["last_reset"]:
                        last_reset_local = guild["last_reset"].astimezone(tz)

                        if (
                            now_local.weekday() == 0
                            and now_local.hour == 0
                            and now_local.minute < 15
                            and last_reset_local.date() < now_local.date()
                        ):
                            await self.pool.execute(
                                """
                                UPDATE public.guild_stats
                                SET messages_this_week = 0,
                                    new_members_this_week = 0,
                                    last_reset = NOW()
                                WHERE guild_id = $1
                                """,
                                guild["guild_id"],
                            )

                            log.info(
                                f"♻️ Reset weekly stats for {guild['guild_id']} ({tz})"
                            )
                    else:
                        await self.pool.execute(
                            """
                            INSERT INTO public.guild_stats (guild_id, last_reset)
                            VALUES ($1, NOW())
                            ON CONFLICT (guild_id) DO NOTHING
                            """,
                            guild["guild_id"],
                        )

                except Exception as e:
                    log.error(f"Error resetting stats for {guild['guild_id']}: {e}")
                    continue

        except Exception as e:
            log.error(f"Error in stats_reset_task: {e}")

    @weekly_report_task.before_loop
    async def before_weekly_report(self):
        """
        Wait for the bot to be fully ready before starting weekly reports.
        """
        await self.bot.wait_until_ready()

    @stats_reset_task.before_loop
    async def before_stats_reset(self):
        """
        Wait for the bot to be fully ready before starting stats resets.
        """
        await self.bot.wait_until_ready()

    # ------------------------------------------------------------------
    # Report Delivery
    # ------------------------------------------------------------------
    async def send_weekly_report(self, guild_id: str, snapshot_id: int):
        """
        Send a weekly analytics report to the guild owner via DM.

        Parameters
        ----------
        guild_id : str
            Guild ID as a string.
        snapshot_id : int
            ID of the analytics snapshot to summarize and reference.
        """
        try:
            guild = self.bot.get_guild(int(guild_id))
            if not guild or not guild.owner:
                log.warning(
                    f"Cannot send report for {guild_id}: Guild or owner not found"
                )
                return

            snapshot = await self.pool.fetchrow(
                """
                SELECT * FROM public.analytics_snapshots WHERE id = $1
                """,
                snapshot_id,
            )

            if not snapshot:
                log.error(f"Snapshot {snapshot_id} not found")
                return

            embed = discord.Embed(
                title="📊 Weekly Analytics Report",
                description=f"**{guild.name}**\nWeek {snapshot['week_number']}, {snapshot['year']}",
                color=discord.Color.blue(),
                timestamp=datetime.now(timezone.utc),
            )

            health_color = (
                "🟢"
                if snapshot["health_score"] >= 70
                else "🟡" if snapshot["health_score"] >= 40 else "🔴"
            )
            embed.add_field(
                name=f"{health_color} Server Health",
                value=f"**{snapshot['health_score']}/100**",
                inline=True,
            )

            embed.add_field(
                name="💬 Messages",
                value=f"{snapshot['messages_count']:,}",
                inline=True,
            )

            embed.add_field(
                name="👥 New Members",
                value=f"+{snapshot['new_members_count']}",
                inline=True,
            )

            embed.add_field(
                name="📈 Active Members",
                value=f"{snapshot['active_members']}/{snapshot['total_members']}",
                inline=True,
            )

            trend_emoji = {"up": "📈", "down": "📉", "stable": "➡️"}
            embed.add_field(
                name="Trends",
                value=(
                    f"Messages: {trend_emoji.get(snapshot['message_trend'], '➡️')} | "
                    f"Members: {trend_emoji.get(snapshot['member_trend'], '➡️')}"
                ),
                inline=True,
            )

            insights = json.loads(snapshot["insights"]) if snapshot["insights"] else []
            if insights:
                embed.add_field(
                    name="💡 Key Insight",
                    value=insights[0],
                    inline=False,
                )

            report_url = (
                f"https://yourbot.com/analytics/snapshot/{guild_id}/{snapshot_id}"
            )
            embed.add_field(
                name="📈 View Full Report",
                value=f"[Click here to see detailed analytics]({report_url})",
                inline=False,
            )

            embed.set_footer(
                text=f"Generated at {snapshot['generated_at'].strftime('%Y-%m-%d %H:%M %Z')}"
            )

            if guild.icon:
                embed.set_thumbnail(url=guild.icon.url)

            try:
                await guild.owner.send(embed=embed)

                await self.pool.execute(
                    """
                    INSERT INTO public.analytics_reports (
                        guild_id, snapshot_id, report_type,
                        start_date, end_date,
                        sent_to_owner, owner_notified_at,
                        generated_by, timezone
                    ) VALUES ($1, $2, 'weekly', $3, $4, TRUE, NOW(), 'system', $5)
                    """,
                    guild_id,
                    snapshot_id,
                    snapshot["snapshot_date"],
                    snapshot["snapshot_date"],
                    snapshot["timezone"],
                )

                log.info(f"✅ Sent weekly report to owner of {guild.name}")

            except discord.Forbidden:
                log.warning(f"Cannot DM owner of {guild.name} - DMs disabled")

                await self.pool.execute(
                    """
                    INSERT INTO public.analytics_reports (
                        guild_id, snapshot_id, report_type,
                        start_date, end_date,
                        sent_to_owner, generated_by, timezone
                    ) VALUES ($1, $2, 'weekly', $3, $4, FALSE, 'system', $5)
                    """,
                    guild_id,
                    snapshot_id,
                    snapshot["snapshot_date"],
                    snapshot["snapshot_date"],
                    snapshot["timezone"],
                )

        except Exception as e:
            log.error(f"Error sending weekly report for {guild_id}: {e}", exc_info=True)

    # ------------------------------------------------------------------
    # Slash Commands
    # ------------------------------------------------------------------
    def register_commands(self):
        """
        Register analytics-related slash commands.

        Commands
        --------
        /a1-analytics
            View link to the server analytics dashboard.
        /a2-analytics-history
            View link to past weekly analytics reports.
        /a3-generate-snapshot
            Manually generate a new analytics snapshot.
        """

        @self.bot.tree.command(
            name="a1-analytics",
            description="View your server's analytics dashboard",
        )
        @discord.app_commands.checks.has_permissions(administrator=True)
        async def view_analytics(interaction: discord.Interaction):
            """
            Send an ephemeral link to the server's analytics dashboard.
            """
            guild_id = interaction.guild.id
            url = f"https://yourbot.com/dashboard/server/{guild_id}#analytics"

            embed = discord.Embed(
                title="📊 Server Analytics",
                description=f"View real-time analytics for **{interaction.guild.name}**",
                color=discord.Color.blue(),
            )
            embed.add_field(
                name="📈 Dashboard",
                value=f"[Click here to view analytics]({url})",
                inline=False,
            )
            embed.set_footer(text="Analytics update in real-time")

            await interaction.response.send_message(embed=embed, ephemeral=True)

        @self.bot.tree.command(
            name="a2-analytics-history",
            description="View past weekly analytics reports",
        )
        @discord.app_commands.checks.has_permissions(administrator=True)
        async def analytics_history(interaction: discord.Interaction):
            """
            Send an ephemeral link to the analytics history page.
            """
            guild_id = interaction.guild.id
            url = f"https://yourbot.com/analytics/history/{guild_id}"

            embed = discord.Embed(
                title="📚 Analytics History",
                description=f"View all past weekly reports for **{interaction.guild.name}**",
                color=discord.Color.green(),
            )
            embed.add_field(
                name="📊 History",
                value=f"[Click here to view past reports]({url})",
                inline=False,
            )

            await interaction.response.send_message(embed=embed, ephemeral=True)

        @self.bot.tree.command(
            name="a3-generate-snapshot",
            description="Manually generate an analytics snapshot",
        )
        @discord.app_commands.checks.has_permissions(administrator=True)
        async def generate_snapshot(interaction: discord.Interaction):
            """
            Manually trigger analytics snapshot generation for the current guild.
            """
            await interaction.response.defer(ephemeral=True)

            guild_id = str(interaction.guild.id)

            tz_row = await self.pool.fetchrow(
                """
                SELECT analytics_timezone FROM public.guild_settings
                WHERE guild_id = $1
                """,
                guild_id,
            )

            tz_name = tz_row["analytics_timezone"] if tz_row else "UTC"

            snapshot_id = await self.engine.create_snapshot(guild_id, tz_name)

            if snapshot_id:
                url = f"https://yourbot.com/analytics/snapshot/{guild_id}/{snapshot_id}"

                embed = discord.Embed(
                    title="✅ Snapshot Generated",
                    description="Analytics snapshot created successfully!",
                    color=discord.Color.green(),
                )
                embed.add_field(
                    name="📊 View Report",
                    value=f"[Click here to view]({url})",
                    inline=False,
                )

                await interaction.followup.send(embed=embed, ephemeral=True)
            else:
                await interaction.followup.send(
                    "❌ Failed to generate snapshot. Please try again later.",
                    ephemeral=True,
                )

        log.info("✅ Analytics slash commands registered")
