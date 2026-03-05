const puppeteer = require('puppeteer');

console.log('🎵 TikTok Unfollow Bot Starting...');

// Configuration
const CONFIG = {
    HEADLESS: false, // Set to true to hide browser
    DELAY_BETWEEN_CYCLES: 800, // 0.8 seconds between each scan cycle (FASTER)
    SCROLL_AMOUNT: 600, // How much to scroll down each time
    UNFOLLOW_DELAY: 300, // 0.3 seconds delay between each unfollow click (FASTER)
};

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function unfollowNonFriends() {
    let browser;
    
    try {
        console.log('🌐 Connecting to your existing browser...');
        
        // Try to connect to existing Chrome instance
        try {
            browser = await puppeteer.connect({
                browserURL: 'http://localhost:9222',
                defaultViewport: null
            });
            console.log('✅ Connected to existing browser!');
        } catch (connectError) {
            console.log('⚠️  Could not connect to existing browser.');
            console.log('ℹ️  Opening a new browser window...');
            console.log('ℹ️  TIP: To use your existing browser next time, start Chrome with:');
            console.log('    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222\n');
            
            browser = await puppeteer.launch({
                headless: CONFIG.HEADLESS,
                defaultViewport: null,
                args: [
                    '--start-maximized',
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox'
                ]
            });
        }

        const pages = await browser.pages();
        const page = pages.length > 0 ? pages[0] : await browser.newPage();
        
        // Block unnecessary resources to speed things up
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (req.resourceType() === 'image' || req.resourceType() === 'media') {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log('📱 Opening TikTok in browser...');
        await page.goto('https://www.tiktok.com', { waitUntil: 'domcontentloaded' });

        console.log('\n✋ WAIT! Do these steps in the browser:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('1. ✅ LOG INTO your TikTok account');
        console.log('2. 👤 Go to YOUR PROFILE (click your icon)');
        console.log('3. 📋 CLICK on "Following" to open the popup');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\n⏸️  Then come back HERE and press ENTER to start!\n');

        // Wait for user to press enter
        await waitForEnter();

        let totalUnfollowed = 0;
        let cycleCount = 0;
        let noNewUsersCount = 0;
        const processedUsers = new Set(); // Track users we've already processed

        while (true) {
            cycleCount++;
            console.log(`\n🔄 Cycle ${cycleCount} - Scanning for users to unfollow...`);

            // Wait a bit for the page to load
            await wait(CONFIG.DELAY_BETWEEN_CYCLES);

            // Find all user rows - try multiple selectors
            let userRows = await page.$$('[data-e2e="user-list-item"]');
            
            // If not found, try alternative selectors
            if (userRows.length === 0) {
                userRows = await page.$$('[data-e2e="follow-item"]');
            }
            if (userRows.length === 0) {
                userRows = await page.$$('div[class*="UserItem"]');
            }
            if (userRows.length === 0) {
                // Try finding any div that contains a Follow button
                userRows = await page.$$('div:has(button)');
            }
            
            if (userRows.length === 0) {
                console.log('⚠️  No user rows found. Checking page structure...');
                
                // Debug: show what's actually on the page
                const debugInfo = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const buttonTexts = buttons.map(b => b.innerText).filter(t => t);
                    return {
                        buttonCount: buttons.length,
                        buttonSamples: buttonTexts.slice(0, 5)
                    };
                });
                
                console.log(`   Found ${debugInfo.buttonCount} buttons on page`);
                console.log(`   Sample button texts:`, debugInfo.buttonSamples);
                
                noNewUsersCount++;
                if (noNewUsersCount >= 5) {
                    console.log('❌ Could not find users for 5 cycles. Stopping.');
                    break;
                }
                continue;
            }

            console.log(`📋 Found ${userRows.length} user rows visible on screen`);

            let unfollowedThisCycle = 0;
            let friendsSkipped = 0;

            // Process each user row
            for (let i = 0; i < userRows.length; i++) {
                try {
                    const row = userRows[i];
                    
                    // Get the text content of the row
                    const rowText = await page.evaluate(el => el.innerText, row);
                    
                    // Create a simple identifier for this user (using their username or position)
                    const userIdentifier = rowText.split('\n')[0]; // First line usually has username
                    
                    // Skip if we've already processed this user
                    if (processedUsers.has(userIdentifier)) {
                        continue;
                    }
                    
                    processedUsers.add(userIdentifier);
                    
                    // Check if this is a friend or just following
                    const isFriend = rowText.includes('Friends');
                    const isFollowing = rowText.includes('Following');

                    if (isFriend) {
                        friendsSkipped++;
                        console.log(`👥 Skipping friend: ${userIdentifier}`);
                        continue;
                    }

                    if (isFollowing && !isFriend) {
                        // Find the button in this row
                        const button = await row.$('button');
                        
                        if (button) {
                            const buttonText = await page.evaluate(el => el.innerText, button);
                            
                            // Only click if it's a "Following" button (not already unfollowed)
                            if (buttonText.includes('Following') || buttonText.includes('Unfollow')) {
                                console.log(`❌ Unfollowing: ${userIdentifier}`);
                                await button.click();
                                unfollowedThisCycle++;
                                totalUnfollowed++;
                                
                                // Wait between unfollows to avoid rate limiting
                                await wait(CONFIG.UNFOLLOW_DELAY);
                            }
                        }
                    }
                } catch (error) {
                    console.log(`⚠️  Error processing user row: ${error.message}`);
                }
            }

            console.log(`\n📊 Cycle ${cycleCount} Summary:`);
            console.log(`   - Unfollowed: ${unfollowedThisCycle}`);
            console.log(`   - Friends skipped: ${friendsSkipped}`);
            console.log(`   - Total unfollowed so far: ${totalUnfollowed}`);

            // If we didn't unfollow anyone this cycle, we might be done
            if (unfollowedThisCycle === 0) {
                noNewUsersCount++;
                console.log(`⏸️  No new unfollows this cycle (${noNewUsersCount}/5)`);
                
                if (noNewUsersCount >= 5) {
                    console.log('\n✅ No more users to unfollow! Job complete.');
                    break;
                }
            } else {
                noNewUsersCount = 0; // Reset counter if we found someone to unfollow
            }

            // Scroll down to load more users
            console.log('📜 Scrolling to load more users...');
            await page.evaluate((scrollAmount) => {
                const popup = document.querySelector('[data-e2e="following-list"]') || 
                              document.querySelector('[role="dialog"]') ||
                              document.querySelector('.DivContainer');
                if (popup) {
                    popup.scrollBy(0, scrollAmount);
                } else {
                    window.scrollBy(0, scrollAmount);
                }
            }, CONFIG.SCROLL_AMOUNT);

            // Wait for new content to load
            await wait(CONFIG.DELAY_BETWEEN_CYCLES);
        }

        console.log('\n🎉 UNFOLLOW PROCESS COMPLETE!');
        console.log(`📈 Total accounts unfollowed: ${totalUnfollowed}`);
        console.log('👥 All your friends were kept safe!');

        console.log('\nBrowser will stay open for 10 seconds so you can verify...');
        await wait(10000);

    } catch (error) {
        console.error('❌ Error occurred:', error);
    } finally {
        if (browser) {
            console.log('🔒 Closing browser...');
            await browser.close();
        }
    }
}

// Helper function to wait for user to press Enter
function waitForEnter() {
    return new Promise((resolve) => {
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        readline.question('Press ENTER when ready...', () => {
            readline.close();
            resolve();
        });
    });
}

// Start the bot
unfollowNonFriends()
    .then(() => {
        console.log('✅ Bot finished successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Bot failed:', error);
        process.exit(1);
    });
