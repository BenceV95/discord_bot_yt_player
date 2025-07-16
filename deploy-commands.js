require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('hello')
        .setDescription('Test if bot is alive'),

    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a YouTube URL or search term')
        .addStringOption(opt =>
            opt.setName('url').setDescription('YouTube URL or search term').setRequired(true)
        ),

    new SlashCommandBuilder().setName('stop').setDescription('Stop playback and leave'),
    new SlashCommandBuilder().setName('skip').setDescription('Skip the current song'),
    new SlashCommandBuilder().setName('queue').setDescription('Show the current queue'),
    new SlashCommandBuilder().setName('clear').setDescription('Clear the queue'),
    new SlashCommandBuilder().setName('disconnect').setDescription('Leave and reset bot'),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('🚀 Deploying slash commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('✅ Slash commands deployed!');
    } catch (err) {
        console.error('❌ Failed to deploy commands:', err);
    }
})();
