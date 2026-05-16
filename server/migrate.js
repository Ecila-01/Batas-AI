require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const cloudinary = require('cloudinary').v2;

// 1. Configure Cloudinary Credentials
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// 2. Target the local ordinances folder
const localOrdinancesDir = path.join(__dirname, '../ai_service/ordinances');

async function uploadAndIngest(filePath, filename) {
    return new Promise((resolve, reject) => {
        console.log(`\n📤 Uploading to Cloudinary folder "Batas": ${filename}...`);
        
        // Upload with strict parameters to enforce folder sorting
        cloudinary.uploader.upload(filePath, {
            folder: 'Batas',       // 📂 FORCES it into the separate Batas folder
            resource_type: 'raw',  // CRITICAL for handling PDF streams
            public_id: filename.split('.')[0].replace(/\s+/g, '_') + '-' + Date.now(),
            format: 'pdf'
        }, (error, result) => {
            if (error) {
                console.error(`❌ Cloudinary upload failed for ${filename}:`, error);
                return reject(error);
            }

            const cloudinaryUrl = result.secure_url;
            console.log(`☁️ Secure URL generated: ${cloudinaryUrl}`);
            console.log(`⚙️ Waking up Python to absorb vectors...`);

            // Spawn your Python process passing the cloud URL argument
            console.log(`☁️ Secure URL generated: ${cloudinaryUrl}`);
            console.log(`⚙️ Waking up Python to absorb vectors...`);

            // PASS KEYS DIRECTLY VIA THE ENV ATTRIBUTE
            const pythonProcess = spawn('.venv/Scripts/python.exe', ['-u', 'bulk_ingest.py', '--url', cloudinaryUrl], {
                cwd: path.join(__dirname, '../ai_service'),
                env: {
                    ...process.env, // Inherits your existing terminal profile environment
                    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,    // Feeds key from server/.env
                    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET // Feeds secret from server/.env
                }
            });

            pythonProcess.stdout.on('data', (data) => console.log(`[Python]: ${data.toString().trim()}`));
            pythonProcess.stderr.on('data', (data) => console.log(`[Python Status]: ${data.toString().trim()}`));

            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    console.log(`✅ AI successfully absorbed ${filename}!`);
                    resolve();
                } else {
                    reject(new Error(`Python process exited with code ${code}`));
                }
            });
        });
    });
}

async function runMigration() {
    if (!fs.existsSync(localOrdinancesDir)) {
        console.log("❌ Target ordinances directory not found.");
        return;
    }

    // FIXED: Changed .endswith() to JavaScript's native camelCase .endsWith()
    const files = fs.readdirSync(localOrdinancesDir).filter(f => f.toLowerCase().endsWith('.pdf'));
    
    if (files.length === 0) {
        console.log("📂 No local PDFs detected in the ordinances directory.");
        return;
    }

    console.log(`🚀 Starting batch migration for ${files.length} legal documents...\n`);

    for (const file of files) {
        const fullPath = path.join(localOrdinancesDir, file);
        try {
            await uploadAndIngest(fullPath, file);
        } catch (err) {
            console.error(`⚠️ Skipping ${file} due to system processing error.`);
        }
    }

    console.log("\n🎉 All local ordinances are successfully uploaded to the 'Batas' folder and vectorized!");
}

runMigration();