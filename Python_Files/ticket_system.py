# v4.0.0
import discord
from discord import app_commands, ui
from discord.ext import commands, tasks
import asyncpg
import logging
from datetime import datetime, timedelta, timezone
import io

log = logging.getLogger(__name__)

class TicketView(ui.View):
    def __init__(self, bot, pool):
        super().__init__(timeout=None)
        self.bot = bot
        self.pool = pool

    @ui.button(label="Open Ticket", style=discord.ButtonStyle.primary, custom_id="create_ticket_btn", emoji="📩")
    async def create_ticket(self, interaction: discord.Interaction, button: ui.Button):
        await interaction.response.defer(ephemeral=True)

        user_id = str(interaction.user.id)
        guild_id = str(interaction.guild_id)

        # Check configuration
        config = await self.pool.fetchrow("SELECT * FROM public.ticket_system_config WHERE guild_id = $1", guild_id)
        if not config:
            await interaction.followup.send("Ticket system is not configured for this server.", ephemeral=True)
            return

        category_id = config['ticket_category_id']
        category = interaction.guild.get_channel(int(category_id)) if category_id else None

        if not category:
            await interaction.followup.send("Ticket category not found. Please contact admin.", ephemeral=True)
            return

        # Check existing open tickets for user
        existing = await self.pool.fetchval(
            "SELECT ticket_id FROM public.ticket_transcripts WHERE guild_id = $1 AND opener_user_id = $2 AND status = 'open'",
            guild_id, user_id
        )
        if existing:
            channel = interaction.guild.get_channel(int(existing))
            if channel:
                await interaction.followup.send(f"You already have an open ticket: {channel.mention}", ephemeral=True)
                return
            else:
                # Cleanup ghost ticket
                await self.pool.execute("UPDATE public.ticket_transcripts SET status = 'closed', closed_at = NOW() WHERE ticket_id = $1", existing)

        # Create channel
        overwrites = {
            interaction.guild.default_role: discord.PermissionOverwrite(read_messages=False),
            interaction.user: discord.PermissionOverwrite(read_messages=True, send_messages=True),
            interaction.guild.me: discord.PermissionOverwrite(read_messages=True, send_messages=True, manage_channels=True)
        }
        
        if config['admin_role_id']:
            admin_role = interaction.guild.get_role(int(config['admin_role_id']))
            if admin_role:
                overwrites[admin_role] = discord.PermissionOverwrite(read_messages=True, send_messages=True)

        try:
            channel_name = f"ticket-{interaction.user.name}"
            # Create text channel
            ticket_channel = await interaction.guild.create_text_channel(
                name=channel_name,
                category=category,
                overwrites=overwrites
            )
            
            # Create voice channel
            voice_channel = await interaction.guild.create_voice_channel(
                name=f"🎙️-{channel_name}",
                category=category,
                overwrites=overwrites
            )
        except Exception as e:
            await interaction.followup.send(f"Failed to create ticket channels: {e}", ephemeral=True)
            return

        # Log to DB
        await self.pool.execute(
            """INSERT INTO public.ticket_transcripts (ticket_id, guild_id, opener_user_id, status, closed_at) 
               VALUES ($1, $2, $3, 'open', NULL)""",
            str(ticket_channel.id), guild_id, user_id
        )

        # Get custom welcome message from config or use default
        welcome_message = config.get('welcome_message') or f"Hello {{user}}, support will be with you shortly. Please describe your issue and we'll help you as soon as possible."
        
        # Replace variables in welcome message
        welcome_message = welcome_message.replace('{user}', interaction.user.mention)
        welcome_message = welcome_message.replace('{ticket_id}', str(ticket_channel.id))
        
        # Send welcome message
        embed = discord.Embed(
            title=f"Ticket #{ticket_channel.name}",
            description=welcome_message,
            color=discord.Color.blue()
        )
        embed.add_field(name="Voice Channel", value=voice_channel.mention, inline=False)
        embed.add_field(name="Actions", value="Click the button below to close this ticket when resolved.", inline=False)
        
        view = CloseTicketView(self.bot, self.pool)
        await ticket_channel.send(embed=embed, view=view)

        await interaction.followup.send(f"Ticket created: {ticket_channel.mention} | Voice: {voice_channel.mention}", ephemeral=True)


class CloseTicketView(ui.View):
    def __init__(self, bot, pool):
        super().__init__(timeout=None)
        self.bot = bot
        self.pool = pool

    @ui.button(label="Close Ticket", style=discord.ButtonStyle.danger, custom_id="close_ticket_btn", emoji="🔒")
    async def close_ticket(self, interaction: discord.Interaction, button: ui.Button):
        await interaction.response.send_message("Are you sure you want to close this ticket?", view=ConfirmCloseView(self.bot, self.pool), ephemeral=True)


class ConfirmCloseView(ui.View):
    def __init__(self, bot, pool):
        super().__init__(timeout=60)
        self.bot = bot
        self.pool = pool

    @ui.button(label="Confirm Close", style=discord.ButtonStyle.danger, emoji="✅")
    async def confirm(self, interaction: discord.Interaction, button: ui.Button):
        await interaction.response.defer()
        ticket_id = str(interaction.channel.id)
        
        # Save Transcript
        messages = [message async for message in interaction.channel.history(limit=500, oldest_first=True)]
        transcript_lines = []
        for msg in messages:
            timestamp = msg.created_at.strftime("%Y-%m-%d %H:%M:%S")
            transcript_lines.append(f"[{timestamp}] {msg.author.name}: {msg.content}")
            for att in msg.attachments:
                transcript_lines.append(f"  [Attachment] {att.url}")
        
        transcript_text = "\n".join(transcript_lines)
        
        # Update DB
        await self.pool.execute(
            """UPDATE public.ticket_transcripts 
               SET status = 'closed', closed_at = NOW(), closer_user_id = $1, transcript_text = $2
               WHERE ticket_id = $3""",
            str(interaction.user.id), transcript_text, ticket_id
        )

        # Find and delete associated voice channel
        category = interaction.channel.category
        if category:
            voice_channel_name = f"🎙️-{interaction.channel.name}"
            for channel in category.voice_channels:
                if channel.name == voice_channel_name:
                    try:
                        await channel.delete(reason="Ticket closed")
                    except Exception as e:
                        log.error(f"Failed to delete voice channel: {e}")
                    break

        await interaction.channel.delete()

        # Send Transcript log if configured
        config = await self.pool.fetchrow("SELECT transcript_channel_id FROM public.ticket_system_config WHERE guild_id = $1", str(interaction.guild_id))
        if config and config['transcript_channel_id']:
            log_channel = interaction.guild.get_channel(int(config['transcript_channel_id']))
            if log_channel:
                embed = discord.Embed(title="Ticket Closed", color=discord.Color.red())
                embed.add_field(name="Ticket ID", value=ticket_id)
                embed.add_field(name="Closed By", value=interaction.user.mention)
                
                # Check message length limit (2000 chars for Discord)
                if len(transcript_text) < 1900:
                    embed.description = f"**Transcript**:\n```\n{transcript_text}\n```"
                    await log_channel.send(embed=embed)
                else:
                     file = discord.File(io.StringIO(transcript_text), filename=f"transcript-{ticket_id}.txt")
                     await log_channel.send(embed=embed, file=file)

class TicketSystem:
    def __init__(self, bot: commands.Bot, pool: asyncpg.Pool):
        self.bot = bot
        self.pool = pool
        self.check_inactivity.start()
        
        # Register persistent views
        self.bot.add_view(TicketView(bot, pool))
        self.bot.add_view(CloseTicketView(bot, pool))
        log.info("Ticket System initialized.")

    def stop(self):
        self.check_inactivity.cancel()

    def register_commands(self):
        @self.bot.tree.command(name="tt1-setup", description="Setup the ticket system")
        @app_commands.describe(channel="Channel to post the ticket button", category="Category to create tickets in", admin_role="Role that can manage tickets", transcript_channel="Channel to log transcripts")
        @app_commands.checks.has_permissions(administrator=True)
        async def tt_setup(interaction: discord.Interaction, channel: discord.TextChannel, category: discord.CategoryChannel, admin_role: discord.Role, transcript_channel: discord.TextChannel = None):
            await interaction.response.defer()
            
            query = """
                INSERT INTO public.ticket_system_config (guild_id, ticket_channel_id, ticket_category_id, admin_role_id, transcript_channel_id)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (guild_id) DO UPDATE
                SET ticket_channel_id = $2, ticket_category_id = $3, admin_role_id = $4, transcript_channel_id = $5
            """
            await self.pool.execute(query, str(interaction.guild_id), str(channel.id), str(category.id), str(admin_role.id), str(transcript_channel.id) if transcript_channel else None)

            embed = discord.Embed(
                title="Support Tickets",
                description="Click the button below to open a support ticket.",
                color=discord.Color.green()
            )
            await channel.send(embed=embed, view=TicketView(self.bot, self.pool))
            
            await interaction.followup.send(f"Ticket system setup complete! Button posted in {channel.mention}.")

        @self.bot.tree.command(name="tt2-transcript", description="List recent ticket transcripts")
        @app_commands.checks.has_permissions(administrator=True)
        async def transcript_list(interaction: discord.Interaction):
            rows = await self.pool.fetch(
                "SELECT id, ticket_id, closed_at, opener_user_id FROM public.ticket_transcripts WHERE guild_id = $1 AND status = 'closed' ORDER BY closed_at DESC LIMIT 10",
                str(interaction.guild_id)
            )
            
            if not rows:
                await interaction.response.send_message("No transcripts found.", ephemeral=True)
                return

            embed = discord.Embed(title="Recent Transcripts", color=discord.Color.blue())
            for row in rows:
                opener = interaction.guild.get_member(int(row['opener_user_id']))
                opener_name = opener.name if opener else "Unknown"
                date_str = row['closed_at'].strftime("%Y-%m-%d %H:%M")
                # Using localhost URL as placeholder, should be dynamic in prod but this is valid per requirements
                dashboard_link = f"[View on Dashboard](http://localhost:5000/transcript/{row['id']})" 
                embed.add_field(name=f"Ticket {row['id']} ({date_str})", value=f"Opened by: {opener_name}\n{dashboard_link}", inline=False)
            
            await interaction.response.send_message(embed=embed)
        
        log.info("Ticket System commands registered.")

    @tasks.loop(hours=1)
    async def check_inactivity(self):
        rows = await self.pool.fetch("SELECT ticket_id, guild_id FROM public.ticket_transcripts WHERE status = 'open'")
        for row in rows:
            guild = self.bot.get_guild(int(row['guild_id']))
            if not guild: continue
            
            channel = guild.get_channel(int(row['ticket_id']))
            if not channel:
                # Channel deleted manually? Close it in DB
                await self.pool.execute("UPDATE public.ticket_transcripts SET status = 'closed', closed_at = NOW() WHERE ticket_id = $1", row['ticket_id'])
                continue

            last_message_time = channel.created_at
            async for msg in channel.history(limit=1):
                last_message_time = msg.created_at
            
            if (datetime.now(timezone.utc) - last_message_time).total_seconds() > 6 * 3600: # 6 hours
                # Auto close
                messages = [message async for message in channel.history(limit=500, oldest_first=True)]
                transcript_lines = []
                for msg in messages:
                    timestamp = msg.created_at.strftime("%Y-%m-%d %H:%M:%S")
                    transcript_lines.append(f"[{timestamp}] {msg.author.name}: {msg.content}")
                
                transcript_text = "\n".join(transcript_lines)
                
                await self.pool.execute(
                    """UPDATE public.ticket_transcripts 
                       SET status = 'closed', closed_at = NOW(), transcript_text = $1, closer_user_id = 'system'
                       WHERE ticket_id = $2""",
                    transcript_text, row['ticket_id']
                )
                await channel.delete(reason="Auto-closed due to inactivity")
