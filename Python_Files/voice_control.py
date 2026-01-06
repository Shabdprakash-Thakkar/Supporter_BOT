# v5.0.0
# v4.0.0
import discord
from discord import ui
import logging
import asyncio

log = logging.getLogger(__name__)

class RenameModal(ui.Modal, title="Rename Voice Channel"):
    name = ui.TextInput(label="New Channel Name", placeholder="My Cool Channel", min_length=1, max_length=100)

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.channel.edit(name=self.name.value)
        await interaction.response.send_message(f"✅ Channel renamed to **{self.name.value}**", ephemeral=True)

class LimitModal(ui.Modal, title="Set User Limit"):
    limit = ui.TextInput(label="User Limit (0 = Unlimited)", placeholder="0-99", min_length=1, max_length=2)

    async def on_submit(self, interaction: discord.Interaction):
        try:
            val = int(self.limit.value)
            if val < 0 or val > 99:
                raise ValueError
            await interaction.channel.edit(user_limit=val)
            await interaction.response.send_message(f"✅ User limit set to **{val if val > 0 else 'Unlimited'}**", ephemeral=True)
        except ValueError:
            await interaction.response.send_message("❌ Please enter a valid number between 0 and 99.", ephemeral=True)

class VoiceControlView(ui.View):
    def __init__(self, bot, pool, owner_id):
        super().__init__(timeout=None) # Persistent view
        self.bot = bot
        self.pool = pool
        self.owner_id = int(owner_id) if owner_id else None

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if not self.owner_id:
            # Fallback for orphaned channels or weird states
            await interaction.response.send_message("❌ This channel has no active owner.", ephemeral=True)
            return False
            
        if interaction.user.id != self.owner_id:
            # Check if admin
            if interaction.user.guild_permissions.administrator:
                return True
            await interaction.response.send_message("❌ Only the channel owner can use these controls.", ephemeral=True)
            return False
        return True

    @ui.button(label="🔒 Lock", style=discord.ButtonStyle.secondary, custom_id="vc_lock")
    async def lock_channel(self, interaction: discord.Interaction, button: ui.Button):
        # Deny connect for @everyone
        overwrite = interaction.channel.overwrites_for(interaction.guild.default_role)
        overwrite.connect = False
        await interaction.channel.set_permissions(interaction.guild.default_role, overwrite=overwrite)
        
        # Ensure owner can still connect
        owner_overwrite = interaction.channel.overwrites_for(interaction.user)
        owner_overwrite.connect = True
        await interaction.channel.set_permissions(interaction.user, overwrite=owner_overwrite)

        await interaction.response.send_message("🔒 Channel **LOCKED** (Invite only).", ephemeral=True)

    @ui.button(label="🔓 Unlock", style=discord.ButtonStyle.secondary, custom_id="vc_unlock")
    async def unlock_channel(self, interaction: discord.Interaction, button: ui.Button):
        # Reset connect for @everyone (or set True)
        overwrite = interaction.channel.overwrites_for(interaction.guild.default_role)
        overwrite.connect = True # Allow everyone
        await interaction.channel.set_permissions(interaction.guild.default_role, overwrite=overwrite)
        
        await interaction.response.send_message("🔓 Channel **UNLOCKED** (Public).", ephemeral=True)

    @ui.button(label="👻 Hide", style=discord.ButtonStyle.secondary, custom_id="vc_hide")
    async def hide_channel(self, interaction: discord.Interaction, button: ui.Button):
        # Deny view_channel and connect for @everyone to be safe
        overwrite = interaction.channel.overwrites_for(interaction.guild.default_role)
        overwrite.view_channel = False
        overwrite.connect = False
        await interaction.channel.set_permissions(interaction.guild.default_role, overwrite=overwrite)
        
        await interaction.response.send_message("👻 Channel is now **HIDDEN** and **LOCKED** for others.", ephemeral=True)

    @ui.button(label="👁️ Unhide", style=discord.ButtonStyle.secondary, custom_id="vc_unhide")
    async def unhide_channel(self, interaction: discord.Interaction, button: ui.Button):
        # Allow view_channel for @everyone
        overwrite = interaction.channel.overwrites_for(interaction.guild.default_role)
        overwrite.view_channel = True
        # We don't necessarily want to unlock (connect) when unhiding, 
        # but the user said "hide and unhide are did not working proper".
        # Usually unhide should just make it visible.
        await interaction.channel.set_permissions(interaction.guild.default_role, overwrite=overwrite)
        
        await interaction.response.send_message("👁️ Channel is now **VISIBLE**.", ephemeral=True)

    @ui.button(label="✏️ Rename", style=discord.ButtonStyle.primary, custom_id="vc_rename")
    async def rename_channel(self, interaction: discord.Interaction, button: ui.Button):
        await interaction.response.send_modal(RenameModal())

    @ui.button(label="👥 Limit", style=discord.ButtonStyle.primary, custom_id="vc_limit")
    async def limit_channel(self, interaction: discord.Interaction, button: ui.Button):
        await interaction.response.send_modal(LimitModal())

    @ui.button(label="➕ Add Role", style=discord.ButtonStyle.success, custom_id="vc_add_role")
    async def add_role_permission(self, interaction: discord.Interaction, button: ui.Button):
        # RoleSelect is available in discord.py 2.0+
        select = ui.RoleSelect(placeholder="Select a role to permit", min_values=1, max_values=1)

        async def select_callback(select_interaction: discord.Interaction):
            role = select.values[0]
            # Grant view and connect
            overwrite = interaction.channel.overwrites_for(role)
            overwrite.view_channel = True
            overwrite.connect = True
            await interaction.channel.set_permissions(role, overwrite=overwrite)
            
            await select_interaction.response.send_message(f"✅ Users with role **{role.name}** can now see and join this channel.", ephemeral=True)

        select.callback = select_callback
        view = ui.View()
        view.add_item(select)
        await interaction.response.send_message("Select a role to give access to this channel:", view=view, ephemeral=True)

    @ui.button(label="🛑 Disconnect User", style=discord.ButtonStyle.danger, custom_id="vc_kick_menu")
    async def kick_user_menu(self, interaction: discord.Interaction, button: ui.Button):
        # Create a select menu of current members
        members = [m for m in interaction.channel.members if m.id != interaction.user.id and not m.bot]
        
        if not members:
            await interaction.response.send_message("❌ No other users to disconnect.", ephemeral=True)
            return

        # Max 25 items in select menu
        options = [discord.SelectOption(label=m.display_name, value=str(m.id)) for m in members[:25]]
        
        select = ui.Select(placeholder="Select user to disconnect", options=options)
        
        async def kick_callback(select_interaction: discord.Interaction):
            target_id = int(select.values[0])
            target = interaction.guild.get_member(target_id)
            if target:
                try:
                    await target.move_to(None) # Disconnect
                    await select_interaction.response.send_message(f"👋 Disconnected **{target.display_name}**.", ephemeral=True)
                except discord.Forbidden:
                    await select_interaction.response.send_message("❌ I don't have permission to disconnect that user (admin/higher role?).", ephemeral=True)
            else:
                await select_interaction.response.send_message("❌ User not found.", ephemeral=True)

        select.callback = kick_callback
        view = ui.View()
        view.add_item(select)
        await interaction.response.send_message("Select a user to disconnect:", view=view, ephemeral=True)

    @ui.button(label="👤 Permit User", style=discord.ButtonStyle.success, custom_id="vc_permit")
    async def permit_user(self, interaction: discord.Interaction, button: ui.Button):
        # Use UserSelect for better UX
        select = ui.UserSelect(placeholder="Select a user to permit", min_values=1, max_values=1)

        async def select_callback(select_interaction: discord.Interaction):
            user = select.values[0]
            # Grant view and connect
            overwrite = interaction.channel.overwrites_for(user)
            overwrite.view_channel = True
            overwrite.connect = True
            await interaction.channel.set_permissions(user, overwrite=overwrite)
            
            await select_interaction.response.send_message(f"✅ **{user.display_name}** can now see and join this channel.", ephemeral=True)

        select.callback = select_callback
        view = ui.View()
        view.add_item(select)
        await interaction.response.send_message("Select a user to give access to this channel:", view=view, ephemeral=True)
