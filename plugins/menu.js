// plugins/menu.js
import { getSettings } from "../settings-store.js"; // Importing settings for prefix

export default {
    name: "menu",
    category: "General",
    description: "Display the automatically generated command menu.",
    execute: async (sock, m, args) => {
        try {
            // Get current prefix
            const prefix = getSettings().prefix;
            
            // Fetch all loaded commands attached to the socket from index.js
            const commands = sock.commands; 

            // Group commands by their category
            const categories = {};

            commands.forEach((cmd) => {
                const category = cmd.category || "Uncategorized"; // Default if category is missing
                if (!categories[category]) {
                    categories[category] = [];
                }
                categories[category].push(cmd);
            });

            // Build the Menu String
            let menuText = `╭━━━〔 *BOT MENU* 〕━━━┈\n┃\n`;

            // Loop through each category and its commands
            for (const category in categories) {
                menuText += `┣ *[ ${category.toUpperCase()} ]*\n`;
                
                categories[category].forEach(cmd => {
                    const description = cmd.description || "No description provided.";
                    menuText += `┃ ‣ ${prefix}${cmd.name} - ${description}\n`;
                });
                
                menuText += `┃\n`;
            }

            menuText += `╰━━━━━━━━━━━━━━━┈`;

            // Send the constructed menu back to the user
            await sock.sendMessage(m.key.remoteJid, { text: menuText }, { quoted: m });

        } catch (error) {
            console.error("Error generating menu:", error);
            await sock.sendMessage(m.key.remoteJid, { text: "❌ Failed to generate menu." }, { quoted: m });
        }
    }
};
