// Homework Plug Official Bot - API Service
// This wraps the Sparx Reader bot into an Express API
// Run on AWS: pm2 start hwplug-bot-api.js --name hwplug-bot

// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());

// Bot configuration from environment variables
const CONFIG = {
    PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY || '',
    HEADLESS: process.env.HEADLESS === 'true' || false,
    DISPLAY: process.env.DISPLAY || ':0'
};

console.log('\n' + '='.repeat(60));
console.log('🤖 HOMEWORK PLUG OFFICIAL BOT - API SERVICE');
console.log('='.repeat(60));
console.log(`🔧 Perplexity API: ${CONFIG.PERPLEXITY_API_KEY ? '✅ Configured' : '❌ Missing'}`);
console.log(`👁️  Headless Mode: ${CONFIG.HEADLESS ? '🔒 Hidden' : '👁️ Visible'}`);
console.log(`🖥️  Display: ${CONFIG.DISPLAY}`);
console.log('='.repeat(60) + '\n');

// Store the reading passage text
let storedPassageText = '';

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'online',
        service: 'Homework Plug Official Bot',
        platform: 'Sparx Reader',
        timestamp: new Date().toISOString()
    });
});

// Submit homework endpoint
app.post('/submit-homework', async (req, res) => {
    const { username, password, school, loginType } = req.body;
    
    console.log('\n' + '='.repeat(60));
    console.log('📥 NEW HOMEWORK REQUEST');
    console.log('='.repeat(60));
    console.log(`🏫 School: ${school || 'Not provided'}`);
    console.log(`👤 Username: ${username}`);
    console.log(`🔐 Password: ${password ? '***' : 'Missing'}`);
    console.log(`🔑 Login Type: ${loginType || 'Google (default)'}`);
    console.log('='.repeat(60) + '\n');
    
    if (!username || !password) {
        console.error('❌ Missing credentials!');
        return res.status(400).json({ 
            success: false, 
            error: 'Username and password are required' 
        });
    }
    
    if (!CONFIG.PERPLEXITY_API_KEY) {
        console.error('❌ Perplexity API key not configured!');
        return res.status(500).json({ 
            success: false, 
            error: 'Bot not configured properly - missing Perplexity API key' 
        });
    }
    
    // Immediately respond to avoid timeout
    res.json({ 
        success: true, 
        message: 'Homework Plug Bot started processing',
        platform: 'Sparx Reader'
    });
    
    // Run bot in background
    runSparxReaderBot(school, username, password, loginType).catch(error => {
        console.error('❌ Bot error:', error.message);
    });
});

// Main bot function
async function runSparxReaderBot(schoolName, username, password, loginType = 'Google') {
    console.log('🤖 Starting Homework Plug Official Bot...');
    console.log('📚 Platform: Sparx Reader');
    console.log(`🔑 Login Type: ${loginType}\n`);

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: CONFIG.HEADLESS,
            args: [
                '--start-minimized',  // Start minimized so it doesn't interrupt gaming
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ],
            defaultViewport: { width: 1920, height: 1080 }, // Full HD for better element detection
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
        });

        const page = await browser.newPage();
        
        // Step 1: Navigate to Sparx Reader School Selection
        console.log('Step 1: Navigating to Sparx Reader school selection...');
        await page.goto('https://selectschool.sparx-learning.com/?app=sparx_learning&route=https%3A%2F%2Freader.sparx-learning.com%2F', { waitUntil: 'domcontentloaded' });

        // Step 2: Select School
        console.log('Step 2: Selecting school...');
        await selectSchool(page, schoolName);

        // Step 3: Close cookie banner (BEFORE login!)
        console.log('Step 3: Closing cookie banner...');
        await closeCookieBanner(page);

        // Step 4: Login
        console.log('Step 4: Logging in...');
        await login(page, username, password, loginType);

        // Step 5: Navigate to reading
        console.log('Step 5: Navigating to reading task...');
        await startReading(page);

        // Main Loop: Repeat until 300 SRP is earned
        console.log('\n📚 Starting reading loop - Target: 300 SRP\n');
        let roundNumber = 1;
        let maxRounds = 100; // High safety limit - bot will stop when 300 SRP reached
        
        while (roundNumber <= maxRounds) {
            console.log(`\n=== Round ${roundNumber} ===`);
            
            // Close cookie banner if it appears (can happen randomly!)
            await closeCookieBanner(page, true);
            await delay(500); // Brief pause to let page stabilize
            
            // Check if we're on the progress page or reading page
            await delay(1000);
            const pageType = await checkPageType(page);
            console.log(`   📍 Current page: ${pageType}`);
            
            if (pageType === 'progress') {
                // We're on progress screen - check SRP and continue
                const currentSRP = await getSRPProgress(page);
                console.log(`   📊 Progress: ${currentSRP} / 300 SRP`);
                
                if (currentSRP >= 300) {
                    console.log('\n' + '='.repeat(60));
                    console.log('🎉 SUCCESS! TARGET REACHED!');
                    console.log('='.repeat(60));
                    console.log(`✅ Final SRP: ${currentSRP} / 300`);
                    console.log(`✅ Rounds completed: ${roundNumber}`);
                    console.log('🔒 Closing browser and ending session...');
                    console.log('='.repeat(60) + '\n');
                    break;
                }
                
                // Click "Continue reading" or "Next" to start next passage
                console.log('   Looking for Continue/Next button...');
                let clicked = await clickContinueReading(page);
                if (!clicked) {
                    clicked = await clickButton(page, 'Next');
                }
                await delay(1000); // Faster transition to next passage
                
            } else if (pageType === 'reading') {
                // We're on reading page - extract text and answer questions
                
                // Step 5: Read and extract the passage
                console.log('Step 5: Extracting passage text...');
                await extractPassageFromMarkers(page);
                
                // Close cookie banner before clicking buttons!
                await closeCookieBanner(page, true);
                
                // Step 6: Click "I have read up to here" (optional - might not exist)
                console.log('Step 6: Clicking "I have read up to here"...');
                const readClicked = await clickIHaveReadUpToHere(page);
                if (readClicked) {
                    await delay(1500);
                    
                    // Step 6b: Click "Yes, ask me the questions." (OPTIONAL - only appears sometimes!)
                    console.log('Step 6b: Confirming "Yes, ask me the questions."...');
                    await clickYesAskQuestions(page); // Don't check result - it's optional!
                    await delay(1000);
                }
                
                // Check if we're on questions page now
                const currentPageType = await checkPageType(page);
                if (currentPageType === 'questions') {
                    // Step 7: Answer all questions
                    console.log('Step 7: Answering questions with AI...');
                    await answerAllQuestions(page);
                    await delay(800);
                } else {
                    console.log(`   ℹ️  Not on questions page yet (on: ${currentPageType}), continuing loop...`);
                }
                
            } else if (pageType === 'confirmation') {
                // On confirmation popup - click "Yes, ask me the questions"
                console.log('   Clicking "Yes, ask me the questions."...');
                await clickYesAskQuestions(page);
                await delay(2000);
                
            } else if (pageType === 'questions') {
                // On questions page - answer them
                console.log('   Answering questions...');
                await answerAllQuestions(page);
                await delay(800); // Quick check after questions
                
            } else if (pageType === 'success') {
                // Passed! Click "Next" to continue
                const score = await page.evaluate(() => {
                    const match = document.body.innerText.match(/Your score was (\d+\/\d+)/);
                    return match ? match[1] : 'unknown';
                });
                console.log(`   ✅ SUCCESS! Score: ${score}`);
                let clicked = await clickButton(page, 'Next');
                if (!clicked) {
                    clicked = await clickButton(page, 'Retry');
                }
                await delay(1000); // Faster transition
                
            } else if (pageType === 'retry') {
                // Failed - Click "Retry" or "Next" to try again
                const score = await page.evaluate(() => {
                    const match = document.body.innerText.match(/Your score was (\d+\/\d+)/);
                    return match ? match[1] : 'unknown';
                });
                console.log(`   ❌ FAILED - Score: ${score}. Clicking Next/Retry...`);
                let clicked = await clickButton(page, 'Retry');
                if (!clicked) {
                    clicked = await clickButton(page, 'Next');
                }
                await delay(1000); // Faster retry
                
            } else if (pageType === 'swap_book') {
                // Book swap suggestion - click "Keep trying" to stay with current book
                console.log(`   📖 Book swap suggested - clicking "Keep trying"...`);
                const clicked = await clickButton(page, 'Keep trying');
                if (!clicked) {
                    // Try alternate button text
                    await clickContinueReading(page);
                }
                await delay(2000);
                
            } else if (pageType === 'moved_back') {
                // Moved back in story after failures - click "Start" to continue
                console.log(`   ⏪ Moved back in story - clicking Start...`);
                await clickButton(page, 'Start');
                await delay(2000);
                
            } else if (pageType === 'book_completed') {
                // Book completed! Rate it and choose another book
                console.log(`   🎉 BOOK COMPLETED! Starting next book...`);
                
                // Step 1: Rate the book (click "About right" star)
                console.log(`   ⭐ Rating book...`);
                await closeCookieBanner(page, true);
                await delay(1000);
                
                // Click on "About right" emoji/star (middle option)
                let ratingClicked = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('button, div[role="button"], img, svg'));
                    for (const btn of buttons) {
                        const text = (btn.textContent || btn.alt || '').toLowerCase();
                        if (text.includes('about right') || text.includes('right')) {
                            btn.click();
                            return true;
                        }
                    }
                    // Fallback: click 3rd button/emoji (usually "About right")
                    const allButtons = Array.from(document.querySelectorAll('button[aria-label], img[alt]'));
                    if (allButtons.length >= 3) {
                        allButtons[2].click();
                        return true;
                    }
                    return false;
                });
                
                if (ratingClicked) {
                    console.log(`   ✓ Rated book`);
                }
                await delay(1500);
                
                // Step 2: Click "Choose another book"
                console.log(`   📚 Choosing another book...`);
                await clickButton(page, 'Choose another book');
                await delay(2000);
                
                // Step 3: Click "Choose this book" or "Start reading" on popup
                console.log(`   ✅ Selecting new book...`);
                await clickButton(page, 'Choose this book');
                await delay(1500);
                await clickButton(page, 'Start reading');
                await delay(3000);
                
                console.log(`   ✓ New book started!`);
                
            } else if (pageType === 'book_feedback') {
                // Book feedback survey - select "About right" and continue
                console.log(`   📝 Book feedback survey - selecting difficulty...`);
                let clicked = await clickButton(page, 'About\nright');
                if (!clicked) {
                    clicked = await clickButton(page, 'A little\neasy');
                }
                await delay(1000);
                await clickContinueReading(page);
                await delay(2000);
                
            } else {
                // Unknown page - show what's on screen for debugging
                const bodyPreview = await page.evaluate(() => document.body.innerText.substring(0, 300));
                console.log('   ⚠️ UNKNOWN PAGE TYPE!');
                console.log(`   📄 Page preview: ${bodyPreview}`);
                await delay(3000);
            }
            
            roundNumber++;
        }
        
        if (roundNumber > maxRounds) {
            console.log('\n⏸️ Reached maximum rounds. Check progress manually.');
        }

        console.log('\n✅ Bot completed successfully!');

    } catch (error) {
        console.error('❌ Error occurred:', error);
        throw error;
    } finally {
        if (browser) {
            console.log('🔒 Closing browser...');
            await browser.close();
            console.log('✅ Browser closed successfully\n');
        }
    }
}

// Helper functions (same as your original bot)

async function selectSchool(page, schoolName) {
    try {
        // Close cookie banner if present
        await closeCookieBanner(page, true);
        
        await page.waitForSelector('input[type="text"], select, [placeholder*="school" i]', { timeout: 5000 });
        
        const schoolInput = await page.$('input[type="text"]');
        
        if (schoolInput && schoolName) {
            await schoolInput.type(String(schoolName), { delay: 30 });
            await delay(300);
            await page.keyboard.press('Enter');
            await delay(500);
        }
        
        // Close cookie banner again before clicking continue
        await closeCookieBanner(page, true);
        
        const buttons = await page.$$('button, a, input[type="submit"]');
        for (const button of buttons) {
            const text = await page.evaluate(el => el.textContent || el.value, button);
            if (text.match(/continue/i)) {
                await button.click();
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
                break;
            }
        }
        
        console.log('   ✓ School selected and continued');
    } catch (error) {
        console.log('   ⚠️  School selection might need manual adjustment');
        throw error;
    }
}

async function login(page, username, password, loginType = 'Google') {
    try {
        // Wait for the login page to fully load
        await delay(2500);
        
        // Close cookie banner BEFORE trying to find login buttons!
        console.log('   🍪 Checking for cookie banner...');
        await closeCookieBanner(page);
        await delay(1000);
        
        console.log(`   🔑 Login method: ${loginType}`);
        
        // Check if we need to click "Log in with Google/Microsoft" button
        if (loginType === 'Google' || loginType === 'Microsoft') {
            const searchText = loginType === 'Google' ? 'google' : 'microsoft';
            console.log(`   🔍 Looking for "${loginType}" login button...`);
            
            // Close cookie banner one more time (it can appear randomly!)
            await closeCookieBanner(page, true);
            await delay(1000); // Wait longer!
            
            // Find and click the Google/Microsoft button using the SAME method as "Continue Reading"!
            console.log(`   📋 Searching for Sparx ${loginType} login button (any variation)...`);
            
            let result;
            try {
                result = await page.evaluate((searchType) => {
                    const debugInfo = {
                        found: false,
                        method: '',
                        text: '',
                        clicked: false,
                        buttonCount: 0,
                        checkedTexts: []
                    };
                    
                    // Search ONLY CLICKABLE elements (buttons, links, clickable divs/spans)
                    const allElements = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"], [onclick], input[type="button"], input[type="submit"]'));
                    debugInfo.buttonCount = allElements.length;
                    
                    for (const el of allElements) {
                        const text = (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim();
                        const textLower = text.toLowerCase();
                        const searchLower = searchType.toLowerCase();
                        
                        // Store first 10 button texts for debugging
                        if (debugInfo.checkedTexts.length < 10) {
                            debugInfo.checkedTexts.push(text.substring(0, 50));
                        }
                        
                        // ONLY look for exact text: "Log in to Sparx using Google/Microsoft"
                        const matches = textLower.includes(`log in to sparx using ${searchLower}`);
                        
                        if (matches) {
                            // Make sure it's visible
                            const rect = el.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                                debugInfo.found = true;
                                debugInfo.text = text;
                                debugInfo.method = 'exact text match';
                                el.click();
                                debugInfo.clicked = true;
                                return debugInfo;
                            }
                        }
                    }
                    
                    return debugInfo;
                }, loginType);
            } catch (error) {
                // Page navigated during button search - might have auto-logged in!
                console.log(`   ℹ️  Page changed during button search (might have auto-logged in)`);
                result = { found: false, clicked: false };
            }
            
            // Log result
            console.log(`   📋 Searched ${result.buttonCount} clickable elements`);
            if (result.checkedTexts.length > 0) {
                console.log(`   📋 First ${result.checkedTexts.length} button texts:`);
                result.checkedTexts.forEach((text, i) => {
                    console.log(`      [${i}] "${text}"`);
                });
            }
            if (result.found) {
                console.log(`   ✅ Found "${loginType}" button: "${result.text.substring(0, 60)}"`);
            } else {
                console.log(`   ⚠️  Could not find Sparx ${loginType} login button`);
            }
            
            buttonClicked = result.clicked;
            
            if (buttonClicked) {
                console.log(`   ✅ Clicked "${loginType}" login button!`);
                await delay(2000);
                
                // Wait for Google/Microsoft OAuth page to load
                console.log(`   ⏳ Waiting for ${loginType} OAuth page...`);
                await delay(2000);
                
                // Enter credentials in Google/Microsoft login page
                await page.waitForSelector('input[type="email"], input[type="text"]', { timeout: 8000 });
                
                const emailField = await page.$('input[type="email"], input[type="text"]');
                if (emailField) {
                    await emailField.type(username, { delay: 30 });
                    console.log(`   ✓ Email entered (${loginType})`);
                    await delay(500);
                    await page.keyboard.press('Enter');
                    console.log(`   ⏳ Waiting for password page to load...`);
                    await delay(1500); // FASTER - just enough for Google to load password page
                }
                
                // Enter password
                await page.waitForSelector('input[type="password"]', { timeout: 10000 });
                const passwordField = await page.$('input[type="password"]');
                if (passwordField) {
                    await passwordField.type(password, { delay: 30 });
                    console.log(`   ✓ Password entered (${loginType})`);
                    await delay(500);
                    await page.keyboard.press('Enter');
                    console.log(`   ✓ Submitted ${loginType} login`);
                    await delay(3000);
                }
                
            } else {
                console.log(`   ⚠️  "${loginType}" button not found, trying direct login...`);
                // Fall through to direct login below
            }
        } else {
            console.log('   📝 Using direct login (username/password fields)');
        }
        
        // Direct login (only if Google/Microsoft button wasn't clicked OR loginType is 'Direct')
        if ((loginType !== 'Google' && loginType !== 'Microsoft') || !buttonClicked) {
            await page.waitForSelector('input[type="text"], input[name*="user" i], input[id*="user" i], input[type="email"]', { timeout: 5000 });
            
            const usernameField = await page.$('input[type="text"], input[name*="user" i], input[type="email"]');
            if (usernameField) {
                await usernameField.type(username, { delay: 30 });
                console.log('   ✓ Username entered (Direct)');
            }
            
            const passwordField = await page.$('input[type="password"]');
            if (passwordField) {
                await passwordField.type(password, { delay: 30 });
                console.log('   ✓ Password entered (Direct)');
            }
        }
        
        // Click login/submit button
        const buttons = await page.$$('button, input[type="submit"]');
        let loginClicked = false;
        for (const button of buttons) {
            const text = await page.evaluate(el => el.textContent || el.value, button);
            // Match "Log in", "Sign in", "Next", "Continue", etc.
            if (text.match(/^(log\s*in|sign\s*in|next|continue)$/i)) {
                await button.click();
                loginClicked = true;
                console.log(`   ✓ Clicked "${text}" button`);
                break;
            }
        }
        
        if (!loginClicked) {
            console.log('   ⚠️  No login button found, pressing Enter...');
            await page.keyboard.press('Enter');
        }
        
        // Wait for login to complete (don't use waitForNavigation as it can timeout on Google OAuth)
        console.log('   ⏳ Waiting for login to complete...');
        await delay(4000); // Faster login wait
        console.log('   ✅ Logged in successfully');
    } catch (error) {
        console.log('   ⚠️  Login might need manual adjustment');
        throw error;
    }
}

// Close cookie banner (call this EVERYWHERE!)
// This function checks for cookie banners and closes them if found
// Can be called multiple times - it's fast and non-blocking
async function closeCookieBanner(page, silent = false) {
    try {
        const clicked = await page.evaluate(() => {
            const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a'));
            for (const btn of allButtons) {
                const text = btn.textContent.trim();
                const ariaLabel = btn.getAttribute('aria-label') || '';
                // Look for X button or "Accept All" cookies button
                if (text === '×' || text === 'X' || text === '✕' || 
                    text.toLowerCase().includes('accept all') ||
                    text.toLowerCase().includes('accept cookies') ||
                    ariaLabel.toLowerCase().includes('close') || 
                    ariaLabel.toLowerCase().includes('dismiss')) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });
        
        if (clicked && !silent) {
            console.log('   ✓ Closed cookie banner');
            await delay(500);
        }
        return clicked;
    } catch (error) {
        // Silent fail - cookie banner check shouldn't break the flow
        return false;
    }
}

// Navigate to reading task (call this AFTER login!)
async function startReading(page) {
    try {
        console.log('   ⏳ Waiting for page to load...');
        await delay(1500); // Faster page load wait
        
        // Close cookie banner if present!
        console.log('   🍪 Closing cookie banner...');
        await closeCookieBanner(page);
        await delay(300); // Faster cookie banner wait
        
        console.log('   📋 Looking for Start button...');
        await page.waitForSelector('button, a', { timeout: 10000 }).catch(() => {
            console.log('   ⚠️  Timeout waiting for buttons');
        });
        
        // Click "Continue your current task" OR "Start your current task"
        let buttons = await page.$$('button, a');
        console.log(`   📋 Found ${buttons.length} buttons/links`);
        
        let foundButton = false;
        for (const button of buttons) {
            const text = await page.evaluate(el => el.textContent, button);
            const cleanText = text.replace(/\s+/g, ' ').trim();
            
            // Log buttons that might be relevant
            if (cleanText.toLowerCase().includes('start') || cleanText.toLowerCase().includes('task') || cleanText.toLowerCase().includes('continue')) {
                console.log(`      Button: "${cleanText.substring(0, 60)}"`);
            }
            
            // Look for "Continue your current task" OR "Start your current task"
            if (text.match(/(continue|start).*(current\s*task)/i)) {
                await button.click();
                console.log(`   ✅ Clicked "${cleanText.substring(0, 50)}"`);
                await delay(1000); // Faster - just enough for popup to appear
                foundButton = true;
                break;
            }
        }
        
        if (!foundButton) {
            console.log('   ⚠️  No task button found');
        }
        
        // Wait for the book popup to appear
        console.log('   ⏳ Waiting for book popup to load...');
        await delay(1500);
        
        // CRITICAL: Close cookie banner FIRST! (it appears as a popup and blocks the real book popup!)
        console.log('   🍪 Closing any cookie banners...');
        await closeCookieBanner(page);
        await delay(500);
        await closeCookieBanner(page, true); // Try again!
        await delay(500);
        
        // Now click "Start reading" or "Continue reading" button IN THE POPUP
        console.log('   📋 Looking for "Start/Continue reading" button in popup...');
        await delay(1000); // Brief wait for real book popup after cookies cleared
        
        // Try clicking the button - FIRST find the popup, THEN find button inside it
        const result = await page.evaluate(() => {
            const debugInfo = {
                popupFound: false,
                popupMethod: '',
                buttons: [],
                clicked: false,
                matchedButton: null
            };
            
            // Step 1: Find the BOOK POPUP (skip cookie popups!)
            let popup = null;
            const allPopups = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], .modal, [class*="modal"], [class*="popup"], [class*="dialog"]'));
            
            // Filter out cookie popups - look for popup with reading-related content
            for (const p of allPopups) {
                const text = p.textContent || '';
                // Skip if it looks like a cookie popup
                if (text.includes('Accept all') || text.includes('Decline all') || text.includes('Cookie')) {
                    continue; // Skip cookie popups!
                }
                // This might be the book popup!
                popup = p;
                debugInfo.popupFound = true;
                debugInfo.popupMethod = 'role/class selector (filtered)';
                break;
            }
            
            // If no popup found by role/class, look for element with book description
            if (!popup) {
                const allDivs = Array.from(document.querySelectorAll('div'));
                for (const div of allDivs) {
                    const text = div.textContent || '';
                    // Look for div containing book-related text
                    if (text.includes('Show more') || text.includes('show more')) {
                        popup = div;
                        debugInfo.popupFound = true;
                        debugInfo.popupMethod = 'Show more text';
                        break;
                    }
                }
            }
            
            if (!popup) {
                popup = document.body; // Fallback to whole page
                debugInfo.popupMethod = 'fallback to body';
            }
            
            // Step 2: Search for buttons ONLY INSIDE the popup
            const buttons = Array.from(popup.querySelectorAll('button, a, [role="button"]'));
            
            // DETAILED LOGGING: Collect ALL buttons info
            buttons.forEach((btn) => {
                const text = (btn.textContent || btn.innerText || '').replace(/\s+/g, ' ').trim();
                const rect = btn.getBoundingClientRect();
                debugInfo.buttons.push({
                    text: text,
                    visible: rect.width > 0 && rect.height > 0,
                    width: rect.width,
                    height: rect.height
                });
            });
            
            // Step 3: Look for the reading button (PRIORITIZE "Continue Reading" over "Start reading"!)
            let continueReadingBtn = null;
            let startReadingBtn = null;
            
            for (const btn of buttons) {
                const text = (btn.textContent || btn.innerText || '').toLowerCase().replace(/\s+/g, ' ').trim();
                const rect = btn.getBoundingClientRect();
                const visible = rect.width > 0 && rect.height > 0;
                
                // Look for "Continue Reading" (PRIORITY!)
                if ((text === 'continue reading' || text.includes('continue reading')) && visible) {
                    continueReadingBtn = { btn, text };
                }
                // Look for "Start Reading" (fallback)
                else if ((text === 'start reading' || text.includes('start reading')) && visible) {
                    startReadingBtn = { btn, text };
                }
            }
            
            // Click "Continue Reading" first, then "Start Reading" as fallback
            const targetBtn = continueReadingBtn || startReadingBtn;
            if (targetBtn) {
                debugInfo.matchedButton = { text: targetBtn.text, visible: true };
                targetBtn.btn.click();
                debugInfo.clicked = true;
                return debugInfo;
            }
            
            return debugInfo;
        });
        
        // NOW log the debug info in Node.js (where we can see it!)
        console.log(`   🔍 DEBUG: Popup found: ${result.popupFound} (via ${result.popupMethod})`);
        console.log(`   🔍 DEBUG: Found ${result.buttons.length} buttons in popup:`);
        result.buttons.forEach((btn, i) => {
            console.log(`      [${i}] "${btn.text.substring(0, 60)}" (visible: ${btn.visible})`);
        });
        if (result.matchedButton) {
            console.log(`   🎯 DEBUG: Matched button: "${result.matchedButton.text}" (visible: ${result.matchedButton.visible})`);
        }
        
        const clicked = result.clicked;
        
        if (clicked) {
            console.log(`   ✅ Clicked "Start/Continue reading" in popup`);
            console.log(`   ⏳ Waiting for reading page to load...`);
            await delay(2000); // Quick wait for reading page to load
        } else {
            console.log(`   ⚠️  Could not find "Start reading" or "Continue reading" button in popup`);
        }
        
        console.log('   ✓ Navigated to reading page');
    } catch (error) {
        console.log('   ⚠️  Error navigating to reading page');
        throw error;
    }
}

async function extractPassageFromMarkers(page) {
    try {
        const buttons = await page.$$('a, button, [role="button"]');
        for (const button of buttons) {
            const text = await page.evaluate(el => el.textContent, button);
            if (text.match(/click here.*ready.*start reading/i)) {
                await button.click();
                console.log('   ✓ Clicked "Click here when you\'re ready to start reading"');
                await delay(2000);
                break;
            }
        }
        
        await delay(2000);
        
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    
                    if(totalHeight >= document.body.scrollHeight){
                        clearInterval(timer);
                        window.scrollTo(0, 0);
                        setTimeout(resolve, 500);
                    }
                }, 150);
            });
        });
        
        console.log('   ✓ Scrolled through page');
        
        const result = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            
            const possibleStartMarkers = [
                'Start reading from here',
                'Start reading here'
            ];
            const possibleStopMarkers = [
                'Stop reading from here',
                'Stop reading here'
            ];
            
            let startIndex = -1;
            let stopIndex = -1;
            let usedStartMarker = '';
            let usedStopMarker = '';
            
            for (const marker of possibleStartMarkers) {
                const idx = bodyText.indexOf(marker);
                if (idx !== -1) {
                    startIndex = idx;
                    usedStartMarker = marker;
                    break;
                }
            }
            
            for (const marker of possibleStopMarkers) {
                const idx = bodyText.indexOf(marker);
                if (idx !== -1) {
                    stopIndex = idx;
                    usedStopMarker = marker;
                    break;
                }
            }
            
            if (startIndex === -1 || stopIndex === -1) {
                return {
                    success: false,
                    bodyPreview: bodyText.substring(0, 800),
                    foundStart: startIndex !== -1,
                    foundStop: stopIndex !== -1,
                    usedStartMarker,
                    usedStopMarker
                };
            }
            
            const passage = bodyText.substring(startIndex + usedStartMarker.length, stopIndex).trim();
            return {
                success: true,
                passage: passage
            };
        });
        
        if (!result.success) {
            console.log('   ⚠️  Could not find markers!');
            console.log(`   Found start marker: ${result.foundStart}`);
            console.log(`   Found stop marker: ${result.foundStop}`);
            console.log(`   Page preview:\n${result.bodyPreview}\n`);
            storedPassageText = '';
        } else {
            storedPassageText = result.passage;
            console.log(`   ✓ Extracted passage (${storedPassageText.length} characters)`);
            console.log(`   📝 Preview: ${storedPassageText.substring(0, 300)}...\n`);
        }
    } catch (error) {
        console.log('   ⚠️  Error extracting passage text:', error.message);
        throw error;
    }
}

function checkPageType(page) {
    return page.evaluate(() => {
        const bodyText = document.body.innerText;
        
        // CHECK QUESTIONS FIRST! (highest priority - questions can appear with passage text in background)
        if (bodyText.match(/Q\d+\./)) {
            return 'questions';
        }
        // Check for completion/feedback states
        if (bodyText.includes('Congratulations') && bodyText.includes('You finished')) {
            return 'book_completed';
        } else if (bodyText.includes('How much do you like this book') || bodyText.includes('How easy or difficult was this book')) {
            return 'book_feedback';
        } else if (bodyText.includes('Let\'s try again') && bodyText.includes('moved you back')) {
            return 'moved_back';
        } else if (bodyText.includes('Would you like to swap this book')) {
            return 'swap_book';
        } else if (bodyText.includes('Well done') && bodyText.includes('Your score was')) {
            return 'success';
        } else if (bodyText.includes('Have another go') && bodyText.includes('Your score was')) {
            return 'retry';
        } else if (bodyText.includes('Did you read carefully')) {
            return 'confirmation';
        } else if (bodyText.includes('Task progress') || bodyText.includes('Continue reading to earn')) {
            return 'progress';
        } else if (bodyText.includes('Start reading here') || bodyText.includes('Click here when you\'re ready')) {
            return 'reading';
        } else {
            return 'unknown';
        }
    });
}

function getSRPProgress(page) {
    return page.evaluate(() => {
        const bodyText = document.body.innerText;
        const match = bodyText.match(/(\d+)\s*\/\s*300\s*SRP/);
        if (match) {
            return parseInt(match[1]);
        }
        return 0;
    });
}

async function clickContinueReading(page) {
    try {
        const buttons = await page.$$('button, a');
        for (const button of buttons) {
            const text = await page.evaluate(el => el.textContent, button);
            if (text.match(/continue\s*reading/i)) {
                await button.click();
                console.log('   ✓ Clicked "Continue reading"');
                return true;
            }
        }
        return false;
    } catch (error) {
        return false;
    }
}

async function clickButton(page, buttonText) {
    try {
        await closeCookieBanner(page, true); // Close cookie banner before clicking
        
        const buttons = await page.$$('button, a, div[role="button"]');
        for (const button of buttons) {
            const text = await page.evaluate(el => (el.textContent || el.innerText || '').trim(), button);
            const cleanText = text.replace(/\s+/g, ' ');
            const searchText = buttonText.toLowerCase().replace(/\s+/g, ' ');
            
            // Exact match or contains match
            if (cleanText.toLowerCase() === searchText || cleanText.toLowerCase().includes(searchText)) {
                await button.click();
                console.log(`   ✓ Clicked "${buttonText}"`);
                return true;
            }
        }
        console.log(`   ⚠️  Could not find "${buttonText}" button`);
        return false;
    } catch (error) {
        console.log(`   ⚠️  Error clicking "${buttonText}"`);
        return false;
    }
}

async function clickIHaveReadUpToHere(page) {
    try {
        await page.evaluate(() => window.scrollTo(0, 0));
        await delay(500);
        
        const buttons = await page.$$('button, a');
        for (const button of buttons) {
            const text = await page.evaluate(el => el.textContent, button);
            if (text.match(/I\s*have\s*read\s*up\s*to\s*here/i)) {
                await button.click();
                console.log('   ✓ Clicked "I have read up to here"');
                await delay(1000);
                return true; // Successfully clicked!
            }
        }
        
        console.log('   ⚠️  Could not find "I have read up to here" button');
        return false; // Button not found
    } catch (error) {
        console.log('   ⚠️  Error clicking "I have read up to here"');
        return false; // Error occurred
    }
}

async function clickYesAskQuestions(page) {
    try {
        const buttons = await page.$$('button');
        for (const button of buttons) {
            const text = await page.evaluate(el => el.textContent, button);
            if (text.match(/yes.*ask.*questions/i)) {
                await button.click();
                console.log('   ✓ Clicked "Yes, ask me the questions."');
                return;
            }
        }
        
        console.log('   ⚠️  Could not find "Yes, ask me the questions." button');
    } catch (error) {
        console.log('   ⚠️  Error clicking confirmation button:', error.message);
    }
}

async function answerAllQuestions(page) {
    console.log('   📝 Starting to answer questions...\n');
    
    let lastQuestionNumber = '';
    let attempts = 0;
    let maxAttempts = 10;
    let questionsAnswered = 0;
    let sameQuestionCount = 0;
    
    while (attempts < maxAttempts) {
        attempts++;
        
        try {
            await delay(800); // Faster question checking
            
            const pageType = await checkPageType(page);
            
            if (pageType !== 'questions') {
                console.log(`   ℹ️  Left questions page (now on: ${pageType})`);
                break;
            }
            
            const questionText = await extractQuestionText(page);
            
            const questionMatch = questionText.match(/^(Q\d+)\./);
            if (!questionMatch) {
                console.log(`   ℹ️  No valid question found`);
                await delay(2000);
                continue;
            }
            
            const currentQuestionNumber = questionMatch[1];
            
            if (currentQuestionNumber === lastQuestionNumber) {
                sameQuestionCount++;
                console.log(`   ⚠️  Still on ${currentQuestionNumber}, waiting... (${sameQuestionCount}/3)`);
                
                if (sameQuestionCount >= 3) {
                    console.log(`   ℹ️  Seems like questions are done, moving on...`);
                    break;
                }
                
                await delay(2000);
                continue;
            }
            
            sameQuestionCount = 0;
            
            console.log(`   Question ${questionsAnswered + 1} (${currentQuestionNumber}):`);
            console.log(`   ❓ ${questionText}`);
            
            const buttonOptions = await getButtonOptions(page);
            if (buttonOptions.length === 0) {
                console.log(`   ℹ️  No answer buttons found, moving on...`);
                break;
            }
            console.log(`   📋 Options: ${buttonOptions.slice(0, 3).join(', ')}...`);
            
            const correctOption = await getAIAnswer(questionText, storedPassageText, buttonOptions);
            console.log(`   🤖 AI chose: ${correctOption}`);
            
            const clicked = await clickButtonByText(page, correctOption);
            
            if (clicked) {
                lastQuestionNumber = currentQuestionNumber;
                questionsAnswered++;
                
                // Try to click "Continue" button immediately (if it exists)
                await delay(800); // Brief wait for button to appear
                const continueClicked = await clickButton(page, 'Continue');
                if (continueClicked) {
                    console.log(`   ✅ Clicked "Continue"`);
                    await delay(800); // Quick wait for next question
                } else {
                    // No Continue button - might auto-advance
                    await delay(1500); // Wait a bit longer for auto-advance
                }
                
            } else {
                console.log(`   ⚠️  Failed to click answer, trying again...`);
                await delay(2000);
            }
            
        } catch (error) {
            console.log(`   ⚠️  Error: ${error.message}`);
            break;
        }
    }
    
    console.log(`\n   ✅ Answered ${questionsAnswered} questions total`);
}

function extractQuestionText(page) {
    return page.evaluate(() => {
        const bodyText = document.body.innerText;
        const questionMatch = bodyText.match(/Q\d+\.\s+[^\n]+/);
        
        if (questionMatch) {
            return questionMatch[0].trim();
        }
        
        return 'Question not found';
    });
}

function getButtonOptions(page) {
    return page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const options = [];
        
        for (const button of buttons) {
            const text = button.textContent.trim();
            if (text.length > 5 && 
                !text.match(/submit|next|continue|retry|back|menu|settings|ready to answer|click here|sign out|feedback|cookie/i)) {
                options.push(text);
            }
        }
        
        return options;
    });
}

async function getAIAnswer(question, passageText, buttonOptions) {
    try {
        const optionsList = buttonOptions.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
        
        const response = await axios.post(
            'https://api.perplexity.ai/chat/completions',
            {
                model: 'sonar-pro',
                messages: [
                    {
                        role: 'system',
                        content: 'You are answering multiple choice reading comprehension questions. Based ONLY on the passage provided, select the correct answer from the given options. Respond with ONLY the exact text of the correct option, nothing else. If the answer is not in the passage, respond with "Not in story".'
                    },
                    {
                        role: 'user',
                        content: `Passage:\n${passageText}\n\n${question}\n\nOptions:\n${optionsList}\n\nWhich option is correct based on the passage? Respond with the EXACT text of the correct option.`
                    }
                ],
                temperature: 0.1,
                max_tokens: 100
            },
            {
                headers: {
                    'Authorization': `Bearer ${CONFIG.PERPLEXITY_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        let answer = response.data.choices[0].message.content.trim();
        
        answer = answer.replace(/^\d+\.\s*/, '');
        answer = answer.replace(/\*\*/g, '');
        answer = answer.replace(/\*/g, '');
        answer = answer.replace(/\[.*?\]/g, '');
        answer = answer.replace(/^["']|["']$/g, '');
        
        return answer;
    } catch (error) {
        console.error('   ❌ AI API Error:', error.message);
        return 'ERROR';
    }
}

async function clickButtonByText(page, targetText) {
    try {
        const buttons = await page.$$('button');
        
        for (const button of buttons) {
            const buttonText = await page.evaluate(el => el.textContent.trim(), button);
            if (buttonText === targetText) {
                await button.click();
                console.log(`   ✅ Clicked: "${buttonText}"`);
                return true;
            }
        }
        
        const targetLower = targetText.toLowerCase();
        for (const button of buttons) {
            const buttonText = await page.evaluate(el => el.textContent.trim(), button);
            if (buttonText.toLowerCase() === targetLower) {
                await button.click();
                console.log(`   ✅ Clicked: "${buttonText}"`);
                return true;
            }
        }
        
        for (const button of buttons) {
            const buttonText = await page.evaluate(el => el.textContent.trim(), button);
            if (buttonText.toLowerCase().includes(targetLower) || targetLower.includes(buttonText.toLowerCase())) {
                await button.click();
                console.log(`   ✅ Clicked: "${buttonText}" (partial match)`);
                return true;
            }
        }
        
        console.log(`   ❌ Could not find button with text: "${targetText}"`);
        return false;
        
    } catch (error) {
        console.log('   ❌ Error clicking button:', error.message);
        return false;
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Start the server
app.listen(PORT, () => {
    console.log(`\n✅ Homework Plug Bot API listening on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
    console.log(`🤖 Submit homework: POST http://localhost:${PORT}/submit-homework\n`);
});
