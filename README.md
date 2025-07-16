# discord_bot_yt_player
A discord bot to play audio from youtube links.

link to invite the bot with: https://discord.com/oauth2/authorize?client_id=1394940405761572924&permissions=2150696960&integration_type=0&scope=bot+applications.commands

- can search youtube and work with urls

# usage:
1. create bot over at discord with these details:
    - oauth2: 
        - scope: application.commands, bot
        - bot permissions: send messages, read message history, use slash commands, connect and speak for voice
        - use the guild install and invite the bot via url
    - bot: 
        - reset token and save it for the .env file with the client id
        - public bot with presence, server members and message content intent enabled
2. register commands
3. launch index.js