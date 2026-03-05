const puppeteer = require('puppeteer');

console.log('🎵 TikTok Unfollow Bot Starting...');

// Configuration
const CONFIG = {
    HEADLESS: false, // Set to true to hide browser
    DELAY_BETWEEN_CYCLES: 2000, // 2 seconds between each scan cycle
    SCROLL_AMOUNT: 600, // How much to scroll down each time
    UNFOLLOW_DELAY: 1000, // 1 second delay between each unfollow click
};

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function unfollowNonFriends() {
    let browser;
    
    try {
        console.log('🌐 Launching browser...');
        browser = await puppeteer.launch({
            headless: CONFIG.HEADLESS,
            defaultViewport: null,
            args: [
                '--start-maximized',
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox'
            ]
        });

        const page = await browser.newPage();
        
        // Block unnecessary resources to speed things up
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (req.resourceType() === 'image' || req.resourceType() === 'media') {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log('📱 Navigating to TikTok...');
        await page.goto('https://www.tiktok.com', { waitUntil: 'networkidle2' });

        console.log('\n⚠️  MANUAL STEP REQUIRED:');
        console.log('1. Log into your TikTok account');
        console.log('2. Navigate to your profile page');
        console.log('3. Click on your "Following" count to open the Following popup');
        console.log('4. Once the Following popup is open, press ENTER in this console...\n');

        // Wait for user to press enter
        await waitForEnter();

        console.log('✅ Starting unfollow process...\n');

        let totalUnfollowed = 0;
        let cycleCount = 0;
        let noNewUsersCount = 0;
        const processedUsers = new Set(); // Track users we've already processed

        while (true) {
            cycleCount++;
            console.log(`\n🔄 Cycle ${cycleCount} - Scanning for users to unfollow...`);

            // Wait a bit for the page to load
            await wait(CONFIG.DELAY_BETWEEN_CYCLES);

            // Find all user rows
            const userRows = await page.$$('[data-e2e="user-list-item"]');
            
            if (userRows.length === 0) {
                console.log('⚠️  No user rows found. Make sure the Following popup is open.');
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
