const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const RSSParser = require('rss-parser');
const express = require('express');
const fs = require('fs');
const path = require('path');

// 1. SETUP SERVER HTTP (Biar Railway aman)
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => { res.send('Bot MonitoRSS Embeds + Gambar Aktif!'); });
app.listen(PORT, () => { console.log(`Server HTTP aktif di port ${PORT}`); });

// 2. DATABASE LOCAL (File JSON)
const DB_PATH = path.join(__dirname, 'database.json');
let db = { targets: [] };

if (fs.existsSync(DB_PATH)) {
    try { db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch (e) { console.error(e); }
} else {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function saveDB() { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

// 3. SETUP BOT & RSS
const parser = new RSSParser();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const lastTrackedLinks = {};

// 4. DAFTARKAN SLASH COMMANDS
const commands = [
    new SlashCommandBuilder()
        .setName('rss-add')
        .setDescription('Tambah feed baru (YouTube/IG/TT/X via RSS)')
        .addStringOption(opt => opt.setName('url').setDescription('Masukkan URL RSS Feed').setRequired(true))
        .addChannelOption(opt => opt.setName('channel').setDescription('Pilih channel notifikasi').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(opt => opt.setName('nama').setDescription('Nama alias (contoh: YT_Pewdiepie)').setRequired(false))
        .addStringOption(opt => 
            opt.setName('warna')
               .setDescription('Warna garis Embed (Hex Code, contoh: #FF0000 untuk Merah)')
               .setRequired(false)),
               
    new SlashCommandBuilder()
        .setName('rss-list')
        .setDescription('Lihat semua feed yang aktif di server ini'),

    new SlashCommandBuilder()
        .setName('rss-remove')
        .setDescription('Hapus feed yang sedang dipantau')
        .addStringOption(opt => opt.setName('id').setDescription('Masukkan ID Feed yang mau dihapus').setRequired(true))
].map(cmd => cmd.toJSON());

client.once('ready', async () => {
    console.log(`Bot MonitoRSS Embeds ${client.user.tag} sudah Online!`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('Slash Commands Berhasil Didaftarkan!');
    } catch (error) { console.error(error); }

    checkMedsosRSS();
    setInterval(checkMedsosRSS, 300000); // Cek otomatis tiap 5 menit
});

// 5. LOGIKA RESPOND SLASH COMMAND
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options } = interaction;

    if (commandName === 'rss-add') {
        const url = options.getString('url');
        const channel = options.getChannel('channel');
        const nama = options.getString('nama') || 'Medsos Update';
        const warna = options.getString('warna') || '#00ffcc';
        const id = Date.now().toString().slice(-6);

        db.targets.push({ id, url, channelId: channel.id, nama, warna });
        saveDB();

        return interaction.reply({ 
            content: `✅ **Feed Berhasil Ditambahkan ke Sistem Embeds!**\n> 🆔 **ID Feed:** \`${id}\`\n> 📋 **Nama:** ${nama}\n> 📺 **Channel:** ${channel}\n> 🎨 **Warna Embed:** \`${warna}\``, 
            ephemeral: true 
        });
    }

    if (commandName === 'rss-list') {
        if (db.targets.length === 0) return interaction.reply({ content: 'Belum ada feed yang didaftarkan, brok.', ephemeral: true });
        let listText = db.targets.map(t => `🆔 \`${t.id}\` | **${t.nama}** -> <#${t.channelId}> (Warna: \`${t.warna}\`)\n🔗 URL: ${t.url}`).join('\n\n');
        return interaction.reply({ content: `📋 **Daftar Feed Aktif:**\n\n${listText}`, ephemeral: true });
    }

    if (commandName === 'rss-remove') {
        const id = options.getString('id');
        const index = db.targets.findIndex(t => t.id === id);
        if (index === -1) return interaction.reply({ content: '❌ ID Feed tidak ditemukan!', ephemeral: true });
        
        db.targets.splice(index, 1);
        saveDB();
        return interaction.reply({ content: `🗑️ Feed dengan ID \`${id}\` berhasil dihapus dari pemantauan!`, ephemeral: true });
    }
});

// 6. ENGINE PENGIRIM EMBEDS OTOMATIS (FIXED & SUPPORT GAMBAR)
async function checkMedsosRSS() {
    for (const target of db.targets) {
        try {
            const feed = await parser.parseURL(target.url);
            if (!feed.items || feed.items.length === 0) continue;

            const latestItem = feed.items[0];
            const key = target.id;

            if (!lastTrackedLinks[key]) {
                lastTrackedLinks[key] = latestItem.link;
                continue;
            }

            if (latestItem.link !== lastTrackedLinks[key]) {
                lastTrackedLinks[key] = latestItem.link;

                const channel = await client.channels.fetch(target.channelId);
                if (channel) {
                    // Perbaikan typo "constembedNotif" menjadi "const embedNotif"
                    const embedNotif = new EmbedBuilder()
                        .setAuthor({ name: feed.title || target.nama })
                        .setTitle(latestItem.title || 'Klik di sini untuk melihat postingan!')
                        .setURL(latestItem.link)
                        .setDescription(latestItem.contentSnippet || latestItem.content || 'Ada update konten terbaru, yuk langsung cek link di atas, brok!')
                        .setColor(target.warna)
                        .setTimestamp();

                    // LOGIKA DETEKSI DAN KIRIM GAMBAR / THUMBNAIL
                    // 1. Cek jika ini feed YouTube (punya struktur media:group)
                    if (latestItem['media:group'] && latestItem['media:group']['media:thumbnail']) {
                        const ytThumb = latestItem['media:group']['media:thumbnail'][0].$.url;
                        embedNotif.setImage(ytThumb); // Pasang thumbnail video ukuran besar
                    } 
                    // 2. Cek jika feed medsos lain (IG/TT/X) menyertakan data gambar standar (enclosure)
                    else if (latestItem.enclosure && latestItem.enclosure.url) {
                        embedNotif.setImage(latestItem.enclosure.url);
                    }

                    await channel.send({ 
                        content: `🔔 **Ada konten baru dari ${feed.title || target.nama}!**`, 
                        embeds: [embedNotif] 
                    });
                }
            }
        } catch (e) {
            console.error(`Gagal sinkronisasi feed [${target.nama}]:`, e.message);
        }
    }
}

client.login(process.env.DISCORD_TOKEN);
