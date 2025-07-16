// https://discord.com/oauth2/authorize?client_id=1394940405761572924&permissions=2150696960&integration_type=0&scope=bot+applications.commands

require('dotenv').config();

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const { spawn } = require('child_process');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    partials: [Partials.Channel]
});

const queues = new Map();

function getOrCreateSession(guildId, voiceChannel, interaction) {
    let session = queues.get(guildId);
    if (!session) {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId,
            adapterCreator: interaction.guild.voiceAdapterCreator
        });

        const player = createAudioPlayer();

        connection.subscribe(player);

        player.on(AudioPlayerStatus.Idle, () => {
            session.queue.shift();
            if (session.queue.length > 0) {
                playNext(guildId);
            } else {
                connection.destroy();
                queues.delete(guildId);
            }
        });

        player.on('error', error => {
            console.error('Audio player error:', error);
            session.queue.shift();
            if (session.queue.length > 0) {
                playNext(guildId);
            } else {
                connection.destroy();
                queues.delete(guildId);
            }
        });

        session = { connection, player, queue: [] };
        queues.set(guildId, session);
    }
    return session;
}

function getAudioStream(url) {
    // Spawn yt-dlp to output raw audio stream to stdout
    // '-o', '-' : output to stdout
    // '-f', 'bestaudio' : best audio format available
    return spawn('yt-dlp', ['-o', '-', '-f', 'bestaudio', '--no-playlist', url], { stdio: ['ignore', 'pipe', 'ignore'] });
}

async function playNext(guildId) {
    const session = queues.get(guildId);
    if (!session || session.queue.length === 0) return;

    const song = session.queue[0];
    try {
        const ytProcess = getAudioStream(song.url);

        const resource = createAudioResource(ytProcess.stdout, {
            inputType: StreamType.Arbitrary,
            inlineVolume: true
        });

        session.player.play(resource);

        console.log(`🎵 Now playing: ${song.title}`);

        ytProcess.on('error', error => {
            console.error('yt-dlp process error:', error);
            session.player.stop();
        });

        ytProcess.on('close', code => {
            if (code !== 0) {
                console.error(`yt-dlp process exited with code ${code}`);
            }
        });

    } catch (err) {
        console.error('Failed to play:', err);
        session.queue.shift();
        playNext(guildId);
    }
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options, guildId, member } = interaction;

    if (!guildId) {
        return interaction.reply({ content: '❌ Commands only work inside servers!', ephemeral: true });
    }

    if (commandName === 'hello') {
        return interaction.reply('Hello — ready to rock! 🎸\nSay hello to my creator over at:\nhttps://benceveres.com');
    }

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
        return interaction.reply({ content: '❌ You must be in a voice channel!', ephemeral: true });
    }

    const permissions = voiceChannel.permissionsFor(interaction.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
        return interaction.reply({ content: '❌ I need permissions to join and speak in your voice channel!', ephemeral: true });
    }

    switch (commandName) {
        case 'play':
            {
                const input = options.getString('url');
                await interaction.deferReply();

                const session = getOrCreateSession(guildId, voiceChannel, interaction);


                let title = input;
                let url = input;

                // Check if it's a valid URL
                const isURL = /^https?:\/\//i.test(input);

                if (!isURL) {
                    // It's a search term — use yt-dlp to fetch the top result
                    try {
                        const search = spawn('yt-dlp', [
                            `ytsearch1:${input}`,
                            '--print',
                            '%(title)s|%(webpage_url)s'
                        ]);

                        let output = '';

                        for await (const chunk of search.stdout) {
                            output += chunk.toString();
                        }

                        const trimmed = output.trim();

                        if (!trimmed || !trimmed.includes('|')) {
                            return interaction.editReply('❌ No search results found for that query.');
                        }

                        const [foundTitle, foundURL] = trimmed.split('|');
                        if (!foundTitle || !foundURL || !/^https?:\/\//.test(foundURL)) {
                            return interaction.editReply('❌ Invalid search result received.');
                        }

                        title = foundTitle;
                        url = foundURL;
                    } catch (err) {
                        console.error('❌ Search failed:', err);
                        return interaction.editReply('❌ Search failed.');
                    }
                } else {
                    // URL provided — quick validation (but doesn't guarantee it's playable)
                    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
                        return interaction.editReply('❌ Only YouTube URLs are supported.');
                    }
                }

                session.queue.push({ title, url });

                if (session.queue.length === 1) {
                    playNext(guildId);
                }

                return interaction.editReply(`🎵 Queued: ${title} - ${url}`);
            }
        case 'skip':
            {
                const session = queues.get(guildId);
                if (!session || session.queue.length === 0) {
                    return interaction.reply('❌ Nothing to skip.');
                }
                session.player.stop();
                return interaction.reply('⏭ Skipped current track.');
            }
        case 'queue':
            {
                const session = queues.get(guildId);
                if (!session || session.queue.length === 0) {
                    return interaction.reply('📭 Queue is empty.');
                }
                const current = session.queue[0];
                const rest = session.queue.slice(1);
                const desc = rest.length > 0
                    ? rest.map((s, i) => `${i + 1}. ${s.title}`).join('\n')
                    : 'No more tracks in queue.';
                return interaction.reply(`🎶 **Now playing:** ${current.title}\n\n📃 **Up next:**\n${desc}`);
            }
        case 'clear':
            {
                const session = queues.get(guildId);
                if (!session || session.queue.length <= 1) {
                    return interaction.reply('📭 Nothing to clear.');
                }
                session.queue = [session.queue[0]];
                return interaction.reply('🧹 Queue cleared, current track remains playing.');
            }
        case 'disconnect':
            {
                const session = queues.get(guildId);
                if (!session) {
                    return interaction.reply('❌ Not connected.');
                }
                session.player.stop();
                session.connection.destroy();
                queues.delete(guildId);
                return interaction.reply('👋 Disconnected and cleared all memory.');
            }
        default:
            interaction.reply('❓ Unknown command.');
    }
});

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(process.env.TOKEN);
