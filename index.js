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

const cookieLocation = "/home/bence/discord_bot_yt_player";

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
                session.leaveTimeout = setTimeout(() => {
                    connection.destroy();
                    queues.delete(guildId);
                    console.log(`🔌 Disconnected from ${guildId} after 60s idle.`);
                }, 60000);
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

        session = { connection, player, queue: [], leaveTimeout: null };
        queues.set(guildId, session);
    }
    return session;
}

function getAudioStream(url) {
    // Spawn yt-dlp to output raw audio stream to stdout
    // '-o', '-' : output to stdout
    // '-f', 'bestaudio' : best audio format available
    return spawn('yt-dlp', [
        '-o', '-',
        '-f', 'bestaudio',
        '--cookies', `${cookieLocation}/yt_cookies.txt`,
        '--no-playlist', url], { stdio: ['ignore', 'pipe', 'ignore'] });
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

        console.log(`${new Date().toLocaleString()}\n🎵 Now playing: ${song.title}\n`);

        ytProcess.on('error', error => {
            console.error('yt-dlp process error:', error);
            interaction.reply(`Error: Please notify the person who runs the bot!\nError: ${error}`)
            session.player.stop();
        });

        ytProcess.on('close', code => {
            if (code !== 0) {
                console.error(`yt-dlp process exited with code ${code}`);
                interaction.reply(`Error: Likely YT cookies expired, need to renew them.\nPlease notify the person who runs the bot!\nCode: ${code}`)
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
                if (session.leaveTimeout) {
                    clearTimeout(session.leaveTimeout);
                    session.leaveTimeout = null;
                }

                const input = options.getString('url');
                await interaction.deferReply();

                const session = getOrCreateSession(guildId, voiceChannel, interaction);


                let title = '';
                let url = input;

                // Check if it's a valid URL
                const isURL = /^https?:\/\//i.test(input);

                try {
                    if (isURL) {
                        // Get video title using yt-dlp
                        const getTitle = spawn('yt-dlp', [
                            '--no-playlist',
                            '--print', '%(title)s',
                            input
                        ]);

                        let output = '';
                        for await (const chunk of getTitle.stdout) {
                            output += chunk.toString();
                        }

                        title = output.trim();

                        if (!title) {
                            return interaction.editReply('❌ Failed to extract title from URL.');
                        }
                    } else {
                        // It's a search term — use yt-dlp to fetch the top result

                        const search = spawn('yt-dlp', [
                            `ytsearch1:${input}`,
                            '--print',
                            '%(title)s||%(webpage_url)s'
                        ]);

                        let output = '';

                        for await (const chunk of search.stdout) {
                            output += chunk.toString();
                        }

                        const trimmed = output.trim();

                        const [foundTitle, foundURL] = output.trim().split('||');
                        if (!foundTitle || !foundURL) {
                            return interaction.editReply('❌ No search results found.');
                        }

                        title = foundTitle;
                        url = foundURL;
                    }


                    session.queue.push({ title, url });

                    if (session.queue.length === 1) {
                        playNext(guildId);
                    }

                    return interaction.editReply(`🎵 Queued: ${title} - ${url}`);
                } catch (err) {
                    console.error('❌ Failed to process input:', err);
                    return interaction.editReply('❌ Something went wrong while processing the input.');
                }
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
        case 'stop':
            {
                const session = queues.get(guildId);
                if (!session || session.queue.length === 0) {
                    return interaction.reply('🚫🔊 Nothing is playing.');
                }
                session.player.stop(true);
                return interaction.reply('⏹️ Stopped current track.');
            }
        case 'pause':
            {
                const session = queues.get(guildId);

                if (!session || session.queue.length === 0) {
                    return interaction.reply('🚫🔇 Nothing to pause.');
                }

                if (session.player.state.status === 'playing') {
                    session.player.pause();
                    return interaction.reply('⏸️ Paused playback.');
                } else {
                    return interaction.reply('⚠️ Not currently playing.');
                }
            }
        case 'resume':
            {
                if (session.leaveTimeout) {
                    clearTimeout(session.leaveTimeout);
                    session.leaveTimeout = null;
                }

                const session = queues.get(guildId);

                if (!session || session.queue.length === 0) {
                    return interaction.reply('🚫🔊 Nothing to resume playing.');
                }

                if (session.player.state.status === 'paused') {
                    session.player.unpause();
                    return interaction.reply('▶️ Resumed playing.');
                } else {
                    return interaction.reply('⚠️ Not paused. Already playing or idle.');
                }
            }
        case 'hello':
            {
                return interaction.reply('Hello — ready to rock! 🎸\nSay hello to my creator over at:\nhttps://benceveres.com');
            }
        default:
            interaction.reply('❓ Unknown command.');
    }
});

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(process.env.TOKEN);