import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
} from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Config from "./Config.js";
import { getSettings } from "./settings-store.js"; // Import settings manager

// A store to keep message data
const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

// A Map to hold the commands
const commands = new Map();

// Get the directory name using import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load commands from the 'plugins' directory
const pluginsDir = path.join(__dirname, "plugins");
const commandFiles = fs.readdirSync(pluginsDir).filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
    try {
        // Use dynamic import() for ES modules
        const filePath = path.join(pluginsDir, file);
        const moduleURL = new URL(`file://${filePath}`);
        const { default: command } = await import(moduleURL);

        if (command && command.name) {
            commands.set(command.name, command);
            console.log(`✅ Successfully loaded command: '${command.name}'`);
        }
    } catch (error) {
        console.error(`❌ Error loading command from '${file}':`, error);
    }
}

async function startBot() {
    // Save the session
    const { state, saveCreds } = await useMultiFileAuthState(Config.sessionName);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using Baileys v${version.join(".")}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: true, // To show the QR code in the terminal
        auth: state,
        getMessage: async (key) => {
            if (store) {
                const msg = await store.loadMessage(key.remoteJid, key.id);
                return msg?.message || undefined;
            }
            return {
                conversation: "Bot message"
            };
        }
    });

    store?.bind(sock.ev);
    
    // Attach commands map to the socket so plugins like 'menu' can access it
    sock.commands = commands;

    // Handle connection updates
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("QR code received, please scan.");
        }
        if (connection === "close") {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Connection closed due to: ", lastDisconnect.error, ", Reconnecting: ", shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === "open") {
            console.log("✅ Successfully connected to WhatsApp!");
            
            // Set initial presence based on settings
            const { bot_mode } = getSettings();
            if (bot_mode === 'online') {
                sock.sendPresenceUpdate('available'); // Always Online
                console.log("Bot mode is ONLINE. Presence set to 'available'.");
            } else {
                sock.sendPresenceUpdate('unavailable'); // Offline (Last seen)
                console.log("Bot mode is OFFLINE. Presence set to 'unavailable'.");
            }

            // --- Send Start Message to Bot's Own Inbox ---
            try {
                // Get the bot's own number and format it correctly to handle device IDs
                const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const startMessage = `*🤖 Bot has successfully started!* \n\n✅ System is online and ready to receive commands.\nTotal loaded commands: ${commands.size}`;
                
                await sock.sendMessage(botNumber, { text: startMessage });
                console.log("📨 Start message sent to inbox.");
            } catch (err) {
                console.error("Failed to send start message:", err);
            }
        }
    });

    // Save credentials
    sock.ev.on("creds.update", saveCreds);

    // Handle incoming messages and statuses
    sock.ev.on("messages.upsert", async (mek) => {
        try {
            const m = mek.messages[0];
            if (!m.message) return;

            const currentSettings = getSettings();
            const sender = m.key.remoteJid;

            // --- Auto Status View Logic ---
            if (sender === "status@broadcast") {
                if (currentSettings.auto_status_view) {
                    await sock.readMessages([m.key]);
                    console.log(`👁️ Viewed status from ${m.key.participant || sender}`);
                }
                return; // Stop processing here for status updates
            }

            // --- Auto React Logic ---
            if (currentSettings.auto_react && !m.key.fromMe) {
                const emojis = ['😊', '❤️', '😂', '👍', '🔥', '🎉', '✨', '💯', '🙌', '👌'];
                const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                const reaction = { react: { text: randomEmoji, key: m.key } };
                await sock.sendMessage(sender, reaction);
            }

            // Ignore self messages for command processing
            if (m.key.fromMe) return;

            // --- Command Handling Logic ---
            const messageType = Object.keys(m.message)[0];
            const body = (messageType === 'conversation') ? m.message.conversation :
                         (messageType === 'extendedTextMessage') ? m.message.extendedTextMessage.text : '';

            // Get prefix from settings
            const prefix = currentSettings.prefix;

            // Check if the message starts with the prefix
            if (body && body.startsWith(prefix)) {
                const args = body.slice(prefix.length).trim().split(/ +/);
                const commandName = args.shift().toLowerCase();
                const command = commands.get(commandName);

                if (command) {
                    try {
                        await command.execute(sock, m, args);
                    } catch (error) {
                        console.error(`Error executing command '${commandName}':`, error);
                        await sock.sendMessage(sender, { text: "An error occurred while executing the command." }, { quoted: m });
                    }
                }
            }
        } catch (err) {
            console.log("An error occurred in messages.upsert handler:", err);
        }
    });
}

// Start the bot
startBot();
