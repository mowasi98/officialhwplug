// Homework Plug Official Bot
// Automated homework completion bot for educational platforms
// Platform: Sparx Reader

const puppeteer = require('puppeteer');
const axios = require('axios');
const readline = require('readline');

// ============================================================================
// WEBSITE INTEGRATION POINT #1: Configuration
// ============================================================================
// TODO: Replace this with data received from your website
// Your website should send credentials via API/webhook/database
// Example: const credentials = await fetchFromWebsite(orderId);
// ============================================================================

const CONFIG = {
    SCHOOL_NAME: '',
    USERNAME: '',
    PASSWORD: '',
    PERPLEXITY_API_KEY: '', // Add your API key here or use environment variable
    USE_GOOGLE_LOGIN: false, // Set to true if user wants Google login
    HEADLESS: true, // Set to false to see browser (for testing)
};

// ============================================================================
// WEBSITE INTEGRATION POINT #2: Receive Credentials
// ============================================================================
// This function should be replaced with API call to your website
// Your website will send: { schoolName, username, password, useGoogle }
// ============================================================================
async function getCredentialsFromWebsite() {
    // TODO: Replace this with actual API call to your website
    // Example:
    // const response = await axios.post('https://yourwebsite.com/api/get-homework-details', {
    //     orderId: process.argv[2] // Pass order ID as command line argument
    // });
    // return response.data;
    
    // For now, return empty - will use manual input as fallback
    return null;
}

// Function to get user input (fallback if website integration not ready)
function getUserInput(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

// Function to collect credentials (from website OR manual input)
async function collectCredentials() {
    console.log('\n=== SPARX READER BOT - SETUP ===\n');
    
    // ========================================================================
    // WEBSITE INTEGRATION POINT #3: Try to get credentials from website first
    // ========================================================================
    const websiteData = await getCredentialsFromWebsite();
    
    if (websiteData) {
        // Got data from website!
        console.log('✅ Credentials received from website\n');
        CONFIG.SCHOOL_NAME = websiteData.schoolName;
        CONFIG.USERNAME = websiteData.username;
        CONFIG.PASSWORD = websiteData.password;
        CONFIG.USE_GOOGLE_LOGIN = websiteData.useGoogle || false;
        if (websiteData.apiKey) {
            CONFIG.PERPLEXITY_API_KEY = websiteData.apiKey;
        }
    } else {
        // Fallback: Manual input
        console.log('⚠️  No website data found, using manual input\n');
        CONFIG.SCHOOL_NAME = await getUserInput('Enter your school name: ');
        CONFIG.USERNAME = await getUserInput('Enter your Sparx Reader username: ');
        CONFIG.PASSWORD = await getUserInput('Enter your Sparx Reader password: ');
        
        const useGoogle = await getUserInput('Use Google login? (y/n): ');
        CONFIG.USE_GOOGLE_LOGIN = useGoogle.toLowerCase() === 'y';
        
        const apiKey = await getUserInput('Enter Perplexity API key (or press Enter to use default): ');
        if (apiKey.trim()) {
            CONFIG.PERPLEXITY_API_KEY = apiKey.trim();
        }
    }
    
    console.log('\n✅ Configuration complete!');
    console.log(`   School: ${CONFIG.SCHOOL_NAME}`);
    console.log(`   Username: ${CONFIG.USERNAME}`);
    console.log(`   Google Login: ${CONFIG.USE_GOOGLE_LOGIN ? 'Yes' : 'No'}\n`);
}

// Store the reading passage text
let storedPassageText = '';

// Main bot function
async function runSparxReaderBot() {
    // Collect credentials from user
    await collectCredentials();
    
    console.log('🤖 Starting Homework Plug Official Bot...');
    console.log('📚 Platform: Sparx Reader\n');

    const browser = await puppeteer.launch({
        headless: CONFIG.HEADLESS,
        args: ['--start-maximized'],
        defaultViewport: null
    });

    try {
        const page = await browser.newPage();
        
        // Step 1: Navigate to Sparx Reader School Selection
        console.log('Step 1: Navigating to Sparx Reader school selection...');
        await page.goto('https://selectschool.sparx-learning.com/?app=sparx_learning&route=https%3A%2F%2Freader.sparx-learning.com%2F', { waitUntil: 'domcontentloaded' });

        // Step 2: Select School
        console.log('Step 2: Selecting school...');
        await selectSchool(page);

        // Step 3: Login
        console.log('Step 3: Logging in...');
        await login(page);

        // Step 4: Close cookie banner and navigate to reading
        console.log('Step 4: Navigating to reading task...');
        await closeCookieBannerAndStartReading(page);

        // Main Loop: Repeat until 300 SRP is earned
        console.log('\n📚 Starting reading loop - Target: 300 SRP\n');
        let roundNumber = 1;
        let maxRounds = 25; // ~300 SRP / 14 SRP per round = ~21 rounds
        
        while (roundNumber <= maxRounds) {
            console.log(`\n=== Round ${roundNumber} ===`);
            
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
    } finally {
        // Keep browser open for now to see results
        console.log('\n⏸️  Browser will stay open. Close manually when done.');
        // await browser.close();
    }
}

// Step 2: Select school from dropdown/search
async function selectSchool(page) {
    try {
        // Wait for school selector to appear
        await page.waitForSelector('input[type="text"], select, [placeholder*="school" i]', { timeout: 5000 });
        
        // Try to find school input field
        const schoolInput = await page.$('input[type="text"]');
        
        if (schoolInput) {
            await schoolInput.type(CONFIG.SCHOOL_NAME, { delay: 30 });
            await delay(300); // Brief wait for dropdown suggestions to appear
            
            // Click the first suggestion or submit
            await page.keyboard.press('Enter');
            await delay(500); // Wait for selection to register
        }
        
        // Look for and click the Continue button
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

// Step 3: Login with credentials
async function login(page) {
    try {
        // ====================================================================
        // WEBSITE INTEGRATION POINT #4: Google Login Support
        // ====================================================================
        // Check if user wants to use Google login
        if (CONFIG.USE_GOOGLE_LOGIN) {
            console.log('   🔍 Looking for Google login button...');
            
            await delay(1000);
            const allButtons = await page.$$('button, a');
            for (const button of allButtons) {
                const text = await page.evaluate(el => el.textContent, button);
                if (text.match(/log.*in.*google|google.*log.*in|sign.*in.*google|google/i)) {
                    await button.click();
                    console.log('   ✓ Clicked "Log in with Google"');
                    
                    // Wait for Google login page
                    await delay(3000);
                    
                    // TODO: Handle Google OAuth flow
                    // For now, enter Google credentials in standard fields
                    try {
                        await page.waitForSelector('input[type="email"], input[type="text"]', { timeout: 5000 });
                        const emailField = await page.$('input[type="email"], input[type="text"]');
                        if (emailField) {
                            await emailField.type(CONFIG.USERNAME, { delay: 50 });
                            await page.keyboard.press('Enter');
                            console.log('   ✓ Entered Google email');
                            
                            await delay(2000);
                            await page.waitForSelector('input[type="password"]', { timeout: 5000 });
                            const passwordField = await page.$('input[type="password"]');
                            if (passwordField) {
                                await passwordField.type(CONFIG.PASSWORD, { delay: 50 });
                                await page.keyboard.press('Enter');
                                console.log('   ✓ Entered Google password');
                            }
                        }
                        
                        await delay(3000);
                        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
                        console.log('   ✓ Logged in with Google');
                        return;
                    } catch (googleError) {
                        console.log('   ⚠️  Google OAuth needs manual completion');
                        await delay(10000);
                        return;
                    }
                }
            }
            
            console.log('   ⚠️  Google login button not found, using regular login...');
        }
        
        // REGULAR LOGIN: Wait for username field
        await page.waitForSelector('input[type="text"], input[name*="user" i], input[id*="user" i]', { timeout: 5000 });
        
        // Find and fill username
        const usernameField = await page.$('input[type="text"], input[name*="user" i]');
        if (usernameField) {
            await usernameField.type(CONFIG.USERNAME, { delay: 30 });
        }
        
        // Find and fill password
        const passwordField = await page.$('input[type="password"]');
        if (passwordField) {
            await passwordField.type(CONFIG.PASSWORD, { delay: 30 });
        }
        
        console.log('   ✓ Credentials entered');
        
        // NOW: Accept cookies BEFORE clicking login
        await delay(500);
        const allButtons = await page.$$('button');
        for (const button of allButtons) {
            const text = await page.evaluate(el => el.textContent, button);
            if (text.match(/accept\s*all/i)) {
                await button.click();
                console.log('   ✓ Accepted cookies');
                await delay(800);
                break;
            }
        }
        
        // FINALLY: Click the login button
        const buttons = await page.$$('button, input[type="submit"]');
        let loginClicked = false;
        for (const button of buttons) {
            const text = await page.evaluate(el => el.textContent || el.value, button);
            if (text.match(/^log\s*in$/i)) {
                await button.click();
                loginClicked = true;
                console.log('   ✓ Clicked login button');
                break;
            }
        }
        
        if (!loginClicked) {
            await page.keyboard.press('Enter');
        }
        
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
        console.log('   ✓ Logged in successfully');
    } catch (error) {
        console.log('   ⚠️  Login might need manual adjustment');
        throw error;
    }
}

// Step 4: Close cookie banner, click "Start reading", then "Continue Reading"
async function closeCookieBannerAndStartReading(page) {
    try {
        await delay(1500);
        
        // FIRST: Close the cookie banner with X button
        const clicked = await page.evaluate(() => {
            const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
            for (const btn of allButtons) {
                const rect = btn.getBoundingClientRect();
                if (rect.bottom > window.innerHeight - 200) {
                    const text = btn.textContent.trim();
                    const ariaLabel = btn.getAttribute('aria-label') || '';
                    if (text === '×' || text === 'X' || text === '✕' || 
                        ariaLabel.toLowerCase().includes('close') || 
                        ariaLabel.toLowerCase().includes('dismiss')) {
                        btn.click();
                        return true;
                    }
                }
            }
            return false;
        });
        
        if (clicked) {
            console.log('   ✓ Closed cookie banner');
            await delay(500);
        }
        
        // SECOND: Click "Start reading" button (on dashboard)
        await page.waitForSelector('button, a', { timeout: 5000 });
        
        let buttons = await page.$$('button, a');
        for (const button of buttons) {
            const text = await page.evaluate(el => el.textContent, button);
            if (text.match(/start.*reading/i)) {
                await button.click();
                console.log('   ✓ Clicked "Start reading"');
                await delay(2000);
                break;
            }
        }
        
        // THIRD: Click "Continue Reading" button (on book page)
        buttons = await page.$$('button, a');
        for (const button of buttons) {
            const text = await page.evaluate(el => el.textContent, button);
            if (text.match(/continue\s*reading/i)) {
                await button.click();
                console.log('   ✓ Clicked "Continue Reading"');
                await delay(2000); // Wait for passage to load
                break;
            }
        }
        
        console.log('   ✓ Navigated to reading page');
    } catch (error) {
        console.log('   ⚠️  Error navigating to reading page');
        throw error;
    }
}

// Step 5: Click "Click here when you're ready to start reading" and extract text
async function extractPassageFromMarkers(page) {
    try {
        // FIRST: Click "Click here when you're ready to start reading"
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
        
        // Wait for content to load
        await delay(2000);
        
        // Scroll down slowly to ensure all content is loaded
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    
                    if(totalHeight >= document.body.scrollHeight){
                        clearInterval(timer);
                        window.scrollTo(0, 0); // Scroll back to top
                        setTimeout(resolve, 500);
                    }
                }, 150);
            });
        });
        
        console.log('   ✓ Scrolled through page');
        
        // Extract text between markers - try multiple variations
        const result = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            
            // Try different marker variations
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
            
            // Find start marker
            for (const marker of possibleStartMarkers) {
                const idx = bodyText.indexOf(marker);
                if (idx !== -1) {
                    startIndex = idx;
                    usedStartMarker = marker;
                    break;
                }
            }
            
            // Find stop marker
            for (const marker of possibleStopMarkers) {
                const idx = bodyText.indexOf(marker);
                if (idx !== -1) {
                    stopIndex = idx;
                    usedStopMarker = marker;
                    break;
                }
            }
            
            // Debug: return what we found
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
            
            // Extract text between markers
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

// Check what type of page we're on
async function checkPageType(page) {
    return await page.evaluate(() => {
        const bodyText = document.body.innerText;
        
        if (bodyText.includes('How much do you like this book')) {
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

// Get current SRP progress from page
async function getSRPProgress(page) {
    return await page.evaluate(() => {
        const bodyText = document.body.innerText;
        // Look for pattern like "14 / 300 SRP"
        const match = bodyText.match(/(\d+)\s*\/\s*300\s*SRP/);
        if (match) {
            return parseInt(match[1]);
        }
        return 0;
    });
}

// Click "Continue reading" button on progress page
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

// Generic function to click a button by text (Next, Retry, etc.)
async function clickButton(page, buttonText) {
    try {
        const buttons = await page.$$('button, a');
        for (const button of buttons) {
            const text = await page.evaluate(el => el.textContent.trim(), button);
            if (text.toLowerCase() === buttonText.toLowerCase()) {
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

// Step 6: Click "I have read up to here"
async function clickIHaveReadUpToHere(page) {
    try {
        // Scroll back to top to find the button
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

// Step 6b: Click "Yes, ask me the questions." on confirmation popup
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

// Step 7: Answer all questions using AI (1-4 questions, must get all correct)
async function answerAllQuestions(page) {
    console.log('   📝 Starting to answer questions...\n');
    
    let lastQuestionNumber = '';
    let attempts = 0;
    let maxAttempts = 10; // Safety limit
    let questionsAnswered = 0;
    let sameQuestionCount = 0;
    
    while (attempts < maxAttempts) {
        attempts++;
        
        try {
            // Wait for page to stabilize
            await delay(1500);
            
            // Check what page we're on
            const pageType = await checkPageType(page);
            
            // If we're not on questions anymore, we're done
            if (pageType !== 'questions') {
                console.log(`   ℹ️  Left questions page (now on: ${pageType})`);
                break;
            }
            
            // Extract question text
            const questionText = await extractQuestionText(page);
            
            // Extract just the question number (Q1, Q2, Q3, Q4)
            const questionMatch = questionText.match(/^(Q\d+)\./);
            if (!questionMatch) {
                console.log(`   ℹ️  No valid question found`);
                await delay(2000);
                continue;
            }
            
            const currentQuestionNumber = questionMatch[1]; // e.g., "Q1", "Q2"
            
            // Check if we already answered this question number
            if (currentQuestionNumber === lastQuestionNumber) {
                sameQuestionCount++;
                console.log(`   ⚠️  Still on ${currentQuestionNumber}, waiting... (${sameQuestionCount}/3)`);
                
                // If stuck on same question for 3 attempts, probably done
                if (sameQuestionCount >= 3) {
                    console.log(`   ℹ️  Seems like questions are done, moving on...`);
                    break;
                }
                
                await delay(2000);
                continue;
            }
            
            // New question - reset counter
            sameQuestionCount = 0;
            
            // New question! Let's answer it
            console.log(`   Question ${questionsAnswered + 1} (${currentQuestionNumber}):`);
            console.log(`   ❓ ${questionText}`);
            
            // Get all button options from the page
            const buttonOptions = await getButtonOptions(page);
            if (buttonOptions.length === 0) {
                console.log(`   ℹ️  No answer buttons found, moving on...`);
                break;
            }
            console.log(`   📋 Options: ${buttonOptions.slice(0, 3).join(', ')}...`);
            
            // Ask AI which button option is correct
            const correctOption = await getAIAnswer(questionText, storedPassageText, buttonOptions);
            console.log(`   🤖 AI chose: ${correctOption}`);
            
            // Click the exact button that matches AI's choice
            const clicked = await clickButtonByText(page, correctOption);
            
            if (clicked) {
                lastQuestionNumber = currentQuestionNumber;
                questionsAnswered++;
                
                // WAIT for next question to load
                console.log(`   ⏳ Waiting for question to advance...`);
                await delay(4000); // 4 second wait for page to update
                
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

// Extract FULL question text from page (e.g., "Q1. Jake pointed something out...")
async function extractQuestionText(page) {
    return await page.evaluate(() => {
        const bodyText = document.body.innerText;
        
        // Look for pattern: "Q[number]. [question text]"
        const questionMatch = bodyText.match(/Q\d+\.\s+[^\n]+/);
        
        if (questionMatch) {
            return questionMatch[0].trim();
        }
        
        return 'Question not found';
    });
}

// Get button options from the page
async function getButtonOptions(page) {
    return await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const options = [];
        
        for (const button of buttons) {
            const text = button.textContent.trim();
            // Only include answer buttons (filter out navigation, menu, and system buttons)
            if (text.length > 5 && 
                !text.match(/submit|next|continue|retry|back|menu|settings|ready to answer|click here|sign out|feedback|cookie/i)) {
                options.push(text);
            }
        }
        
        return options;
    });
}

// Get answer from AI (Perplexity API) - AI picks from button options
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
        
        // Clean up any markdown or numbering
        answer = answer.replace(/^\d+\.\s*/, ''); // Remove "1. " prefix
        answer = answer.replace(/\*\*/g, '');
        answer = answer.replace(/\*/g, '');
        answer = answer.replace(/\[.*?\]/g, '');
        answer = answer.replace(/^["']|["']$/g, ''); // Remove quotes
        
        return answer;
    } catch (error) {
        console.error('   ❌ AI API Error:', error.message);
        return 'ERROR';
    }
}

// Click button by exact text match
async function clickButtonByText(page, targetText) {
    try {
        const buttons = await page.$$('button');
        
        // First try: exact match
        for (const button of buttons) {
            const buttonText = await page.evaluate(el => el.textContent.trim(), button);
            if (buttonText === targetText) {
                await button.click();
                console.log(`   ✅ Clicked: "${buttonText}"`);
                return true;
            }
        }
        
        // Second try: case-insensitive match
        const targetLower = targetText.toLowerCase();
        for (const button of buttons) {
            const buttonText = await page.evaluate(el => el.textContent.trim(), button);
            if (buttonText.toLowerCase() === targetLower) {
                await button.click();
                console.log(`   ✅ Clicked: "${buttonText}"`);
                return true;
            }
        }
        
        // Third try: contains match
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

// Submit answer
async function submitAnswer(page) {
    try {
        const buttons = await page.$$('button');
        for (const button of buttons) {
            const text = await page.evaluate(el => el.textContent, button);
            if (text.match(/submit|next|continue|check/i)) {
                await button.click();
                console.log('   ✓ Submitted answer');
                await delay(800);
                return;
            }
        }
    } catch (error) {
        console.log('   ⚠️  Could not submit answer');
    }
}

// Utility function for delays
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the bot
runSparxReaderBot();
