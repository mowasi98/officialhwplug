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
            args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox'],
            defaultViewport: null,
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
        let maxRounds = 25; // ~300 SRP / 14 SRP per round = ~21 rounds
        
        while (roundNumber <= maxRounds) {
            console.log(`\n=== Round ${roundNumber} ===`);
            
            // Close cookie banner if it appears (can happen randomly!)
            await closeCookieBanner(page, true);
            
            // Check if we're on the progress page or reading page
            await delay(1000);
            const pageType = await checkPageType(page);
            console.log(`   📍 Current page: ${pageType}`);
            
            if (pageType === 'progress') {
                // We're on progress screen - check SRP and continue
                const currentSRP = await getSRPProgress(page);
                console.log(`   📊 Progress: ${currentSRP} / 300 SRP`);
                
                if (currentSRP >= 300) {
                    console.log('\n🎉 SUCCESS! Reached 300 SRP!');
                    break;
                }
                
                // Click "Continue reading" or "Next" to start next passage
                console.log('   Looking for Continue/Next button...');
                let clicked = await clickContinueReading(page);
                if (!clicked) {
                    clicked = await clickButton(page, 'Next');
                }
                await delay(2000);
                
            } else if (pageType === 'reading') {
                // We're on reading page - extract text and answer questions
                
                // Step 5: Read and extract the passage
                console.log('Step 5: Extracting passage text...');
                await extractPassageFromMarkers(page);
                
                // Close cookie banner before clicking buttons!
                await closeCookieBanner(page, true);
                
                // Step 6: Click "I have read up to here"
                console.log('Step 6: Clicking "I have read up to here"...');
                await clickIHaveReadUpToHere(page);
                await delay(1500);
                
                // Step 6b: Click "Yes, ask me the questions." on confirmation popup
                console.log('Step 6b: Confirming "Yes, ask me the questions."...');
                await clickYesAskQuestions(page);
                await delay(2000);
                
                // Step 7: Answer all questions
                console.log('Step 7: Answering questions with AI...');
                await answerAllQuestions(page);
                await delay(2000);
                
            } else if (pageType === 'confirmation') {
                // On confirmation popup - click "Yes, ask me the questions"
                console.log('   Clicking "Yes, ask me the questions."...');
                await clickYesAskQuestions(page);
                await delay(2000);
                
            } else if (pageType === 'questions') {
                // On questions page - answer them
                console.log('   Answering questions...');
                await answerAllQuestions(page);
                await delay(2000);
                
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
                await delay(2000);
                
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
                await delay(2000);
                
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
        
        if (schoolInput) {
            await schoolInput.type(schoolName, { delay: 30 });
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
            
            // SUPER AGGRESSIVE: Find and click the blue Google/Microsoft button!
            console.log(`   📋 Searching for the big blue "${loginType}" button...`);
            
            const result = await page.evaluate((searchType) => {
                const searchText = searchType.toLowerCase();
                const buttonInfo = [];
                
                // Find ALL button elements and check their HTML too!
                const allButtons = document.querySelectorAll('button, a[role="button"], div[role="button"]');
                
                for (const btn of allButtons) {
                    const text = (btn.textContent || btn.innerText || '').toLowerCase().replace(/\s+/g, ' ').trim();
                    const html = btn.outerHTML.toLowerCase();
                    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                    
                    buttonInfo.push({
                        text: text || '(empty)',
                        hasGoogle: html.includes(searchText),
                        ariaLabel: ariaLabel
                    });
                    
                    // Strategy 1: Check text content
                    if (text.includes(searchText)) {
                        if (text.includes('log in') || text.includes('sparx') || text.includes('sign')) {
                            btn.click();
                            return { success: true, method: 'text', text: text, buttons: buttonInfo };
                        }
                    }
                    
                    // Strategy 2: Check HTML source (for hidden text or Google mentions)
                    if (html.includes(searchText)) {
                        if (html.includes('log') || html.includes('sparx') || html.includes('sign')) {
                            btn.click();
                            return { success: true, method: 'html', text: text || '(via HTML)', buttons: buttonInfo };
                        }
                    }
                    
                    // Strategy 3: Check aria-label
                    if (ariaLabel.includes(searchText)) {
                        btn.click();
                        return { success: true, method: 'aria-label', text: ariaLabel, buttons: buttonInfo };
                    }
                }
                
                // Strategy 4: XPath search for exact text
                const allText = document.body.innerText;
                if (allText.includes('Log in to Sparx using ' + searchType)) {
                    const xpath = `//*[contains(text(), 'Log in to Sparx using ${searchType}')]`;
                    const xpathResult = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                    if (xpathResult.singleNodeValue) {
                        const element = xpathResult.singleNodeValue;
                        const button = element.closest('button') || element;
                        button.click();
                        return { success: true, method: 'xpath', text: element.textContent, buttons: buttonInfo };
                    }
                }
                
                // Strategy 5: Emergency fallback - click the 4th button if it looks like an icon button
                // (The Google button often shows as just an icon/emoji)
                if (searchType.toLowerCase() === 'google' && allButtons.length >= 4) {
                    const btn4 = allButtons[3]; // Index 3 = 4th button
                    const text4 = (btn4.textContent || '').trim();
                    if (text4.length < 5) { // Likely an icon-only button
                        console.log(`Emergency: Clicking button #4 (icon button): "${text4}"`);
                        btn4.click();
                        return { success: true, method: 'emergency-button-4', text: text4, buttons: buttonInfo };
                    }
                }
                
                return { success: false, buttons: buttonInfo };
            }, loginType);
            
            // Log what we found
            console.log(`   📋 Found ${result.buttons.length} buttons on page:`);
            result.buttons.forEach((info, i) => {
                const googleMarker = info.hasGoogle ? ' ← HAS GOOGLE IN HTML!' : '';
                console.log(`      ${i + 1}. Text: "${info.text.substring(0, 50)}"${googleMarker}`);
            });
            
            buttonClicked = result.success;
            if (buttonClicked) {
                console.log(`   ✅ Clicked "${loginType}" button via ${result.method}: "${result.text}"`);
            }
            
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
                    await delay(2000);
                }
                
                // Enter password
                await page.waitForSelector('input[type="password"]', { timeout: 5000 });
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
        await delay(6000);
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
        await delay(2000);
        
        // Close cookie banner if present!
        console.log('   🍪 Closing cookie banner...');
        await closeCookieBanner(page);
        await delay(500);
        
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
                await delay(2000);
                foundButton = true;
                break;
            }
        }
        
        if (!foundButton) {
            console.log('   ⚠️  No task button found');
        }
        
        // Wait for the book popup to appear
        console.log('   ⏳ Waiting for book popup to load...');
        await delay(3000); // Wait longer for popup!
        
        // Close cookie banner in case it appeared over the popup
        await closeCookieBanner(page, true);
        
        // Now click "Start reading" button IN THE POPUP
        console.log('   📋 Looking for "Start reading" button in popup...');
        await delay(1000);
        
        // Try clicking the button using page.evaluate to find it in the popup
        const clicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, a'));
            for (const btn of buttons) {
                const text = (btn.textContent || btn.innerText || '').toLowerCase().replace(/\s+/g, ' ').trim();
                console.log(`Found button: "${text}"`);
                
                // Look for "Start Reading" or "Start reading"
                if (text === 'start reading' || text.includes('start reading')) {
                    // Make sure it's visible (not hidden)
                    const rect = btn.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        console.log(`Clicking visible button: "${text}"`);
                        btn.click();
                        return true;
                    }
                }
            }
            return false;
        });
        
        if (clicked) {
            console.log(`   ✅ Clicked "Start reading" in popup`);
            await delay(3000);
        } else {
            console.log(`   ⚠️  Could not find "Start reading" button in popup`);
        }
        
        // Click "Continue Reading"
        buttons = await page.$$('button, a');
        for (const button of buttons) {
            const text = await page.evaluate(el => el.textContent, button);
            if (text.match(/continue\s*reading/i)) {
                await button.click();
                console.log('   ✓ Clicked "Continue Reading"');
                await delay(2000);
                break;
            }
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
        } else if (bodyText.match(/Q\d+\./)) {
            return 'questions';
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
                return;
            }
        }
        
        console.log('   ⚠️  Could not find "I have read up to here" button');
    } catch (error) {
        console.log('   ⚠️  Error clicking "I have read up to here"');
        throw error;
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
            await delay(1500);
            
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
                
                console.log(`   ⏳ Waiting for question to advance...`);
                await delay(4000);
                
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
