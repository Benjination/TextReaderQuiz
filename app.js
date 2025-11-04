// app.js - Text Reader Backend Logic
// Firebase configuration and text processing functionality

// Add debugging to ensure JavaScript loads
console.log('TextReader app.js loaded successfully');

// =====================================
// FIREBASE CONFIGURATION
// =====================================
// Using Firebase v8 compat SDK (easier for this project)

const firebaseConfig = {
  apiKey: "AIzaSyBfJjAOH7IxXB4NIh96JLlgBVdnGQxNY2k",
  authDomain: "textreaderquiz.firebaseapp.com",
  projectId: "textreaderquiz",
  storageBucket: "textreaderquiz.firebasestorage.app",
  messagingSenderId: "560249400821",
  appId: "1:560249400821:web:1c2ea3465fbbfd7002c4bc",
  measurementId: "G-MEEQN811RP"
};

// Initialize Firebase (will work when Firebase scripts are loaded)
let db, storage, analytics;

function initializeFirebaseServices() {
    try {
        if (typeof firebase !== 'undefined') {
            firebase.initializeApp(firebaseConfig);
            db = firebase.firestore();
            storage = firebase.storage();
            // analytics = firebase.analytics(); // Optional
            console.log('Firebase services initialized successfully');
            return true;
        } else {
            console.warn('Firebase SDK not loaded. Running in offline mode.');
            return false;
        }
    } catch (error) {
        console.error('Firebase initialization error:', error);
        return false;
    }
}

// =====================================
// GLOBAL VARIABLES
// =====================================
let isFirebaseInitialized = false;
let currentDocuments = [];
let searchIndex = {};
let stopWords = []; // English stop words (default)
let frenchStopWords = [];
let spanishStopWords = [];

// Sample files cache for search functionality
let sampleFilesCache = [];

// Temporary storage for current analysis (includes sample files)
let currentAnalysisData = null;

// Available sample files
const SAMPLE_FILES = [
    { filename: 'Alice.txt', displayName: 'Alice in Wonderland (English)', id: 'sample-alice' },
    { filename: 'CandideFr.txt', displayName: 'Candide by Voltaire (French)', id: 'sample-candide-fr' },
    { filename: 'CandidateSp.txt', displayName: 'Don Quixote by Cervantes (Spanish)', id: 'sample-donquixote-es' }
];

// =====================================
// WORD STEMMING FUNCTIONS
// =====================================

/**
 * Simple but effective stemming algorithm for English words
 * Based on Porter Stemmer principles but simplified for performance
 * @param {string} word - Word to stem
 * @returns {string} - Stemmed word
 */
function stemWord(word) {
    if (!word || word.length <= 2) return word;
    
    const originalWord = word;
    word = word.toLowerCase();
    
    // Common suffix rules (most effective ones for search)
    const suffixRules = [
        // Plurals
        { pattern: /ies$/, replacement: 'y' },      // cities -> city
        { pattern: /ied$/, replacement: 'y' },      // cried -> cry
        { pattern: /ies$/, replacement: 'ie' },     // ties -> tie
        { pattern: /s$/, replacement: '', minLength: 4 }, // cats -> cat (but not 'as' -> 'a')
        
        // Past tense and gerunds
        { pattern: /eed$/, replacement: 'ee' },     // agreed -> agree
        { pattern: /ed$/, replacement: '', minLength: 4 },   // wanted -> want
        { pattern: /ing$/, replacement: '', minLength: 4 },  // running -> run
        
        // Comparative and superlative
        { pattern: /est$/, replacement: '', minLength: 4 },  // fastest -> fast
        { pattern: /er$/, replacement: '', minLength: 4 },   // faster -> fast
        
        // Adverbs
        { pattern: /ly$/, replacement: '', minLength: 4 },   // quickly -> quick
        
        // Common word endings
        { pattern: /tion$/, replacement: 'te' },    // creation -> create
        { pattern: /sion$/, replacement: 's' },     // expansion -> expans
        { pattern: /ness$/, replacement: '' },      // goodness -> good
        { pattern: /ment$/, replacement: '' },      // development -> develop
        { pattern: /able$/, replacement: '' },      // readable -> read
        { pattern: /ible$/, replacement: '' },      // terrible -> terr
        { pattern: /ful$/, replacement: '' },       // helpful -> help
        { pattern: /less$/, replacement: '' },      // helpless -> help
        { pattern: /ous$/, replacement: '' },       // dangerous -> danger
        { pattern: /ive$/, replacement: '' },       // active -> act
        { pattern: /ize$/, replacement: '' },       // realize -> real
        { pattern: /ise$/, replacement: '' },       // realise -> real
    ];
    
    // Apply suffix rules
    for (const rule of suffixRules) {
        if (rule.pattern.test(word)) {
            const newWord = word.replace(rule.pattern, rule.replacement);
            // Only apply if the resulting word meets minimum length requirement
            if (!rule.minLength || newWord.length >= rule.minLength) {
                word = newWord;
                break; // Apply only the first matching rule
            }
        }
    }
    
    // Additional cleaning for double letters at the end (running -> run)
    if (word.length > 3 && word.match(/(.)\1$/)) {
        word = word.slice(0, -1);
    }
    
    return word;
}

/**
 * Apply stemming to an array of words
 * @param {Array} words - Array of words to stem
 * @returns {Array} - Array of stemmed words
 */
function stemWords(words) {
    return words.map(word => stemWord(word));
}

/**
 * Create a search index with both original and stemmed words
 * @param {string} text - Text to index
 * @returns {Object} - Object with original and stemmed word frequencies
 */
function createStemmedIndex(text) {
    const words = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2);
    
    const originalIndex = {};
    const stemmedIndex = {};
    const stemMapping = {}; // Maps stemmed word back to original words
    
    words.forEach(word => {
        // Count original words
        originalIndex[word] = (originalIndex[word] || 0) + 1;
        
        // Count stemmed words
        const stemmed = stemWord(word);
        stemmedIndex[stemmed] = (stemmedIndex[stemmed] || 0) + 1;
        
        // Track mapping from stem to original words
        if (!stemMapping[stemmed]) {
            stemMapping[stemmed] = new Set();
        }
        stemMapping[stemmed].add(word);
    });
    
    return {
        original: originalIndex,
        stemmed: stemmedIndex,
        mapping: Object.fromEntries(
            Object.entries(stemMapping).map(([stem, words]) => [stem, Array.from(words)])
        )
    };
}

// =====================================
// SAMPLE FILES MANAGEMENT
// =====================================

/**
 * Load and cache sample files for search functionality
 */
async function loadSampleFilesForSearch() {
    console.log('Loading sample files for search...');
    
    for (const sampleFile of SAMPLE_FILES) {
        try {
            // Check if already cached
            if (sampleFilesCache.find(cached => cached.id === sampleFile.id)) {
                continue;
            }
            
            const response = await fetch(sampleFile.filename);
            if (response.ok) {
                const content = await response.text();
                const processedDoc = await processDocument(sampleFile.displayName, content);
                
                // Add to cache with search-friendly format
                sampleFilesCache.push({
                    id: sampleFile.id,
                    filename: sampleFile.displayName,
                    originalContent: content,
                    cleanedText: processedDoc.cleanedText,
                    language: processedDoc.language,
                    wordCount: processedDoc.wordCount,
                    isSample: true
                });
                
                console.log(`✓ Cached sample file: ${sampleFile.displayName}`);
            } else {
                console.warn(`Failed to load sample file: ${sampleFile.filename}`);
            }
        } catch (error) {
            console.warn(`Error loading sample file ${sampleFile.filename}:`, error);
        }
    }
    
    console.log(`Sample files cache loaded: ${sampleFilesCache.length} files`);
}

/**
 * Get sample file by ID for viewing
 */
async function getSampleFileById(sampleId) {
    const cached = sampleFilesCache.find(file => file.id === sampleId);
    if (cached) {
        return cached;
    }
    
    // If not cached, try to load it
    const sampleConfig = SAMPLE_FILES.find(s => s.id === sampleId);
    if (sampleConfig) {
        await loadSampleFilesForSearch();
        return sampleFilesCache.find(file => file.id === sampleId);
    }
    
    return null;
}

// =====================================
// INITIALIZATION FUNCTIONS
// =====================================

/**
 * Initialize the application when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', function() {
    console.log('Text Reader App initializing...');
    
    // Test stemming function
    console.log('🌱 Stemming examples:');
    console.log('running → ' + stemWord('running'));
    console.log('cats → ' + stemWord('cats'));
    console.log('questionable → ' + stemWord('questionable'));
    console.log('computers → ' + stemWord('computers'));
    console.log('quickly → ' + stemWord('quickly'));
    console.log('creation → ' + stemWord('creation'));
    console.log('helpful → ' + stemWord('helpful'));
    
    initializeApp();
});

/**
 * Main initialization function
 */
async function initializeApp() {
    try {
        // Load stop words
        await loadStopWords();
        
        // Initialize Firebase connection
        isFirebaseInitialized = initializeFirebaseServices();
        
        // Load sample files for search functionality
        await loadSampleFilesForSearch();
        
        // Load and display stored files (this will also load documents internally)
        await loadStoredFiles();
        
        console.log('App initialized successfully');
        showSuccess('Application initialized successfully!');
    } catch (error) {
        console.error('Error initializing app:', error);
        showError('Failed to initialize application: ' + error.message);
    }
}

/**
 * Initialize Firebase connection
 */
async function initializeFirebase() {
    try {
        // TODO: Uncomment when Firebase config is added
        // Test Firebase connection
        // await db.collection('test').add({ initialized: new Date() });
        // isFirebaseInitialized = true;
        // console.log('Firebase initialized successfully');
    } catch (error) {
        console.error('Firebase initialization failed:', error);
        throw error;
    }
}

/**
 * Check if a file with the given name already exists
 * @param {string} fileName - Name of the file to check
 * @returns {Promise<boolean>} - True if file exists, false otherwise
 */
async function checkFileExists(fileName) {
    if (!isFirebaseInitialized) {
        // Check local documents if Firebase is not available
        return currentDocuments.some(doc => doc.name === fileName);
    }
    
    try {
        // Query Firebase for documents with this exact name
        const snapshot = await db.collection('documents')
            .where('name', '==', fileName)
            .limit(1)
            .get();
        
        const exists = !snapshot.empty;
        console.log(`File "${fileName}" exists check: ${exists}`);
        return exists;
        
    } catch (error) {
        console.error('Error checking if file exists:', error);
        // If there's an error, assume file doesn't exist to allow upload
        return false;
    }
}

// =====================================
// DOCUMENT PROCESSING FUNCTIONS
// =====================================

/**
 * Process uploaded text file
 * @param {File} file - The uploaded text file
 */
async function uploadText() {
    const fileInput = document.getElementById('textFile');
    const file = fileInput.files[0];
    
    if (!file) {
        showError('Please select a file to upload');
        return;
    }
    
    if (!file.name.endsWith('.txt')) {
        showError('Please upload a .txt file');
        return;
    }
    
    try {
        showProgress(true);
        
        // Check if file already exists
        const fileExists = await checkFileExists(file.name);
        if (fileExists) {
            showProgress(false);
            
            // Create a formatted modal message for duplicate files
            const modalMessage = `
                <p><strong>A file with this name already exists:</strong></p>
                <p style="margin: 15px 0; padding: 15px; background-color: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                    <strong>"${file.name}"</strong> is already in your file collection.
                </p>
                <p><strong>What would you like to do?</strong></p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    <li><strong>Rename the file:</strong> Add a number or date to make it unique (e.g., "${file.name.replace('.txt', '_2.txt')}")</li>
                    <li><strong>Remove the existing file:</strong> Click on the existing file in your list and use the "Remove" button</li>
                    <li><strong>Choose a different file:</strong> Upload a different text file instead</li>
                </ul>
                <p style="margin-top: 15px; padding: 10px; background-color: #e7f3ff; border-radius: 4px; font-size: 0.9em;">
                    <strong>💡 Tip:</strong> Each file must have a unique name to prevent confusion and data loss.
                </p>
            `;
            
            showErrorModal(modalMessage, "Duplicate File Detected", "📁");
            return;
        }
        
        // Read file content
        const content = await readFileContent(file);
        
        // Process the text
        const processedDoc = await processDocument(file.name, content);
        
        // Store in Firebase
        await storeDocument(processedDoc);
        
        // Update search index
        await updateSearchIndex(processedDoc);
        
        showProgress(false);
        showSuccess(`Successfully processed ${file.name}`);
        
        // Display the analysis results immediately
        displayAnalysisResults(processedDoc);
        
        // Refresh the file list to show the new upload
        await loadStoredFiles();
        
        fileInput.value = ''; // Clear file input
        
    } catch (error) {
        showProgress(false);
        
        // Check if this is a garbage file error that should use the modal
        if (error.message && error.message.includes('Garbage file detected:')) {
            // Extract the detailed reason from the error message
            const reason = error.message.replace('Garbage file detected: ', '');
            
            // Format the message for the modal
            const modalMessage = `
                <p><strong>The file you uploaded cannot be processed:</strong></p>
                <p style="margin: 15px 0; padding: 15px; background-color: #f8f9fa; border-left: 4px solid #dc3545; border-radius: 4px;">
                    ${reason}
                </p>
                <p><strong>What to do:</strong></p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    <li>If this is a PDF file, use a PDF-to-text converter first</li>
                    <li>If this is a Word document, save it as a plain text (.txt) file</li>
                    <li>Make sure the file contains readable text content</li>
                    <li>Check that the file is not corrupted or in an unsupported format</li>
                </ul>
            `;
            
            showErrorModal(modalMessage, "Invalid File Type", "🚫");
        } else {
            // Use regular error display for other errors
            showError('Error uploading file: ' + error.message);
        }
        
        console.error('Upload error:', error);
    }
}

/**
 * Load a sample file from the server
 * @param {string} filename - Name of the sample file to load
 * @param {string} displayName - Display name for the file
 */
async function loadSampleFile(filename, displayName) {
    try {
        showProgress(true);
        
        // Fetch the sample file content
        const response = await fetch(filename);
        if (!response.ok) {
            throw new Error(`Failed to load ${filename}: ${response.statusText}`);
        }
        
        const content = await response.text();
        
        // Process the text using the display name (but don't store in Firebase)
        const processedDoc = await processDocument(displayName, content);
        
        // Note: We don't store sample files in Firebase since they're static server files
        // await storeDocument(processedDoc);  // REMOVED
        // await updateSearchIndex(processedDoc);  // REMOVED
        
        showProgress(false);
        showSuccess(`Successfully analyzed ${displayName} (sample file - not stored in database)`);
        
        // Display the analysis results immediately
        displayAnalysisResults(processedDoc);
        
        // No need to refresh file list since sample files aren't stored
        
    } catch (error) {
        showProgress(false);
        showError('Error loading sample file: ' + error.message);
        console.error('Sample file load error:', error);
    }
}

/**
 * Read content from uploaded file
 * @param {File} file - The file to read
 * @returns {Promise<string>} - File content as string
 */
function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

/**
 * Detect if a file appears to be corrupted, binary, or garbage data
 * @param {string} content - File content to analyze
 * @returns {Object} - {isGarbage: boolean, reason: string}
 */
function detectGarbageFile(content) {
    // Check for common signs of binary/corrupted files
    
    // 1. Check for PDF signatures
    if (content.includes('%PDF') || content.includes('%%EOF')) {
        return {
            isGarbage: true,
            reason: 'This appears to be a PDF file. PDF files cannot be directly converted to .txt format. Please use a proper PDF-to-text converter or save the content as plain text.'
        };
    }
    
    // 2. Check for other binary file signatures
    const binarySignatures = [
        'PK\x03\x04', // ZIP files
        '\x89PNG', // PNG files
        '\xFF\xD8\xFF', // JPEG files
        'GIF8', // GIF files
        '\x00\x00\x01\x00', // ICO files
        'RIFF', // WAV files
        '\x1f\x8b\x08', // GZIP files
        '\x50\x4b\x03\x04', // ZIP files (hex)
    ];
    
    for (const signature of binarySignatures) {
        if (content.includes(signature)) {
            return {
                isGarbage: true,
                reason: 'This appears to be a binary file (image, archive, etc.) disguised as text. Binary files cannot be processed as text documents.'
            };
        }
    }
    
    // 3. Check for excessive non-printable characters
    const totalChars = content.length;
    if (totalChars === 0) {
        return {
            isGarbage: true,
            reason: 'The file appears to be empty.'
        };
    }
    
    let nonPrintableCount = 0;
    let nullByteCount = 0;
    
    for (let i = 0; i < content.length; i++) {
        const charCode = content.charCodeAt(i);
        
        // Count null bytes (strong indicator of binary data)
        if (charCode === 0) {
            nullByteCount++;
        }
        
        // Count non-printable characters (excluding common whitespace)
        if (charCode < 32 && charCode !== 9 && charCode !== 10 && charCode !== 13) {
            nonPrintableCount++;
        }
    }
    
    // If more than 1% of characters are null bytes, it's likely binary
    if (nullByteCount > totalChars * 0.01) {
        return {
            isGarbage: true,
            reason: 'This file contains null bytes and appears to be binary data. Please ensure you are uploading a plain text (.txt) file.'
        };
    }
    
    // If more than 5% of characters are non-printable, it's likely corrupted/binary
    if (nonPrintableCount > totalChars * 0.05) {
        return {
            isGarbage: true,
            reason: 'This file contains excessive non-printable characters and may be corrupted or in an unsupported format.'
        };
    }
    
    // 4. Check for realistic text patterns
    const words = content.split(/\s+/).filter(word => word.length > 0);
    
    if (words.length === 0) {
        return {
            isGarbage: true,
            reason: 'The file does not contain recognizable words or text.'
        };
    }
    
    // Check if most "words" are just random characters
    let validWordCount = 0;
    for (const word of words.slice(0, 100)) { // Check first 100 words
        // A valid word should have mostly letters and be reasonable length
        const letterCount = (word.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
        if (letterCount > word.length * 0.7 && word.length > 1 && word.length < 50) {
            validWordCount++;
        }
    }
    
    const wordSampleSize = Math.min(100, words.length);
    if (validWordCount < wordSampleSize * 0.3) {
        return {
            isGarbage: true,
            reason: 'The file does not contain enough recognizable words. It may be corrupted, encoded incorrectly, or not a text document.'
        };
    }
    
    return { isGarbage: false, reason: '' };
}

/**
 * Process document content - clean, tokenize, and analyze
 * @param {string} filename - Name of the document
 * @param {string} content - Raw text content
 * @returns {Object} - Processed document object
 */
async function processDocument(filename, content) {
    // First, check if this is a garbage/binary file
    const garbageCheck = detectGarbageFile(content);
    if (garbageCheck.isGarbage) {
        throw new Error(`Garbage file detected: ${garbageCheck.reason}`);
    }
    
    const doc = {
        id: generateDocumentId(),
        name: filename,
        originalContent: content,
        uploadDate: new Date(),
        wordCount: 0,
        language: 'unknown',
        cleanedText: '',
        words: [],
        wordFrequency: {},
        charFrequency: {},
        foreignChars: [],
        letterFrequency: {}
    };
    
    // Analyze original content for foreign characters BEFORE cleaning
    doc.foreignChars = findForeignCharacters(content);
    
    // Calculate letter frequency (a-z) from original content
    doc.letterFrequency = calculateLetterFrequency(content);
    
    // Clean the text
    doc.cleanedText = cleanText(content);
    
    // Detect language FIRST using multiple methods
    doc.language = detectLanguage(doc.cleanedText, doc.letterFrequency, doc.foreignChars);
    
    // Tokenize into words using language-specific stop words
    doc.words = tokenizeText(doc.cleanedText, doc.language);
    
    // Calculate word frequency
    doc.wordFrequency = calculateWordFrequency(doc.words);
    
    // Calculate character frequency from cleaned text
    doc.charFrequency = calculateCharacterFrequency(doc.cleanedText);
    
    // Count words (excluding stop words)
    doc.wordCount = doc.words.length;
    
    console.log(`Processed document: ${filename}, Words: ${doc.wordCount}, Language: ${doc.language}`);
    return doc;
}

/**
 * Clean text by removing non-ASCII, converting to lowercase, removing punctuation and numbers
 * @param {string} text - Raw text to clean
 * @returns {string} - Cleaned text
 */
function cleanText(text) {
    return text
        .replace(/[^\x00-\x7F]/g, '') // Remove non-ASCII
        .toLowerCase() // Convert to lowercase
        .replace(/\d/g, ' ') // Remove all digits/numbers
        .replace(/[^a-z\s]/g, ' ') // Remove punctuation and any remaining non-letter characters
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .trim(); // Remove leading/trailing whitespace
}

/**
 * Tokenize text into words, removing language-specific stop words
 * @param {string} text - Cleaned text to tokenize
 * @param {string} language - Detected language to determine which stop words to use
 * @returns {Array} - Array of words
 */
function tokenizeText(text, language = 'English') {
    const allWords = text.split(/\s+/).filter(word => word.length > 1);
    
    // Select appropriate stop words based on detected language
    let currentStopWords = stopWords; // Default to English
    if (language.toLowerCase().includes('french')) {
        currentStopWords = frenchStopWords;
    } else if (language.toLowerCase().includes('spanish')) {
        currentStopWords = spanishStopWords;
    }
    
    // Debug: log some info about stop words
    console.log('=== TOKENIZE DEBUG ===');
    console.log('Detected language:', language);
    console.log('Using stop words for:', language.toLowerCase().includes('french') ? 'French' : 
                                         language.toLowerCase().includes('spanish') ? 'Spanish' : 'English');
    console.log('Total words before filtering:', allWords.length);
    console.log('Stop words array length:', currentStopWords.length);
    console.log('First 10 stop words:', currentStopWords.slice(0, 10));
    console.log('Sample words from text:', allWords.slice(0, 10));
    
    // Test a few specific stop words
    const testWords = language.toLowerCase().includes('french') ? ['le', 'de', 'et', 'un', 'à'] :
                      language.toLowerCase().includes('spanish') ? ['el', 'de', 'que', 'y', 'a'] :
                      ['the', 'and', 'in', 'to', 'is'];
    testWords.forEach(word => {
        console.log(`Stop word "${word}" is in stopWords array: ${currentStopWords.includes(word)}`);
    });
    
    const filteredWords = allWords.filter(word => {
        const wordLower = word.toLowerCase();
        const isStopWord = currentStopWords.includes(wordLower);
        
        // Log first few words for debugging
        if (allWords.indexOf(word) < 10) {
            console.log(`Word "${word}" → "${wordLower}" → isStopWord: ${isStopWord} → ${isStopWord ? 'REMOVED' : 'KEPT'}`);
        }
        
        return !isStopWord; // Keep words that are NOT stop words
    });
    
    console.log('Words after stop word filtering:', filteredWords.length);
    console.log('First 10 filtered words:', filteredWords.slice(0, 10));
    console.log('=== END TOKENIZE DEBUG ===');
    
    return filteredWords;
}

/**
 * Calculate word frequency in document
 * @param {Array} words - Array of words
 * @returns {Object} - Word frequency object
 */
function calculateWordFrequency(words) {
    console.log('=== WORD FREQUENCY DEBUG ===');
    console.log('Words array length:', words.length);
    console.log('First 10 words for frequency calculation:', words.slice(0, 10));
    
    const frequency = {};
    words.forEach(word => {
        frequency[word] = (frequency[word] || 0) + 1;
    });
    
    // Show top 10 most frequent words
    const topWords = Object.entries(frequency)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10);
    
    console.log('Top 10 most frequent words:', topWords);
    console.log('=== END WORD FREQUENCY DEBUG ===');
    
    return frequency;
}

/**
 * Calculate letter frequency (a-z only) from text
 * @param {string} text - Text to analyze
 * @returns {Object} - Letter frequency object with percentages
 */
function calculateLetterFrequency(text) {
    const freq = {};
    let totalLetters = 0;
    
    // Initialize all letters
    for (let i = 97; i <= 122; i++) {
        freq[String.fromCharCode(i)] = 0;
    }
    
    // Count letters
    for (let char of text.toLowerCase()) {
        if (char >= 'a' && char <= 'z') {
            freq[char]++;
            totalLetters++;
        }
    }
    
    // Convert to percentages
    const percentages = {};
    for (let letter in freq) {
        percentages[letter] = totalLetters > 0 ? ((freq[letter] / totalLetters) * 100).toFixed(2) : 0;
    }
    
    return percentages;
}

/**
 * Find non-English characters (accented letters, etc.)
 * @param {string} text - Text to analyze
 * @returns {Array} - Array of foreign characters with counts
 */
function findForeignCharacters(text) {
    const foreignChars = {};
    
    for (let char of text) {
        // Check if character is not basic ASCII letter, number, punctuation, or whitespace
        if (char.match(/[^\x00-\x7F]/)) {
            // It's a non-ASCII character
            if (char.match(/[À-ÿ]/)) {
                // It's an accented letter
                foreignChars[char] = (foreignChars[char] || 0) + 1;
            }
        }
    }
    
    // Convert to array and sort by frequency
    return Object.entries(foreignChars)
        .sort(([,a], [,b]) => b - a)
        .map(([char, count]) => ({ char, count, description: getCharacterDescription(char) }));
}

/**
 * Get description of foreign character
 * @param {string} char - Character to describe
 * @returns {string} - Description of the character
 */
function getCharacterDescription(char) {
    const descriptions = {
        'à': 'a with grave accent',
        'á': 'a with acute accent',
        'â': 'a with circumflex',
        'ã': 'a with tilde',
        'ä': 'a with diaeresis',
        'å': 'a with ring above',
        'è': 'e with grave accent',
        'é': 'e with acute accent',
        'ê': 'e with circumflex',
        'ë': 'e with diaeresis',
        'ì': 'i with grave accent',
        'í': 'i with acute accent',
        'î': 'i with circumflex',
        'ï': 'i with diaeresis',
        'ò': 'o with grave accent',
        'ó': 'o with acute accent',
        'ô': 'o with circumflex',
        'õ': 'o with tilde',
        'ö': 'o with diaeresis',
        'ù': 'u with grave accent',
        'ú': 'u with acute accent',
        'û': 'u with circumflex',
        'ü': 'u with diaeresis',
        'ç': 'c with cedilla',
        'ñ': 'n with tilde'
    };
    
    return descriptions[char.toLowerCase()] || `accented character (${char})`;
}

// =====================================
// LANGUAGE DETECTION
// =====================================

/**
 * Detect language based on character frequency analysis and foreign characters
 * @param {string} text - Text to analyze
 * @param {Object} letterFreq - Letter frequency object
 * @param {Array} foreignChars - Array of foreign characters
 * @returns {string} - Detected language
 */
function detectLanguage(text, letterFreq, foreignChars) {
    // Enhanced language detection using letter frequency as primary method
    console.log('Starting language detection...');
    
    // Use letter frequency analysis as primary detection method
    if (letterFreq) {
        const eFreq = parseFloat(letterFreq.e) || 0;
        const aFreq = parseFloat(letterFreq.a) || 0;
        const tFreq = parseFloat(letterFreq.t) || 0;
        const oFreq = parseFloat(letterFreq.o) || 0;
        const rFreq = parseFloat(letterFreq.r) || 0;
        const nFreq = parseFloat(letterFreq.n) || 0;
        const iFreq = parseFloat(letterFreq.i) || 0;
        const sFreq = parseFloat(letterFreq.s) || 0;
        
        console.log('Letter frequencies:');
        console.log(`E: ${eFreq}%, A: ${aFreq}%, T: ${tFreq}%, O: ${oFreq}%`);
        console.log(`R: ${rFreq}%, N: ${nFreq}%, I: ${iFreq}%, S: ${sFreq}%`);
        
        // More sophisticated frequency analysis based on linguistic research
        
        // French characteristics:
        // - Very high E frequency (14-17%)
        // - Moderate A frequency (7-8.5%)
        // - Lower T frequency compared to English
        // - High R frequency (6-7%)
        if (eFreq > 13.5 && aFreq > 7 && aFreq < 9.5 && rFreq > 5.5) {
            console.log('French pattern detected: High E, moderate A, good R frequency');
            return 'French';
        }
        
        // English characteristics:
        // - High E frequency (12-13%)
        // - High T frequency (9-10%)
        // - Moderate A frequency (8-9%)
        // - Lower R frequency than French
        if (eFreq > 11 && eFreq < 14 && tFreq > 8.5 && aFreq > 7.5 && aFreq < 9.5) {
            console.log('English pattern detected: High E and T, moderate A');
            return 'English';
        }
        
        // Spanish characteristics:
        // - High A frequency (11-13%)
        // - High O frequency (8.5-10%)
        // - High E frequency but less than French (12-14%)
        // - High S frequency (7-8%)
        if (aFreq > 10.5 && oFreq > 7.5 && sFreq > 6.5) {
            console.log('Spanish pattern detected: High A, O, and S frequencies');
            return 'Spanish';
        }
        
        console.log('No clear letter frequency pattern matched - proceeding to character analysis...');
    }
    
    // Secondary check: Look for unique characters only if frequency analysis is unclear
    if (foreignChars && foreignChars.length > 0) {
        console.log('Foreign characters found:', foreignChars.map(fc => fc.char).join(', '));
        
        // Check for uniquely Spanish characters (ñ)
        const spanishUniqueCount = foreignChars
            .filter(fc => ['ñ'].includes(fc.char.toLowerCase()))
            .reduce((sum, fc) => sum + fc.count, 0);
        
        if (spanishUniqueCount >= 10) {
            console.log(`Found ${spanishUniqueCount} ñ characters - definitely Spanish`);
            return 'Spanish';
        }
        
        // Check for French-heavy characters (these appear much more in French than Spanish)
        const frenchHeavyCount = foreignChars
            .filter(fc => ['ç', 'è', 'ê', 'ë', 'à', 'â', 'ù', 'û', 'ÿ'].includes(fc.char.toLowerCase()))
            .reduce((sum, fc) => sum + fc.count, 0);
        
        if (frenchHeavyCount >= 10) {
            console.log(`Found ${frenchHeavyCount} French-heavy characters - definitely French`);
            return 'French';
        }
        
        // If we have some special characters but not enough for high confidence
        if (spanishUniqueCount > 0 || frenchHeavyCount > 0) {
            console.log(`Found some special characters (Spanish: ${spanishUniqueCount}, French: ${frenchHeavyCount}) but below confidence threshold of 10`);
        }
    }
    
    // Fallback to basic word analysis
    console.log('Performing word analysis...');
    const commonEnglishWords = ['the', 'and', 'of', 'to', 'a', 'in', 'for', 'is', 'on', 'that'];
    const commonFrenchWords = ['le', 'de', 'et', 'un', 'à', 'être', 'ce', 'il', 'que', 'ne'];
    const commonSpanishWords = ['el', 'de', 'que', 'y', 'a', 'en', 'un', 'es', 'se', 'no', 'te', 'lo', 'le', 'da', 'su', 'por', 'son', 'con', 'para', 'al'];
    
    const lowerText = text.toLowerCase();
    let englishScore = 0;
    let frenchScore = 0;
    let spanishScore = 0;
    
    // Count exact word matches (with word boundaries)
    commonEnglishWords.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'g');
        const matches = (lowerText.match(regex) || []).length;
        englishScore += matches;
    });
    
    commonFrenchWords.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'g');
        const matches = (lowerText.match(regex) || []).length;
        frenchScore += matches;
    });
    
    commonSpanishWords.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'g');
        const matches = (lowerText.match(regex) || []).length;
        spanishScore += matches;
    });
    
    console.log('Word analysis scores:');
    console.log('- English:', englishScore);
    console.log('- French:', frenchScore);
    console.log('- Spanish:', spanishScore);
    
    // Require significant confidence for language detection
    const minScore = 3; // Require at least 3 common words found
    const confidenceMargin = 2; // Winner must beat second place by at least 2 points
    
    const maxScore = Math.max(englishScore, frenchScore, spanishScore);
    
    // Check if we have enough evidence and a clear winner
    if (maxScore >= minScore) {
        if (englishScore === maxScore && englishScore >= frenchScore + confidenceMargin && englishScore >= spanishScore + confidenceMargin) {
            return 'English';
        } else if (frenchScore === maxScore && frenchScore >= englishScore + confidenceMargin && frenchScore >= spanishScore + confidenceMargin) {
            return 'French';
        } else if (spanishScore === maxScore && spanishScore >= englishScore + confidenceMargin && spanishScore >= frenchScore + confidenceMargin) {
            return 'Spanish';
        }
    }
    
    // If we reach here, we don't have enough confidence
    console.log('Language detection failed: insufficient evidence or too close to call');
    
    // Check if there are foreign characters that suggest corruption
    if (foreignChars && foreignChars.length > 0) {
        const totalForeignChars = foreignChars.reduce((sum, fc) => sum + fc.count, 0);
        if (totalForeignChars > text.length * 0.1) { // More than 10% foreign chars
            return 'Language cannot be detected - possible file corruption or unsupported encoding';
        } else {
            return 'Language cannot be detected - insufficient linguistic patterns';
        }
    }
    
    return 'Language cannot be detected - insufficient linguistic patterns';
}

/**
 * Calculate character frequency in text
 * @param {string} text - Text to analyze
 * @returns {Object} - Character frequency object
 */
function calculateCharacterFrequency(text) {
    const freq = {};
    for (let char of text.toLowerCase()) {
        if (char.match(/[a-z]/)) {
            freq[char] = (freq[char] || 0) + 1;
        }
    }
    return freq;
}

/**
 * Calculate language score based on character frequency
 * @param {Object} charFreq - Character frequency object
 * @param {string} language - Language to score against
 * @returns {number} - Language score
 */
function calculateLanguageScore(charFreq, language) {
    // Basic scoring - can be enhanced with actual language models
    // For now, just return a placeholder
    return Math.random();
}

// =====================================
// SEARCH FUNCTIONALITY
// =====================================

/**
 * Analyze text for language and word frequency
 */
async function analyzeText() {
    const fileInput = document.getElementById('textFile');
    const file = fileInput.files[0];
    
    if (!file) {
        showError('Please select a file to analyze');
        return;
    }
    
    try {
        showProgress(true);
        
        const content = await readFileContent(file);
        const analysis = await processDocument(file.name, content);
        
        showProgress(false);
        displayAnalysisResults(analysis);
        
    } catch (error) {
        showProgress(false);
        showError('Error analyzing text: ' + error.message);
    }
}

/**
 * Display analysis results to user
 * @param {Object} analysis - Analysis results
 */
function displayAnalysisResults(analysis) {
    console.log('=== DISPLAY ANALYSIS DEBUG ===');
    console.log('Analysis object keys:', Object.keys(analysis));
    console.log('Word frequency object:', analysis.wordFrequency);
    console.log('Letter frequency object:', analysis.letterFrequency);
    console.log('Letter frequency entries:', Object.entries(analysis.letterFrequency || {}));
    
    // Store current analysis data for detailed view access
    currentAnalysisData = analysis;
    
    const topWords = Object.entries(analysis.wordFrequency)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5); // Show top 5 words as requested
    
    console.log('Top 5 words for display:', topWords);
    console.log('=== END DISPLAY ANALYSIS DEBUG ===');
    
    // Get top letter frequencies with defensive check
    const letterFreq = analysis.letterFrequency || {};
    const hasLetterFreqData = Object.keys(letterFreq).length > 0;
    const topLetters = hasLetterFreqData ? 
        Object.entries(letterFreq)
            .sort(([,a], [,b]) => parseFloat(b) - parseFloat(a))
            .slice(0, 10) : 
        [];
    
    console.log('Letter frequency data available:', hasLetterFreqData);
    console.log('Top letters:', topLetters);
    
    const resultsHtml = `
        <div style="margin-top: 20px; padding: 25px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border-left: 5px solid #007bff;">
            <h3 style="color: #007bff; margin-bottom: 20px;">📊 Linguistic Analysis Results</h3>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 25px;">
                <div style="background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                    <h4 style="margin: 0 0 10px 0; color: #495057;">📄 Document Info</h4>
                    <p><strong>Name:</strong> ${analysis.name}</p>
                    <p><strong>Language:</strong> <span style="color: #28a745; font-weight: bold;">${analysis.language}</span></p>
                    <p><strong>Total Words:</strong> ${analysis.wordCount.toLocaleString()}</p>
                    <p><strong>Unique Words:</strong> ${Object.keys(analysis.wordFrequency).length.toLocaleString()}</p>
                    <p><strong>Processed:</strong> ${analysis.uploadDate.toLocaleString()}</p>
                </div>
                
                <div style="background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                    <h4 style="margin: 0 0 10px 0; color: #495057;">🔤 Letter Frequency (A-Z)</h4>
                    ${hasLetterFreqData ? `
                        <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; font-size: 12px;">
                            ${topLetters.map(([letter, freq]) => `
                                <div style="text-align: center; padding: 5px; background: #f8f9fa; border-radius: 3px;">
                                    <div style="font-weight: bold; text-transform: uppercase;">${letter}</div>
                                    <div style="color: #007bff;">${freq}%</div>
                                </div>
                            `).join('')}
                        </div>
                        <p style="margin-top: 10px; font-size: 12px; color: #6c757d;">Top 10 most frequent letters</p>
                    ` : `
                        <div style="text-align: center; padding: 20px; color: #6c757d; background: #f8f9fa; border-radius: 5px;">
                            <p style="margin: 0; font-style: italic;">Letter frequency data not available</p>
                            <p style="margin: 5px 0 0 0; font-size: 12px;">This may be an older file. Try re-uploading for full analysis.</p>
                        </div>
                    `}
                </div>
            </div>
            
            ${analysis.foreignChars && analysis.foreignChars.length > 0 ? `
            <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin-bottom: 20px;">
                <h4 style="margin: 0 0 15px 0; color: #495057;">🌍 Non-English Characters Found</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px;">
                    ${analysis.foreignChars.slice(0, 10).map(fc => `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #fff3cd; border-radius: 5px; border-left: 3px solid #ffc107;">
                            <span style="font-weight: 500; font-size: 16px;">${fc.char}</span>
                            <div style="text-align: right; font-size: 12px;">
                                <div style="color: #007bff; font-weight: bold;">${fc.count} times</div>
                                <div style="color: #6c757d;">${fc.description}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <p style="margin-top: 10px; font-size: 12px; color: #6c757d;">
                    Found ${analysis.foreignChars.length} type(s) of accented characters - indicates non-English text
                </p>
            </div>
            ` : `
            <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin-bottom: 20px;">
                <h4 style="margin: 0 0 15px 0; color: #495057;">🌍 Character Analysis</h4>
                <p style="color: #28a745; font-weight: bold;">✅ No accented characters found - text uses standard English alphabet</p>
            </div>
            `}
            
            <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
                <h4 style="margin: 0 0 15px 0; color: #495057;">🏆 Top 5 Most Frequent Words</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                    ${topWords.map(([word, count], index) => `
                        <div style="text-align: center; padding: 15px; background: ${index === 0 ? '#ffd700' : index === 1 ? '#c0c0c0' : index === 2 ? '#cd7f32' : '#f8f9fa'}; border-radius: 8px; border: 2px solid ${index < 3 ? '#ffc107' : '#dee2e6'};">
                            <div style="font-size: 24px; margin-bottom: 5px;">${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}</div>
                            <div style="font-weight: bold; font-size: 18px; margin-bottom: 5px;">${word}</div>
                            <div style="color: #007bff; font-weight: bold; font-size: 16px;">${count} occurrences</div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div style="margin-top: 15px; text-align: center;">
                <button onclick="showDetailedAnalysis('${analysis.id}')" class="btn" style="background-color: #28a745;">📋 View Letter Distribution</button>
                <button onclick="downloadAnalysis('${analysis.id}')" class="btn" style="background-color: #17a2b8; margin-left: 10px;">💾 Download Report</button>
            </div>
        </div>
    `;
    
    // Add results after the upload section
    const uploadDiv = document.getElementById('uploadText');
    const existingResults = document.getElementById('analysisResults');
    if (existingResults) {
        existingResults.remove();
    }
    
    const resultsDiv = document.createElement('div');
    resultsDiv.id = 'analysisResults';
    resultsDiv.innerHTML = resultsHtml;
    uploadDiv.after(resultsDiv);
    
    // Scroll to results
    resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// =====================================
// SEARCH INDEX MANAGEMENT
// =====================================

/**
 * Update search index with new document
 * @param {Object} doc - Processed document
 */
async function updateSearchIndex(doc) {
    // Update local search index
    doc.words.forEach((word, index) => {
        if (!searchIndex[word]) {
            searchIndex[word] = [];
        }
        searchIndex[word].push({
            docId: doc.id,
            docName: doc.name,
            position: index
        });
    });
    
    // TODO: Update Firebase search index
    console.log('Search index updated for document:', doc.name);
}

// =====================================
// DATABASE OPERATIONS
// =====================================

/**
 * Clear all documents from database
 */
async function clearDatabase() {
    if (!confirm('Are you sure you want to clear all documents? This action cannot be undone.')) {
        return;
    }
    
    try {
        showProgress(true);
        
        // Clear local data
        currentDocuments = [];
        searchIndex = {};
        
        if (isFirebaseInitialized) {
            // Clear all Firebase collections
            const collections = ['documents', 'wordFrequencies', 'letterFrequencies', 'foreignCharacters', 'searchIndex'];
            
            for (const collectionName of collections) {
                const snapshot = await db.collection(collectionName).get();
                const batch = db.batch();
                
                snapshot.docs.forEach(doc => {
                    batch.delete(doc.ref);
                });
                
                if (!snapshot.empty) {
                    await batch.commit();
                }
            }
        }
        
        showProgress(false);
        showSuccess('Database cleared successfully');
        
        // Clear any displayed results
        const resultsDiv = document.getElementById('analysisResults');
        if (resultsDiv) {
            resultsDiv.remove();
        }
        
        // Refresh the file list
        await loadStoredFiles();
        
    } catch (error) {
        showProgress(false);
        showError('Error clearing database: ' + error.message);
        console.error('Database clear error:', error);
    }
}

// =====================================
// UTILITY FUNCTIONS
// =====================================

/**
 * Load stop words for all supported languages
 */
async function loadStopWords() {
    try {
        console.log('Loading comprehensive stop words for all languages...');
        
        // English stop words
        stopWords = [
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
            'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
            'before', 'after', 'above', 'below', 'between', 'among', 'is', 'are', 
            'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 
            'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can',
            'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
            'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that', 'these', 'those',
            'textbf', 'so', 'than', 'too', 'very', 'myself', 'ourselves', 'yours', 'yourself',
            'yourselves', 'himself', 'herself', 'itself', 'themselves', 'what', 'which', 'who',
            'whom', 'am', 'having', 'doing', 'ought', 'further', 'then', 'once', 'here', 'there',
            'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most',
            'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'down', 'out',
            'off', 'over', 'under', 'again', 'ours', 'against', 'as', 'until', 'while', 'same',
            'if', 'because', 'now', 'since', 'just', 'even', 'also', 'still', 'already', 'yet',
            'never', 'always', 'sometimes', 'often', 'usually', 'really', 'actually', 'quite',
            'rather', 'pretty', 'enough', 'almost', 'nearly', 'little', 'much', 'many', 'long',
            'short', 'old', 'new', 'good', 'bad', 'big', 'small', 'high', 'low', 'right', 'left',
            'first', 'last', 'next', 'previous', 'another', 'every', 'each', 'either', 'neither',
            'both', 'one', 'two', 'three', 'way', 'back', 'come', 'came', 'get', 'got', 'go',
            'went', 'see', 'saw', 'know', 'knew', 'think', 'thought', 'say', 'said', 'take',
            'took', 'give', 'gave', 'make', 'made', 'look', 'looked', 'use', 'used', 'find',
            'found', 'want', 'wanted', 'work', 'worked', 'call', 'called', 'try', 'tried'
        ];
        
        // French stop words
        frenchStopWords = [
            'le', 'de', 'et', 'à', 'un', 'il', 'être', 'et', 'en', 'avoir', 'que', 'pour',
            'dans', 'ce', 'son', 'une', 'sur', 'avec', 'ne', 'se', 'pas', 'tout', 'plus',
            'par', 'grand', 'en', 'une', 'être', 'et', 'en', 'avoir', 'que', 'pour', 'dans',
            'ce', 'son', 'sur', 'avec', 'ne', 'se', 'pas', 'tout', 'plus', 'par', 'grand',
            'en', 'une', 'être', 'et', 'en', 'avoir', 'que', 'pour', 'dans', 'ce', 'son',
            'la', 'des', 'les', 'du', 'est', 'un', 'pour', 'sont', 'se', 'le', 'avec',
            'te', 'si', 'lui', 'nous', 'ou', 'elle', 'mais', 'où', 'donc', 'très', 'sans',
            'être', 'avoir', 'faire', 'aller', 'pouvoir', 'voir', 'en', 'dire', 'me', 'donner',
            'tout', 'rien', 'bien', 'autre', 'après', 'long', 'ici', 'tous', 'pendant',
            'matin', 'trop', 'je', 'tu', 'vous', 'nos', 'vos', 'ses', 'ces', 'cette',
            'cet', 'mon', 'ton', 'sa', 'ma', 'ta', 'notre', 'votre', 'leur', 'leurs'
        ];
        
        // Spanish stop words
        spanishStopWords = [
            'el', 'la', 'de', 'que', 'y', 'a', 'en', 'un', 'ser', 'se', 'no', 'te', 'lo',
            'le', 'da', 'su', 'por', 'son', 'con', 'para', 'al', 'del', 'los', 'las', 'una',
            'es', 'está', 'como', 'me', 'si', 'sin', 'sobre', 'este', 'ya', 'entre', 'cuando',
            'todo', 'esta', 'ser', 'son', 'dos', 'también', 'fue', 'había', 'era', 'muy',
            'años', 'hasta', 'desde', 'está', 'estaba', 'estamos', 'pueden', 'hubo', 'hay',
            'han', 'he', 'has', 'había', 'habían', 'tener', 'tiene', 'tenía', 'tengo',
            'pero', 'por', 'qué', 'porque', 'o', 'u', 'yo', 'tú', 'él', 'ella', 'nosotros',
            'vosotros', 'ellos', 'ellas', 'mi', 'mis', 'tu', 'tus', 'sus', 'nuestro',
            'nuestra', 'nuestros', 'nuestras', 'vuestro', 'vuestra', 'vuestros', 'vuestras',
            'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'aquel',
            'aquella', 'aquellos', 'aquellas', 'ser', 'estar', 'tener', 'hacer', 'poder',
            'decir', 'ir', 'ver', 'dar', 'saber', 'querer', 'llegar', 'pasar', 'deber',
            'poner', 'parecer', 'quedar', 'creer', 'hablar', 'llevar', 'dejar', 'seguir',
            'encontrar', 'llamar', 'venir', 'pensar', 'salir', 'volver', 'tomar', 'conocer',
            'vivir', 'sentir', 'tratar', 'mirar', 'contar', 'empezar', 'esperar', 'buscar',
            'existir', 'entrar', 'trabajar', 'escribir', 'perder', 'producir', 'ocurrir'
        ];
        
        console.log('Stop words loaded:');
        console.log('- English:', stopWords.length);
        console.log('- French:', frenchStopWords.length);
        console.log('- Spanish:', spanishStopWords.length);
        
        // Verify common stop words are included for each language
        console.log('\nVerifying stop words:');
        
        // English verification
        const commonEnglishWords = ['the', 'and', 'in', 'to', 'is', 'at', 'of', 'for'];
        console.log('English stop words:');
        commonEnglishWords.forEach(word => {
            const included = stopWords.includes(word);
            console.log(`  "${word}" included: ${included}`);
        });
        
        // French verification
        const commonFrenchWords = ['le', 'de', 'et', 'un', 'à', 'être', 'ce', 'il'];
        console.log('French stop words:');
        commonFrenchWords.forEach(word => {
            const included = frenchStopWords.includes(word);
            console.log(`  "${word}" included: ${included}`);
        });
        
        // Spanish verification
        const commonSpanishWords = ['el', 'de', 'que', 'y', 'a', 'en', 'un', 'es'];
        console.log('Spanish stop words:');
        commonSpanishWords.forEach(word => {
            const included = spanishStopWords.includes(word);
            console.log(`  "${word}" included: ${included}`);
        });
        
    } catch (error) {
        console.error('Error in loadStopWords:', error);
    }
}

/**
 * Generate unique document ID
 * @returns {string} - Unique document ID
 */
function generateDocumentId() {
    return 'doc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * Calculate average word length
 * @param {Array} words - Array of words
 * @returns {number} - Average word length
 */
function calculateAverageWordLength(words) {
    if (words.length === 0) return 0;
    const totalLength = words.reduce((sum, word) => sum + word.length, 0);
    return totalLength / words.length;
}

/**
 * Show detailed analysis (letter distribution)
 * @param {string} docId - Document ID
 */
async function showDetailedAnalysis(docId) {
    try {
        let doc = null;
        
        // First check if this matches the current analysis data (works for sample files)
        if (currentAnalysisData && currentAnalysisData.id === docId) {
            doc = currentAnalysisData;
        } else {
            // Try to find in current documents
            doc = currentDocuments.find(d => d.id === docId);
            
            // If not found locally, fetch from Firebase
            if (!doc) {
                if (!isFirebaseInitialized) {
                    showError('Firebase not available and document not found locally');
                    return;
                }
                const docSnapshot = await db.collection('documents').doc(docId).get();
                if (!docSnapshot.exists) {
                    showError('Document not found');
                    return;
                }
                doc = { id: docSnapshot.id, ...docSnapshot.data() };
            }
        }
        
        // Check if letter frequency data exists
        if (!doc.letterFrequency) {
            showError('Letter frequency data not available for this document');
            return;
        }
    
        // Create detailed letter distribution chart
        const allLetters = 'abcdefghijklmnopqrstuvwxyz'.split('');
        const letterData = allLetters.map(letter => ({
            letter: letter.toUpperCase(),
            frequency: parseFloat(doc.letterFrequency[letter]) || 0
        }));
        
        const detailsHtml = `
            <div style="margin-top: 20px; padding: 25px; background: white; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); border-left: 5px solid #17a2b8;">
                <h3 style="color: #17a2b8; margin-bottom: 20px;">📊 Complete Letter Distribution - ${doc.name}</h3>
                
                <div style="display: grid; grid-template-columns: repeat(13, 1fr); gap: 10px; margin-bottom: 20px;">
                    ${letterData.map(({ letter, frequency }) => `
                        <div style="text-align: center; padding: 10px; background: linear-gradient(135deg, #f8f9fa 0%, ${frequency > 8 ? '#ffecb3' : frequency > 4 ? '#f0f4f8' : '#fafafa'} 100%); border-radius: 8px; border: 1px solid #dee2e6;">
                            <div style="font-weight: bold; font-size: 18px; color: #495057;">${letter}</div>
                            <div style="color: #007bff; font-weight: bold;">${frequency}%</div>
                            <div style="height: ${Math.max(3, frequency * 2)}px; background: linear-gradient(45deg, #007bff, #17a2b8); margin-top: 5px; border-radius: 2px;"></div>
                        </div>
                    `).join('')}
                </div>
                
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                    <h4 style="margin: 0 0 10px 0;">📈 Analysis Summary</h4>
                    <p><strong>Most common letter:</strong> ${letterData.sort((a, b) => b.frequency - a.frequency)[0].letter} (${letterData.sort((a, b) => b.frequency - a.frequency)[0].frequency}%)</p>
                    <p><strong>Least common letter:</strong> ${letterData.filter(l => l.frequency > 0).sort((a, b) => a.frequency - b.frequency)[0]?.letter || 'None'} (${letterData.filter(l => l.frequency > 0).sort((a, b) => a.frequency - b.frequency)[0]?.frequency || 0}%)</p>
                    <p><strong>Letters not found:</strong> ${letterData.filter(l => l.frequency === 0).map(l => l.letter).join(', ') || 'All letters present'}</p>
                </div>
                
                ${doc.foreignChars && doc.foreignChars.length > 0 ? `
                <div style="background: #fff3cd; padding: 15px; border-radius: 8px; border-left: 4px solid #ffc107;">
                    <h4 style="margin: 0 0 10px 0;">🌍 Foreign Characters Details</h4>
                    ${doc.foreignChars.map(fc => `
                        <p><strong>${fc.char}</strong> (${fc.description}): appears ${fc.count} times</p>
                    `).join('')}
                </div>
                ` : ''}
                
                <div style="text-align: center; margin-top: 20px;">
                    <button onclick="closeDetailedAnalysis()" class="btn" style="background-color: #6c757d;">✖ Close</button>
                </div>
            </div>
        `;
        
        // Add detailed analysis
        const analysisDiv = document.getElementById('analysisResults');
        let detailedDiv = document.getElementById('detailedAnalysis');
        if (detailedDiv) {
            detailedDiv.remove();
        }
        
        detailedDiv = document.createElement('div');
        detailedDiv.id = 'detailedAnalysis';
        detailedDiv.innerHTML = detailsHtml;
        analysisDiv.after(detailedDiv);
        
        // Scroll to detailed analysis
        detailedDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
    } catch (error) {
        console.error('Error loading detailed analysis:', error);
        showError('Failed to load detailed analysis: ' + error.message);
    }
}

/**
 * Close detailed analysis view
 */
function closeDetailedAnalysis() {
    const detailedDiv = document.getElementById('detailedAnalysis');
    if (detailedDiv) {
        detailedDiv.remove();
    }
}

/**
 * Download analysis report (placeholder for future feature)
 * @param {string} docId - Document ID
 */
function downloadAnalysis(docId) {
    let doc = null;
    
    // First check if this matches the current analysis data (works for sample files)
    if (currentAnalysisData && currentAnalysisData.id === docId) {
        doc = currentAnalysisData;
    } else {
        // Try to find in current documents
        doc = currentDocuments.find(d => d.id === docId);
    }
    
    if (!doc) {
        showError('Document not found');
        return;
    }
    
    // Create a simple text report
    const report = `TEXT ANALYSIS REPORT
====================
Document: ${doc.name}
Analyzed: ${doc.uploadDate.toLocaleString()}
Language: ${doc.language}
Total Words: ${doc.wordCount}
Unique Words: ${Object.keys(doc.wordFrequency).length}

TOP WORDS:
${Object.entries(doc.wordFrequency)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 20)
    .map(([word, count], index) => `${index + 1}. ${word}: ${count}`)
    .join('\n')}
`;
    
    // Download as text file
    const blob = new Blob([report], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analysis_${doc.name.replace('.txt', '')}_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    showSuccess('Analysis report downloaded!');
}

/**
 * Show progress indicator
 * @param {boolean} show - Whether to show or hide progress
 */
function showProgress(show) {
    const progressDiv = document.getElementById('uploadProgress');
    if (progressDiv) {
        progressDiv.style.display = show ? 'block' : 'none';
        
        if (show) {
            // Update progress text to be more informative
            const percentageSpan = document.getElementById('uploadPercentage');
            const recordsSpan = document.getElementById('recordsUploaded');
            if (percentageSpan) percentageSpan.textContent = 'Processing...';
            if (recordsSpan) recordsSpan.textContent = 'Analyzing text';
        }
    }
    
    // Also show/hide loading overlay
    let loadingOverlay = document.getElementById('loadingOverlay');
    if (show && !loadingOverlay) {
        loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'loadingOverlay';
        loadingOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        `;
        loadingOverlay.innerHTML = `
            <div style="background: white; padding: 30px; border-radius: 10px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                <div class="loading-spinner"></div>
                <h3>Processing Document...</h3>
                <p>Analyzing text and detecting language</p>
            </div>
        `;
        document.body.appendChild(loadingOverlay);
    } else if (!show && loadingOverlay) {
        loadingOverlay.remove();
    }
}

/**
 * Show error message
 * @param {string} message - Error message to display
 */
function showError(message) {
    console.error(message);
    
    // Create or update error message div
    let errorDiv = document.getElementById('errorMessage');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.id = 'errorMessage';
        errorDiv.className = 'error';
        document.body.appendChild(errorDiv);
    }
    
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

/**
 * Show success message
 * @param {string} message - Success message to display
 */
function showSuccess(message) {
    console.log(message);
    
    // Create or update success message div
    let successDiv = document.getElementById('successMessage');
    if (!successDiv) {
        successDiv = document.createElement('div');
        successDiv.id = 'successMessage';
        successDiv.className = 'success';
        document.body.appendChild(successDiv);
    }
    
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        successDiv.style.display = 'none';
    }, 3000);
}

/**
 * Show error modal for garbage files and other critical errors
 * @param {string} message - Error message to display
 * @param {string} title - Optional custom title (default: "File Upload Error")
 * @param {string} icon - Optional custom icon (default: "⚠️")
 */
function showErrorModal(message, title = "File Upload Error", icon = "⚠️") {
    console.error('Modal Error:', message);
    
    const modal = document.getElementById('errorModal');
    const messageContainer = document.getElementById('modalErrorMessage');
    
    if (modal && messageContainer) {
        // Update the title and icon
        const titleElement = modal.querySelector('.modal-header h3');
        const iconElement = modal.querySelector('.modal-icon');
        
        if (titleElement) titleElement.textContent = title;
        if (iconElement) iconElement.textContent = icon;
        
        messageContainer.innerHTML = message;
        modal.style.display = 'block';
        
        // Add click handler to close modal when clicking outside
        modal.onclick = function(event) {
            if (event.target === modal) {
                closeErrorModal();
            }
        };
        
        // Add escape key handler
        document.addEventListener('keydown', handleModalEscape);
    } else {
        // Fallback to regular error if modal elements not found
        showError(message);
    }
}

/**
 * Close the error modal
 */
function closeErrorModal() {
    const modal = document.getElementById('errorModal');
    if (modal) {
        modal.style.display = 'none';
        // Remove escape key handler
        document.removeEventListener('keydown', handleModalEscape);
    }
}

/**
 * Handle escape key to close modal
 * @param {KeyboardEvent} event - Keyboard event
 */
function handleModalEscape(event) {
    if (event.key === 'Escape') {
        closeErrorModal();
    }
}

// =====================================
// FIREBASE HELPER FUNCTIONS
// =====================================

/**
 * Store document in Firebase
 * @param {Object} doc - Document to store
 */
async function storeDocument(doc) {
    if (!isFirebaseInitialized) {
        console.log('Firebase not initialized. Document stored locally only:', doc.name);
        // Store in local array for now
        currentDocuments.push(doc);
        return;
    }
    
    try {
        // Store main document data
        await db.collection('documents').doc(doc.id).set({
            name: doc.name,
            uploadDate: doc.uploadDate,
            wordCount: doc.wordCount,
            language: doc.language,
            originalContent: doc.originalContent,
            cleanedText: doc.cleanedText
        });
        
        // Store word frequency data
        await db.collection('wordFrequencies').doc(doc.id).set({
            documentId: doc.id,
            documentName: doc.name,
            frequencies: doc.wordFrequency
        });
        
        // Also store locally
        currentDocuments.push(doc);
        
        console.log('Document stored in Firebase successfully:', doc.name);
    } catch (error) {
        if (error.code === 'permission-denied') {
            console.warn('Firebase permission denied for writing. Storing locally only:', doc.name);
            // Store locally as fallback
            currentDocuments.push(doc);
        } else {
            console.error('Error storing document in Firebase:', error);
            // Still store locally even if Firebase fails
            currentDocuments.push(doc);
            throw error;
        }
    }
}

/**
 * Load existing documents from Firebase
 */
async function loadExistingDocuments() {
    if (!isFirebaseInitialized) {
        console.log('Firebase not initialized. Skipping document loading.');
        return;
    }
    
    try {
        // Test Firebase connection first with a simple read
        console.log('Testing Firebase connection...');
        const snapshot = await db.collection('documents').limit(1).get();
        
        if (snapshot.empty) {
            console.log('No documents found in Firebase (this is normal for new projects)');
            return;
        }
        
        // Load all documents if test was successful
        const allDocsSnapshot = await db.collection('documents').get();
        currentDocuments = [];
        
        allDocsSnapshot.forEach(doc => {
            currentDocuments.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        console.log(`Loaded ${currentDocuments.length} documents from Firebase`);
    } catch (error) {
        if (error.code === 'permission-denied') {
            console.warn('Firebase permission denied. This is expected with secure rules. App will work in local mode.');
            console.warn('For development: You can temporarily allow access, but make sure to secure it for production.');
            showError('Firebase access restricted (this is normal for security). Working in offline mode.');
        } else {
            console.error('Error loading documents from Firebase:', error);
        }
        // Don't throw error - app should still work without Firebase
    }
}

// =====================================
// FILE LIST MANAGEMENT
// =====================================

// Drag and drop state variables
let draggedElement = null;
let draggedIndex = null;
let currentDropIndex = null;
let placeholder = null;

/**
 * Load and display all stored files from Firebase
 */
async function loadStoredFiles() {
    const fileListDiv = document.getElementById('fileList');
    
    if (!isFirebaseInitialized) {
        // Show local files if any
        if (currentDocuments.length === 0) {
            fileListDiv.innerHTML = `
                <div style="text-align: center; color: #6c757d; padding: 20px;">
                    <div style="font-size: 24px; margin-bottom: 10px;">📄</div>
                    <p>No files uploaded yet. Upload a text file above to get started!</p>
                </div>
            `;
        } else {
            // Apply saved order to local files
            const orderedFiles = await applyFileOrder(currentDocuments);
            displayFileList(orderedFiles);
        }
        return;
    }
    
    try {
        fileListDiv.innerHTML = `
            <div style="text-align: center; color: #6c757d; padding: 20px;">
                <div class="loading-spinner"></div>
                <p>Loading files...</p>
            </div>
        `;
        
        const snapshot = await db.collection('documents').orderBy('uploadDate', 'desc').get();
        const files = [];
        
        snapshot.forEach(doc => {
            files.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        if (files.length === 0) {
            fileListDiv.innerHTML = `
                <div style="text-align: center; color: #6c757d; padding: 20px;">
                    <div style="font-size: 24px; margin-bottom: 10px;">📄</div>
                    <p>No files uploaded yet. Upload a text file above to get started!</p>
                </div>
            `;
        } else {
            // Apply saved order to files
            const orderedFiles = await applyFileOrder(files);
            displayFileList(orderedFiles);
        }
        
    } catch (error) {
        console.error('Error loading stored files:', error);
        fileListDiv.innerHTML = `
            <div style="text-align: center; color: #dc3545; padding: 20px;">
                <div style="font-size: 24px; margin-bottom: 10px;">⚠️</div>
                <p>Error loading files. Please try refreshing the page.</p>
            </div>
        `;
    }
}

/**
 * Display the list of files in the UI with drag and drop functionality
 */
function displayFileList(files) {
    const fileListDiv = document.getElementById('fileList');
    
    const filesHtml = files.map((file, index) => {
        const uploadDate = file.uploadDate instanceof Date ? file.uploadDate : 
                          file.uploadDate?.toDate ? file.uploadDate.toDate() : 
                          new Date(file.uploadDate);
        
        return `
            <div class="file-item" 
                 draggable="true"
                 data-file-id="${file.id}"
                 data-index="${index}"
                 style="display: flex; align-items: center; justify-content: space-between; padding: 15px; margin-bottom: 10px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #007bff; cursor: move;">
                
                <!-- Drag Handle -->
                <div class="drag-handle" style="display: flex; flex-direction: column; align-items: center; margin-right: 10px; color: #6c757d; cursor: grab; padding: 5px;" title="Drag to reorder">
                    <div style="width: 4px; height: 4px; background: #6c757d; border-radius: 50%; margin: 1px;"></div>
                    <div style="width: 4px; height: 4px; background: #6c757d; border-radius: 50%; margin: 1px;"></div>
                    <div style="width: 4px; height: 4px; background: #6c757d; border-radius: 50%; margin: 1px;"></div>
                    <div style="width: 4px; height: 4px; background: #6c757d; border-radius: 50%; margin: 1px;"></div>
                    <div style="width: 4px; height: 4px; background: #6c757d; border-radius: 50%; margin: 1px;"></div>
                    <div style="width: 4px; height: 4px; background: #6c757d; border-radius: 50%; margin: 1px;"></div>
                </div>
                
                <div style="flex-grow: 1;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 20px;">📄</span>
                        <div>
                            <div class="file-name" style="font-weight: bold; color: #007bff; cursor: pointer; text-decoration: underline;" 
                                 onclick="viewFileAnalysis('${file.id}', '${file.name}')" 
                                 title="Click to view analysis">
                                ${file.name}
                            </div>
                            <div style="font-size: 12px; color: #6c757d;">
                                Uploaded: ${uploadDate.toLocaleDateString()} at ${uploadDate.toLocaleTimeString()}
                                | Words: ${file.wordCount?.toLocaleString() || 'N/A'}
                                | Language: ${file.language || 'Unknown'}
                            </div>
                        </div>
                    </div>
                </div>
                <button onclick="removeFile('${file.id}', '${file.name}')" 
                        class="btn" 
                        style="background-color: #dc3545; padding: 8px 15px; font-size: 12px;"
                        title="Remove this file">
                    🗑️ Remove
                </button>
            </div>
        `;
    }).join('');
    
    fileListDiv.innerHTML = filesHtml;
    
    // Add drag and drop event listeners after the HTML is rendered
    setupDragAndDrop();
}

/**
 * Setup drag and drop functionality for file list
 */
function setupDragAndDrop() {
    const fileItems = document.querySelectorAll('.file-item');
    
    fileItems.forEach((item, index) => {
        // Drag start
        item.addEventListener('dragstart', (e) => {
            draggedElement = item;
            draggedIndex = parseInt(item.dataset.index);
            
            // Style the dragged element
            item.classList.add('dragging');
            
            // Change cursor for drag handle
            const dragHandle = item.querySelector('.drag-handle');
            if (dragHandle) {
                dragHandle.style.cursor = 'grabbing';
            }
            
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', item.outerHTML);
        });
        
        // Drag end
        item.addEventListener('dragend', (e) => {
            item.classList.remove('dragging');
            
            // Reset cursor for drag handle
            const dragHandle = item.querySelector('.drag-handle');
            if (dragHandle) {
                dragHandle.style.cursor = 'grab';
            }
            
            // Remove all drop indicators
            document.querySelectorAll('.file-item').forEach(el => {
                el.style.borderTop = '';
                el.style.borderBottom = '';
            });
            
            // Reset global variables
            draggedElement = null;
            draggedIndex = null;
            currentDropIndex = null;
            placeholder = null;
        });
        
        // Drag over
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            if (draggedElement && draggedElement !== item) {
                const rect = item.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                
                // Remove previous indicators
                document.querySelectorAll('.file-item').forEach(el => {
                    el.style.borderTop = '';
                    el.style.borderBottom = '';
                });
                
                // Add drop indicator
                if (e.clientY < midY) {
                    item.style.borderTop = '3px solid #007bff';
                } else {
                    item.style.borderBottom = '3px solid #007bff';
                }
            }
        });
        
        // Drag leave
        item.addEventListener('dragleave', (e) => {
            // Only remove border if we're actually leaving the item
            if (!item.contains(e.relatedTarget)) {
                item.style.borderTop = '';
                item.style.borderBottom = '';
            }
        });
        
        // Drop
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            
            if (draggedElement && draggedElement !== item) {
                const dropIndex = parseInt(item.dataset.index);
                const rect = item.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                
                let newIndex;
                if (e.clientY < midY) {
                    newIndex = dropIndex;
                } else {
                    newIndex = dropIndex + 1;
                }
                
                // Adjust for removal of dragged item
                if (draggedIndex < newIndex) {
                    newIndex--;
                }
                
                reorderFiles(draggedIndex, newIndex);
            }
            
            // Remove all drop indicators
            document.querySelectorAll('.file-item').forEach(el => {
                el.style.borderTop = '';
                el.style.borderBottom = '';
            });
        });
        
        // Hover effects for drag handle
        const dragHandle = item.querySelector('.drag-handle');
        if (dragHandle) {
            dragHandle.addEventListener('mouseenter', () => {
                dragHandle.style.color = '#007bff';
            });
            
            dragHandle.addEventListener('mouseleave', () => {
                dragHandle.style.color = '#6c757d';
            });
        }
    });
}

/**
 * Reorder files array and update display
 */
async function reorderFiles(fromIndex, toIndex) {
    const fileListDiv = document.getElementById('fileList');
    const allItems = Array.from(fileListDiv.children);
    
    // Get current file data from the DOM
    const currentFiles = allItems.map(item => ({
        id: item.dataset.fileId,
        element: item
    }));
    
    // Perform the reorder
    const [movedFile] = currentFiles.splice(fromIndex, 1);
    currentFiles.splice(toIndex, 0, movedFile);
    
    // Update the display order
    fileListDiv.innerHTML = '';
    currentFiles.forEach((file, index) => {
        file.element.dataset.index = index;
        fileListDiv.appendChild(file.element);
    });
    
    // Re-setup drag and drop for the reordered elements
    setupDragAndDrop();
    
    // Save the new order to Firebase
    await saveFileOrder(currentFiles.map(file => file.id));
    
    console.log(`Moved file from position ${fromIndex} to position ${toIndex}`);
}

/**
 * Save the current file order to Firebase
 */
async function saveFileOrder(fileIds) {
    if (!isFirebaseInitialized) {
        console.log('Firebase not initialized, file order saved locally only');
        localStorage.setItem('textReader_fileOrder', JSON.stringify(fileIds));
        return;
    }
    
    try {
        const orderData = {
            fileIds: fileIds,
            lastUpdated: new Date(),
            userId: 'default' // You could expand this for multi-user support
        };
        
        await db.collection('fileOrder').doc('default').set(orderData);
        console.log('File order saved to Firebase');
        
        // Also save to localStorage as backup
        localStorage.setItem('textReader_fileOrder', JSON.stringify(fileIds));
        
    } catch (error) {
        console.error('Error saving file order:', error);
        // Fallback to localStorage
        localStorage.setItem('textReader_fileOrder', JSON.stringify(fileIds));
    }
}

/**
 * Load the saved file order from Firebase
 */
async function loadFileOrder() {
    if (!isFirebaseInitialized) {
        // Try to load from localStorage
        const savedOrder = localStorage.getItem('textReader_fileOrder');
        return savedOrder ? JSON.parse(savedOrder) : null;
    }
    
    try {
        const orderDoc = await db.collection('fileOrder').doc('default').get();
        
        if (orderDoc.exists) {
            const orderData = orderDoc.data();
            console.log('File order loaded from Firebase');
            
            // Also save to localStorage as backup
            localStorage.setItem('textReader_fileOrder', JSON.stringify(orderData.fileIds));
            
            return orderData.fileIds;
        } else {
            // Try localStorage as fallback
            const savedOrder = localStorage.getItem('textReader_fileOrder');
            return savedOrder ? JSON.parse(savedOrder) : null;
        }
        
    } catch (error) {
        console.error('Error loading file order:', error);
        
        // Fallback to localStorage
        const savedOrder = localStorage.getItem('textReader_fileOrder');
        return savedOrder ? JSON.parse(savedOrder) : null;
    }
}

/**
 * Apply saved file order to files array
 */
async function applyFileOrder(files) {
    const savedOrder = await loadFileOrder();
    
    if (!savedOrder || savedOrder.length === 0) {
        // No saved order, return files sorted by upload date (newest first)
        return files.sort((a, b) => {
            const dateA = a.uploadDate instanceof Date ? a.uploadDate : 
                         a.uploadDate?.toDate ? a.uploadDate.toDate() : new Date(a.uploadDate);
            const dateB = b.uploadDate instanceof Date ? b.uploadDate : 
                         b.uploadDate?.toDate ? b.uploadDate.toDate() : new Date(b.uploadDate);
            return dateB - dateA;
        });
    }
    
    // Create a map for quick lookup
    const fileMap = new Map();
    files.forEach(file => fileMap.set(file.id, file));
    
    // Order files according to saved order
    const orderedFiles = [];
    const remainingFiles = [...files];
    
    // First, add files in the saved order
    savedOrder.forEach(fileId => {
        const file = fileMap.get(fileId);
        if (file) {
            orderedFiles.push(file);
            const index = remainingFiles.findIndex(f => f.id === fileId);
            if (index !== -1) {
                remainingFiles.splice(index, 1);
            }
        }
    });
    
    // Then add any new files that weren't in the saved order (at the end)
    remainingFiles.forEach(file => {
        orderedFiles.push(file);
    });
    
    console.log(`Applied file order: ${orderedFiles.length} files arranged`);
    return orderedFiles;
}

/**
 * Update saved file order after a file is deleted
 */
async function updateFileOrderAfterDeletion(deletedFileId) {
    try {
        const savedOrder = await loadFileOrder();
        if (savedOrder && savedOrder.length > 0) {
            // Remove the deleted file from the saved order
            const updatedOrder = savedOrder.filter(fileId => fileId !== deletedFileId);
            
            if (updatedOrder.length !== savedOrder.length) {
                // Save the updated order
                await saveFileOrder(updatedOrder);
                console.log(`Updated file order after deletion: removed ${deletedFileId}`);
            }
        }
    } catch (error) {
        console.error('Error updating file order after deletion:', error);
    }
}

/**
 * View analysis results for a specific file
 */
async function viewFileAnalysis(fileId, fileName) {
    try {
        showProgress(true);
        
        if (!isFirebaseInitialized) {
            // Find file in local storage
            const file = currentDocuments.find(doc => doc.id === fileId);
            if (file) {
                displayAnalysisResults(file);
            } else {
                showError('File not found in local storage');
            }
            showProgress(false);
            return;
        }
        
        // Fetch complete file data from Firebase
        const docSnapshot = await db.collection('documents').doc(fileId).get();
        const wordFreqSnapshot = await db.collection('wordFrequencies').doc(fileId).get();
        const letterFreqSnapshot = await db.collection('letterFrequencies').doc(fileId).get();
        const foreignCharsSnapshot = await db.collection('foreignCharacters').doc(fileId).get();
        
        if (!docSnapshot.exists) {
            showError('File not found in database');
            showProgress(false);
            return;
        }
        
        // Reconstruct the analysis object
        const docData = docSnapshot.data();
        const wordFreqData = wordFreqSnapshot.exists ? wordFreqSnapshot.data() : {};
        const letterFreqData = letterFreqSnapshot.exists ? letterFreqSnapshot.data() : {};
        const foreignCharsData = foreignCharsSnapshot.exists ? foreignCharsSnapshot.data() : {};
        
        const analysisData = {
            id: fileId,
            name: docData.name,
            uploadDate: docData.uploadDate?.toDate ? docData.uploadDate.toDate() : new Date(docData.uploadDate),
            wordCount: docData.wordCount,
            language: docData.language,
            wordFrequency: wordFreqData.frequencies || {},
            letterFrequency: letterFreqData.frequencies || {},
            foreignChars: foreignCharsData.characters || []
        };
        
        displayAnalysisResults(analysisData);
        showProgress(false);
        
    } catch (error) {
        showProgress(false);
        showError('Error loading file analysis: ' + error.message);
        console.error('Error loading file analysis:', error);
    }
}

/**
 * Remove a file from the database
 */
async function removeFile(fileId, fileName) {
    if (!confirm(`Are you sure you want to remove "${fileName}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        showProgress(true);
        
        if (!isFirebaseInitialized) {
            // Remove from local storage
            const index = currentDocuments.findIndex(doc => doc.id === fileId);
            if (index !== -1) {
                currentDocuments.splice(index, 1);
                await loadStoredFiles(); // Refresh the list
                showSuccess(`Removed "${fileName}" from local storage`);
            } else {
                showError('File not found in local storage');
            }
            showProgress(false);
            return;
        }
        
        // Delete from all Firebase collections
        const batch = db.batch();
        
        batch.delete(db.collection('documents').doc(fileId));
        batch.delete(db.collection('wordFrequencies').doc(fileId));
        batch.delete(db.collection('letterFrequencies').doc(fileId));
        batch.delete(db.collection('foreignCharacters').doc(fileId));
        batch.delete(db.collection('searchIndex').doc(fileId));
        
        await batch.commit();
        
        showProgress(false);
        showSuccess(`Successfully removed "${fileName}"`);
        
        // Clear analysis results if showing this file
        const analysisResults = document.getElementById('analysisResults');
        if (analysisResults) {
            analysisResults.remove();
        }
        
        // Refresh the file list
        await loadStoredFiles();
        
        // Update the saved order to remove the deleted file
        await updateFileOrderAfterDeletion(fileId);
        
    } catch (error) {
        showProgress(false);
        showError('Error removing file: ' + error.message);
        console.error('Error removing file:', error);
    }
}

// =====================================
// EXPORT FOR TESTING (if needed)
// =====================================
// Make functions globally accessible for HTML onclick handlers
window.uploadText = uploadText;
window.analyzeText = analyzeText;
window.clearDatabase = clearDatabase;
window.showDetailedAnalysis = showDetailedAnalysis;
window.downloadAnalysis = downloadAnalysis;
window.closeDetailedAnalysis = closeDetailedAnalysis;
window.loadStoredFiles = loadStoredFiles;
window.viewFileAnalysis = viewFileAnalysis;
window.removeFile = removeFile;

// For testing purposes, you can also access these
// window.TextReaderApp = {
//     cleanText,
//     tokenizeText,
//     detectLanguage,
//     processDocument
// };

// =====================================
// SEARCH FUNCTIONALITY
// =====================================

/**
 * Search files for keywords and display results
 */
async function searchFiles() {
    const searchInput = document.getElementById('searchInput');
    const searchQuery = searchInput.value.trim();
    
    if (!searchQuery) {
        showError('Please enter search terms');
        return;
    }
    
    try {
        showProgress(true);
        
        // Break search query into keywords and process wildcards
        const rawKeywords = searchQuery.toLowerCase()
            .split(/\s+/)
            .filter(word => word.length > 2) // Only words with 3+ characters
            .map(word => {
                // Preserve asterisks for wildcard processing, remove other punctuation
                return word.replace(/[^\w*]/g, '');
            });
        
        if (rawKeywords.length === 0) {
            showError('Please enter valid search terms (at least 3 characters each)');
            showProgress(false);
            return;
        }
        
        // Create enhanced keyword list with stemming
        const keywords = [];
        const keywordInfo = [];
        
        rawKeywords.forEach(keyword => {
            if (keyword.includes('*')) {
                // Wildcard search - use as-is
                keywords.push(keyword);
                keywordInfo.push({ original: keyword, type: 'wildcard' });
            } else {
                // Regular word - add both original and stemmed version
                keywords.push(keyword);
                keywordInfo.push({ original: keyword, type: 'exact' });
                
                const stemmed = stemWord(keyword);
                if (stemmed !== keyword && stemmed.length > 2) {
                    keywords.push(stemmed);
                    keywordInfo.push({ original: keyword, stemmed: stemmed, type: 'stemmed' });
                }
            }
        });
        
        console.log('Searching for keywords (including stemmed):', keywords);
        console.log('Keyword details:', keywordInfo);
        
        // Search across both Firebase documents and sample files
        const searchResults = [];
        
        // Search Firebase documents
        const documentsSnapshot = await db.collection('documents').get();
        documentsSnapshot.forEach(doc => {
            const data = doc.data();
            const matches = findKeywordsInText(data.cleanedText || data.originalContent, keywords);
            
            if (matches.length > 0) {
                searchResults.push({
                    id: doc.id,
                    filename: data.name,
                    matches: matches,
                    originalContent: data.originalContent,
                    cleanedText: data.cleanedText || data.originalContent,
                    isSample: false
                });
            }
        });
        
        // Search sample files
        sampleFilesCache.forEach(sampleFile => {
            const matches = findKeywordsInText(sampleFile.cleanedText, keywords);
            
            if (matches.length > 0) {
                searchResults.push({
                    id: sampleFile.id,
                    filename: sampleFile.filename + ' 📚',
                    matches: matches,
                    originalContent: sampleFile.originalContent,
                    cleanedText: sampleFile.cleanedText,
                    isSample: true
                });
            }
        });
        
        console.log(`Found ${searchResults.length} documents with matches (${searchResults.filter(r => r.isSample).length} sample files)`);
        
        showProgress(false);
        displaySearchResults(searchResults, rawKeywords, keywordInfo);
        
    } catch (error) {
        showProgress(false);
        showError('Error searching files: ' + error.message);
        console.error('Search error:', error);
    }
}

/**
 * Find keywords in text and return match details
 * @param {string} text - Text to search in
 * @param {Array} keywords - Array of keywords to search for
 * @returns {Array} - Array of match objects
 */
function findKeywordsInText(text, keywords) {
    const matches = [];
    const lowerText = text.toLowerCase();
    
    keywords.forEach(keyword => {
        let regex;
        let isWildcard = false;
        
        // Check if keyword contains wildcard asterisk
        if (keyword.includes('*')) {
            isWildcard = true;
            // Convert wildcard pattern to regex - use \w* to match word characters only
            // Escape special regex characters except asterisk
            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '\\w*');
            regex = new RegExp(`\\b${escapedKeyword}\\b`, 'gi');
        } else {
            // Standard exact word match
            regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        }
        
        const keywordMatches = [...lowerText.matchAll(regex)];
        
        keywordMatches.forEach(match => {
            const position = match.index;
            const matchedWord = match[0];
            // Get context around the match (50 characters before and after)
            const start = Math.max(0, position - 50);
            const end = Math.min(text.length, position + matchedWord.length + 50);
            const context = text.substring(start, end);
            
            matches.push({
                keyword: keyword,
                position: position,
                context: context,
                fullMatch: matchedWord,
                isWildcard: isWildcard
            });
        });
    });
    
    return matches;
}

/**
 * Display search results in the UI
 * @param {Array} results - Array of search result objects
 * @param {Array} keywords - Original search keywords
 * @param {Array} keywordInfo - Information about keyword types (exact, stemmed, wildcard)
 */
function displaySearchResults(results, keywords, keywordInfo = []) {
    const searchResults = document.getElementById('searchResults');
    const searchResultsList = document.getElementById('searchResultsList');
    
    // Create search summary with stemming info
    const stemmedKeywords = keywordInfo.filter(k => k.type === 'stemmed').map(k => k.stemmed);
    const wildcardKeywords = keywordInfo.filter(k => k.type === 'wildcard').map(k => k.original);
    
    let searchSummary = `<strong>Search terms:</strong> ${keywords.join(', ')}`;
    if (stemmedKeywords.length > 0) {
        searchSummary += `<br><small style="color: #6c757d;">🌱 Also searching stemmed forms: ${stemmedKeywords.join(', ')}</small>`;
    }
    if (wildcardKeywords.length > 0) {
        searchSummary += `<br><small style="color: #6c757d;">⭐ Wildcard searches: ${wildcardKeywords.join(', ')}</small>`;
    }
    
    if (results.length === 0) {
        searchResultsList.innerHTML = `
            <div class="search-no-results">
                <div style="font-size: 24px; margin-bottom: 10px;">🔍</div>
                <p>No files found containing the search terms: <strong>${keywords.join(', ')}</strong></p>
                <p>Try different keywords or check your spelling.</p>
            </div>
        `;
    } else {
        const resultsHTML = `
            <div style="background: #e7f3ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #17a2b8;">
                ${searchSummary}
                <div style="margin-top: 10px;"><strong>${results.length} document${results.length !== 1 ? 's' : ''} found</strong></div>
            </div>
        ` + results.map(result => {
            const matchCount = result.matches.length;
            const uniqueKeywords = [...new Set(result.matches.map(m => m.keyword))];
            
            // Get all the actual words that were matched (not just search terms)
            const actualMatchedWords = [...new Set(result.matches.map(m => m.fullMatch))];
            
            // Create preview with highlighted terms - use actual matched words for highlighting
            const preview = createHighlightedPreview(result.matches[0].context, actualMatchedWords);
            
            return `
                <div class="search-result-item" onclick="openFileFromSearch('${result.id}', '${encodeURIComponent(JSON.stringify(keywords))}')">
                    <div class="search-result-filename">📄 ${result.filename}</div>
                    <div class="search-result-matches">
                        ${matchCount} match${matchCount !== 1 ? 'es' : ''} found
                    </div>
                    <div class="search-result-preview">
                        ...${preview}...
                    </div>
                </div>
            `;
        }).join('');
        
        searchResultsList.innerHTML = resultsHTML;
    }
    
    searchResults.style.display = 'block';
    
    // Scroll to results
    searchResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Create highlighted preview text using actual matched words
 * @param {string} context - Context text around the match
 * @param {Array} matchedWords - Actual words that were matched
 * @returns {string} - HTML with highlighted matched words
 */
function createHighlightedPreviewFromMatches(context, matchedWords) {
    let highlightedText = context;
    
    matchedWords.forEach(word => {
        // Escape the word for regex and create exact match pattern
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b(${escapedWord})\\b`, 'gi');
        highlightedText = highlightedText.replace(regex, '<span class="search-highlight">$1</span>');
    });
    
    return highlightedText;
}

/**
 * Create highlighted preview text (legacy function for search patterns)
 * @param {string} context - Context text around the match
 * @param {Array} keywords - Keywords to highlight
 * @returns {string} - HTML with highlighted keywords
 */
function createHighlightedPreview(context, keywords) {
    // Check if this looks like actual matched words or search patterns
    const hasWildcards = keywords.some(k => k.includes('*'));
    
    if (!hasWildcards) {
        // If no wildcards, treat as actual matched words for better highlighting
        return createHighlightedPreviewFromMatches(context, keywords);
    }
    
    let highlightedText = context;
    
    keywords.forEach(keyword => {
        let regex;
        
        // Check if keyword contains wildcard asterisk
        if (keyword.includes('*')) {
            // Convert wildcard pattern to regex for highlighting - use \w* to match word characters only
            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '\\w*');
            regex = new RegExp(`\\b(${escapedKeyword})\\b`, 'gi');
        } else {
            // Standard exact word match
            regex = new RegExp(`\\b(${keyword})\\b`, 'gi');
        }
        
        highlightedText = highlightedText.replace(regex, '<span class="search-highlight">$1</span>');
    });
    
    return highlightedText;
}

/**
 * Open file from search results with highlighting
 * @param {string} fileId - File ID to open
 * @param {string} encodedKeywords - Encoded keywords for highlighting
 */
async function openFileFromSearch(fileId, encodedKeywords) {
    try {
        const originalKeywords = JSON.parse(decodeURIComponent(encodedKeywords));
        let data;
        
        // Check if this is a sample file or Firebase document
        if (fileId.startsWith('sample-')) {
            // Handle sample file
            const sampleFile = await getSampleFileById(fileId);
            if (!sampleFile) {
                showError('Sample file not found');
                return;
            }
            data = sampleFile;
        } else {
            // Handle Firebase document
            const doc = await db.collection('documents').doc(fileId).get();
            if (!doc.exists) {
                showError('File not found');
                return;
            }
            data = doc.data();
        }
        
        // Rebuild the complete keyword list (original + stemmed) just like in searchFiles
        const keywords = [];
        originalKeywords.forEach(keyword => {
            if (keyword.includes('*')) {
                // Wildcard search - use as-is
                keywords.push(keyword);
            } else {
                // Regular word - add both original and stemmed version
                keywords.push(keyword);
                const stemmed = stemWord(keyword);
                if (stemmed !== keyword && stemmed.length > 2) {
                    keywords.push(stemmed);
                }
            }
        });
        
        // Find all actual matches in this document
        const matches = findKeywordsInText(data.cleanedText || data.originalContent, keywords);
        const actualMatchedWords = [...new Set(matches.map(m => m.fullMatch))];
        
        // Store both original keywords and actual matched words for highlighting
        window.currentSearchKeywords = originalKeywords;
        window.currentMatchedWords = actualMatchedWords;
        
        // Open the file analysis with search highlighting using actual matched words
        await viewFileAnalysisWithSearch(data, actualMatchedWords);
        
    } catch (error) {
        showError('Error opening file: ' + error.message);
        console.error('Error opening file from search:', error);
    }
}

/**
 * Clear search results and input
 */
function clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchResults').style.display = 'none';
    window.currentSearchKeywords = null;
}

/**
 * Handle Enter key press in search input
 * @param {Event} event - Keyboard event
 */
function handleSearchKeyPress(event) {
    if (event.key === 'Enter') {
        searchFiles();
    }
}

/**
 * View file analysis with search term highlighting
 * @param {Object} docData - Document data
 * @param {Array} keywords - Keywords to highlight
 */
async function viewFileAnalysisWithSearch(docData, keywords) {
    try {
        showProgress(true);
        
        // Get additional data from Firebase if needed (only for uploaded files, not samples)
        const fileId = docData.id || generateDocumentId();
        let wordFreqData = {};
        let letterFreqData = {};
        let foreignCharsData = {};
        
        if (isFirebaseInitialized && docData.id && !docData.isSample) {
            const wordFreqSnapshot = await db.collection('wordFrequencies').doc(fileId).get();
            const letterFreqSnapshot = await db.collection('letterFrequencies').doc(fileId).get();
            const foreignCharsSnapshot = await db.collection('foreignCharacters').doc(fileId).get();
            
            wordFreqData = wordFreqSnapshot.exists ? wordFreqSnapshot.data() : {};
            letterFreqData = letterFreqSnapshot.exists ? letterFreqSnapshot.data() : {};
            foreignCharsData = foreignCharsSnapshot.exists ? foreignCharsSnapshot.data() : {};
        }
        
        // Reconstruct the analysis object
        const analysisData = {
            id: fileId,
            name: docData.filename || docData.name,
            uploadDate: docData.uploadDate?.toDate ? docData.uploadDate.toDate() : new Date(),
            wordCount: docData.wordCount,
            language: docData.language,
            originalContent: docData.originalContent,
            cleanedText: docData.cleanedText,
            wordFrequency: wordFreqData.frequencies || {},
            letterFrequency: letterFreqData.frequencies || {},
            foreignChars: foreignCharsData.characters || [],
            isSample: docData.isSample || false
        };
        
        // Display with search highlighting
        displayAnalysisResultsWithSearch(analysisData, keywords);
        showProgress(false);
        
    } catch (error) {
        showProgress(false);
        showError('Error loading file analysis: ' + error.message);
        console.error('Error loading file analysis:', error);
    }
}

/**
 * Display analysis results with search term highlighting
 * @param {Object} analysis - Analysis data
 * @param {Array} keywords - Keywords to highlight
 */
function displayAnalysisResultsWithSearch(analysis, keywords) {
    // Remove any existing analysis results
    const existingResults = document.getElementById('analysisResults');
    if (existingResults) {
        existingResults.remove();
    }
    
    // Create highlighted original content
    const highlightedContent = highlightTextContent(analysis.originalContent, keywords);
    
    // Create the analysis results HTML with highlighted content
    const analysisHTML = `
        <div id="analysisResults" style="margin-top: 30px; padding: 20px; background: white; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 20px;">
                <h3>🔍 Analysis Results (Search Highlighted)</h3>
                <button onclick="document.getElementById('analysisResults').remove()" style="background: #dc3545; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer;">✖️ Close</button>
            </div>
            
            <div style="background: #e7f3ff; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <p><strong>Highlighted Words:</strong> ${keywords.map(k => `<span class="search-highlight">${k}</span>`).join(', ')}</p>
                <p style="margin: 5px 0 0 0; font-size: 0.9em; color: #6c757d;">All matching words (including stemmed forms) are highlighted in the text below</p>
                ${window.currentSearchKeywords ? `<p style="margin: 5px 0 0 0; font-size: 0.9em; color: #6c757d;"><strong>Original search:</strong> ${window.currentSearchKeywords.join(', ')}</p>` : ''}
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px;">
                    <h4 style="color: #007bff; margin-top: 0;">📄 Document Info</h4>
                    <p><strong>Name:</strong> ${analysis.name}</p>
                    <p><strong>Language:</strong> <span style="color: #28a745; font-weight: bold;">${analysis.language}</span></p>
                    <p><strong>Total Words:</strong> ${analysis.wordCount?.toLocaleString() || 'N/A'}</p>
                    <p><strong>Processed:</strong> ${analysis.uploadDate ? analysis.uploadDate.toLocaleString() : 'N/A'}</p>
                </div>
                
                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px;">
                    <h4 style="color: #007bff; margin-top: 0;">🔍 Search Matches</h4>
                    <div id="searchMatchSummary">
                        ${generateSearchMatchSummary(analysis.originalContent, keywords)}
                    </div>
                    <div style="margin-top: 15px;">
                        <button onclick="jumpToNextOccurrence()" class="btn" style="background-color: #17a2b8; font-size: 14px; padding: 8px 16px;">
                            ⬇️ Next Match
                        </button>
                        <button onclick="jumpToPreviousOccurrence()" class="btn" style="background-color: #6c757d; font-size: 14px; padding: 8px 16px; margin-left: 8px;">
                            ⬆️ Previous Match
                        </button>
                        <span id="matchCounter" style="margin-left: 15px; color: #6c757d; font-size: 14px;"></span>
                    </div>
                </div>
            </div>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px;">
                <h4 style="color: #007bff; margin-top: 0;">📝 Full Text (with highlighting)</h4>
                <div id="fullTextContainer" style="background: white; padding: 20px; border-radius: 8px; max-height: 500px; overflow-y: auto; border: 1px solid #dee2e6; font-family: 'Georgia', serif; line-height: 1.6;">
                    ${highlightedContent}
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(document.createElement('div')).innerHTML = analysisHTML;
    
    // Initialize search navigation
    initializeSearchNavigation();
    
    // Scroll to the results
    document.getElementById('analysisResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    // Auto-jump to first occurrence after a brief delay
    setTimeout(() => {
        jumpToNextOccurrence();
    }, 500);
}

// =====================================
// SEARCH NAVIGATION FUNCTIONALITY
// =====================================

let currentMatchIndex = -1;
let allMatches = [];

/**
 * Initialize search navigation by finding all highlighted elements
 */
function initializeSearchNavigation() {
    // Find all highlighted spans in the text
    const container = document.getElementById('fullTextContainer');
    if (!container) return;
    
    allMatches = Array.from(container.querySelectorAll('.search-highlight'));
    currentMatchIndex = -1;
    
    // Add unique IDs to each match for easy navigation
    allMatches.forEach((match, index) => {
        match.id = `match-${index}`;
        match.style.position = 'relative';
    });
    
    updateMatchCounter();
}

/**
 * Jump to the next search occurrence
 */
function jumpToNextOccurrence() {
    if (allMatches.length === 0) return;
    
    // Remove previous highlight
    if (currentMatchIndex >= 0 && allMatches[currentMatchIndex]) {
        allMatches[currentMatchIndex].style.backgroundColor = '#ffeb3b';
        allMatches[currentMatchIndex].style.boxShadow = 'none';
    }
    
    // Move to next match (cycle to beginning if at end)
    currentMatchIndex = (currentMatchIndex + 1) % allMatches.length;
    
    // Highlight current match
    const currentMatch = allMatches[currentMatchIndex];
    if (currentMatch) {
        currentMatch.style.backgroundColor = '#ff9800';
        currentMatch.style.boxShadow = '0 0 10px rgba(255, 152, 0, 0.5)';
        currentMatch.style.fontWeight = 'bold';
        
        // Scroll to the match within the container
        const container = document.getElementById('fullTextContainer');
        if (container) {
            const matchRect = currentMatch.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            
            // Calculate the scroll position to center the match in the container
            const scrollTop = container.scrollTop + (matchRect.top - containerRect.top) - (container.clientHeight / 2);
            
            container.scrollTo({
                top: scrollTop,
                behavior: 'smooth'
            });
        }
    }
    
    updateMatchCounter();
}

/**
 * Jump to the previous search occurrence
 */
function jumpToPreviousOccurrence() {
    if (allMatches.length === 0) return;
    
    // Remove previous highlight
    if (currentMatchIndex >= 0 && allMatches[currentMatchIndex]) {
        allMatches[currentMatchIndex].style.backgroundColor = '#ffeb3b';
        allMatches[currentMatchIndex].style.boxShadow = 'none';
    }
    
    // Move to previous match (cycle to end if at beginning)
    currentMatchIndex = currentMatchIndex <= 0 ? allMatches.length - 1 : currentMatchIndex - 1;
    
    // Highlight current match
    const currentMatch = allMatches[currentMatchIndex];
    if (currentMatch) {
        currentMatch.style.backgroundColor = '#ff9800';
        currentMatch.style.boxShadow = '0 0 10px rgba(255, 152, 0, 0.5)';
        currentMatch.style.fontWeight = 'bold';
        
        // Scroll to the match within the container
        const container = document.getElementById('fullTextContainer');
        if (container) {
            const matchRect = currentMatch.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            
            // Calculate the scroll position to center the match in the container
            const scrollTop = container.scrollTop + (matchRect.top - containerRect.top) - (container.clientHeight / 2);
            
            container.scrollTo({
                top: scrollTop,
                behavior: 'smooth'
            });
        }
    }
    
    updateMatchCounter();
}

/**
 * Update the match counter display
 */
function updateMatchCounter() {
    const counterElement = document.getElementById('matchCounter');
    if (counterElement && allMatches.length > 0) {
        const displayIndex = currentMatchIndex >= 0 ? currentMatchIndex + 1 : 0;
        counterElement.textContent = `Match ${displayIndex} of ${allMatches.length}`;
    } else if (counterElement) {
        counterElement.textContent = 'No matches found';
    }
}

/**
 * Highlight actual matched words in text content (more accurate than search patterns)
 * @param {string} content - Original text content  
 * @param {Array} matchedWords - Actual words that were matched
 * @returns {string} - HTML with highlighted matched words
 */
function highlightMatchedWordsInText(content, matchedWords) {
    let highlightedContent = content;
    
    // Replace newlines with HTML breaks first
    highlightedContent = highlightedContent.replace(/\n/g, '<br>');
    
    // Highlight each matched word
    matchedWords.forEach(word => {
        // Escape the word for regex and create exact match pattern
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b(${escapedWord})\\b`, 'gi');
        highlightedContent = highlightedContent.replace(regex, '<span class="search-highlight">$1</span>');
    });
    
    return highlightedContent;
}

/**
 * Highlight keywords in text content (legacy function for search patterns)
 * @param {string} content - Original text content
 * @param {Array} keywords - Keywords to highlight
 * @returns {string} - HTML with highlighted keywords
 */
function highlightTextContent(content, keywords) {
    // Check if this looks like actual matched words or search patterns
    const hasWildcards = keywords.some(k => k.includes('*'));
    
    if (!hasWildcards) {
        // If no wildcards, treat as actual matched words for better highlighting
        return highlightMatchedWordsInText(content, keywords);
    }
    
    let highlightedContent = content;
    
    // Replace newlines with HTML breaks first
    highlightedContent = highlightedContent.replace(/\n/g, '<br>');
    
    // Highlight each keyword
    keywords.forEach(keyword => {
        let regex;
        
        // Check if keyword contains wildcard asterisk
        if (keyword.includes('*')) {
            // Convert wildcard pattern to regex for highlighting - use \w* to match word characters only
            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '\\w*');
            regex = new RegExp(`\\b(${escapedKeyword})\\b`, 'gi');
        } else {
            // Standard exact word match
            regex = new RegExp(`\\b(${keyword})\\b`, 'gi');
        }
        
        highlightedContent = highlightedContent.replace(regex, '<span class="search-highlight">$1</span>');
    });
    
    return highlightedContent;
}

/**
 * Generate search match summary
 * @param {string} content - Text content
 * @param {Array} keywords - Keywords to search for
 * @returns {string} - HTML summary of matches
 */
function generateSearchMatchSummary(content, keywords) {
    const lowerContent = content.toLowerCase();
    const summary = keywords.map(keyword => {
        let regex;
        
        // Check if keyword contains wildcard asterisk
        if (keyword.includes('*')) {
            // Convert wildcard pattern to regex for counting - use \w* to match word characters only
            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '\\w*');
            regex = new RegExp(`\\b${escapedKeyword}\\b`, 'gi');
        } else {
            // Standard exact word match
            regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        }
        
        const matches = lowerContent.match(regex) || [];
        const displayKeyword = keyword.includes('*') ? `${keyword} (wildcard)` : keyword;
        return `<p>📍 <strong>${displayKeyword}:</strong> ${matches.length} occurrence${matches.length !== 1 ? 's' : ''}</p>`;
    }).join('');
    
    return summary || '<p>No matches found</p>';
}

// =====================================
// INTERACTIVE TEXT ANALYSIS (Question 10)
// =====================================

/**
 * Real-time text analysis as user types
 */
function analyzeTextReal() {
    const stringS = document.getElementById('stringS').value;
    const textT = document.getElementById('textAreaT').value;
    
    // Update basic statistics
    updateTextStatistics(textT, stringS);
    
    // Update character analysis if we have both inputs
    if (stringS && textT) {
        updateCharacterAnalysis(textT, stringS);
    } else {
        // Clear analysis if inputs are empty
        clearAnalysisDisplay();
    }
}

/**
 * Update basic text statistics
 */
function updateTextStatistics(text, stringS) {
    const totalChars = text.length;
    const totalWords = text.trim() ? text.trim().split(/\s+/).length : 0;
    
    // Count how many characters from S are found in text
    let sCharsFound = 0;
    if (stringS) {
        for (let char of stringS) {
            const regex = new RegExp(char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            const matches = text.match(regex) || [];
            sCharsFound += matches.length;
        }
    }
    
    // Update display
    document.getElementById('totalChars').textContent = totalChars.toLocaleString();
    document.getElementById('totalWords').textContent = totalWords.toLocaleString();
    document.getElementById('sCharsFound').textContent = sCharsFound.toLocaleString();
}

/**
 * Update character count and frequency analysis
 */
function updateCharacterAnalysis(text, stringS) {
    const characterCounts = {};
    const totalChars = text.length;
    
    // Count occurrences of each character from stringS
    for (let char of stringS) {
        const regex = new RegExp(char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = text.match(regex) || [];
        characterCounts[char] = matches.length;
    }
    
    // Update character counts display
    const countsHtml = Object.entries(characterCounts)
        .map(([char, count]) => {
            const displayChar = char === ' ' ? '(space)' : char;
            return `<p><strong>'${displayChar}':</strong> ${count} occurrence${count !== 1 ? 's' : ''}</p>`;
        })
        .join('');
    
    document.getElementById('characterCounts').innerHTML = countsHtml || '<p style="color: #6c757d; font-style: italic;">No characters to analyze...</p>';
    
    // Update character frequencies display
    const frequenciesHtml = Object.entries(characterCounts)
        .map(([char, count]) => {
            const frequency = totalChars > 0 ? ((count / totalChars) * 100).toFixed(2) : 0;
            const displayChar = char === ' ' ? '(space)' : char;
            return `<p><strong>'${displayChar}':</strong> ${frequency}% <span style="color: #6c757d;">(${count}/${totalChars})</span></p>`;
        })
        .join('');
    
    document.getElementById('characterFrequencies').innerHTML = frequenciesHtml || '<p style="color: #6c757d; font-style: italic;">No frequencies to calculate...</p>';
}

/**
 * Clear analysis display when inputs are empty
 */
function clearAnalysisDisplay() {
    document.getElementById('characterCounts').innerHTML = '<p style="color: #6c757d; font-style: italic;">Enter text to see character counts...</p>';
    document.getElementById('characterFrequencies').innerHTML = '<p style="color: #6c757d; font-style: italic;">Enter text to see character frequencies...</p>';
    document.getElementById('wordCounts').innerHTML = '<p style="color: #6c757d; font-style: italic;">Enter text to see word counts...</p>';
}

// =====================================
// WORD ANALYSIS FUNCTIONALITY (Question 11)
// =====================================

/**
 * Update word analysis display
 */
function updateWordAnalysis(text) {
    if (!text.trim()) {
        document.getElementById('wordCounts').innerHTML = '<p style="color: #6c757d; font-style: italic;">Enter text to see word counts...</p>';
        return;
    }
    
    // Split text into words (separated by spaces and punctuation)
    const words = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
        .split(/\s+/) // Split by whitespace
        .filter(word => word.length > 0); // Remove empty strings
    
    // Count word frequencies
    const wordCounts = {};
    words.forEach(word => {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
    });
    
    // Sort words by frequency (descending) then alphabetically
    const sortedWords = Object.entries(wordCounts)
        .sort(([a, countA], [b, countB]) => {
            if (countB !== countA) return countB - countA; // Sort by count descending
            return a.localeCompare(b); // Then alphabetically
        });
    
    // Show all words by frequency
    let wordsHtml = '<div><h5 style="margin: 0 0 10px 0; color: #6f42c1;">📊 All Words (by frequency):</h5>';
    
    // Show top 15 most frequent words
    const topWords = sortedWords.slice(0, 15);
    wordsHtml += topWords.map(([word, count]) => 
        `<p style="margin: 2px 0;"><strong>${word}:</strong> ${count} occurrence${count !== 1 ? 's' : ''}</p>`
    ).join('');
    
    if (sortedWords.length > 15) {
        wordsHtml += `<p style="color: #6c757d; font-style: italic; margin-top: 10px;">... and ${sortedWords.length - 15} more words</p>`;
    }
    
    wordsHtml += '</div>';
    
    document.getElementById('wordCounts').innerHTML = wordsHtml;
}

/**
 * Perform word replacement operation (Question 11 extension)
 */
function performWordReplacement() {
    const wordToReplace = document.getElementById('wordToReplace').value.trim();
    const replacementWord = document.getElementById('replacementWord').value.trim();
    const textT = document.getElementById('textAreaT').value;
    
    if (!wordToReplace) {
        alert('Please enter a word to replace');
        return;
    }
    
    if (!replacementWord) {
        alert('Please enter a replacement word');
        return;
    }
    
    if (!textT) {
        alert('Please enter some text in Text Area T');
        return;
    }
    
    // Perform case-insensitive word replacement (whole words only)
    const regex = new RegExp(`\\b${wordToReplace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const replacedText = textT.replace(regex, replacementWord);
    
    // Count replacements
    const matches = textT.match(regex) || [];
    const replacementCount = matches.length;
    
    // Show replacement result
    showWordReplacementPreview(replacedText, wordToReplace, replacementWord, replacementCount);
}

/**
 * Show word replacement preview
 */
function showWordReplacementPreview(replacedText, originalWord, newWord, count) {
    document.getElementById('wordReplacedText').textContent = replacedText;
    document.getElementById('wordReplacementStats').textContent = 
        `Replaced ${count} occurrence${count !== 1 ? 's' : ''} of "${originalWord}" with "${newWord}"`;
    document.getElementById('wordReplacementPreview').style.display = 'block';
    
    // Scroll to the preview
    document.getElementById('wordReplacementPreview').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// =====================================
// WORD AUTOCOMPLETE FUNCTIONALITY
// =====================================

let currentWordsList = []; // Cache of all words from the text
let selectedSuggestionIndex = -1; // For keyboard navigation

/**
 * Auto-complete word search as user types
 */
function searchWordsAutoComplete() {
    const input = document.getElementById('wordToReplace');
    const searchTerm = input.value.trim().toLowerCase();
    const textT = document.getElementById('textAreaT').value;
    const dropdown = document.getElementById('wordSearchDropdown');
    
    // Hide word count result when typing
    document.getElementById('wordCountResult').style.display = 'none';
    
    if (!searchTerm || !textT) {
        dropdown.style.display = 'none';
        return;
    }
    
    // Extract all unique words from the text
    const words = textT.toLowerCase()
        .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
        .split(/\s+/) // Split by whitespace
        .filter(word => word.length > 0); // Remove empty strings
    
    // Get unique words and their counts
    const wordCounts = {};
    words.forEach(word => {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
    });
    
    // Filter words that start with the search term
    const matchingWords = Object.entries(wordCounts)
        .filter(([word]) => word.startsWith(searchTerm))
        .sort(([a, countA], [b, countB]) => {
            // Sort by frequency (descending) then alphabetically
            if (countB !== countA) return countB - countA;
            return a.localeCompare(b);
        })
        .slice(0, 10); // Limit to top 10 matches
    
    currentWordsList = matchingWords;
    selectedSuggestionIndex = -1;
    
    if (matchingWords.length === 0) {
        dropdown.style.display = 'none';
        return;
    }
    
    // Build dropdown HTML
    const dropdownHTML = matchingWords.map(([word, count], index) => `
        <div 
            class="word-suggestion" 
            data-index="${index}"
            style="
                padding: 8px 12px; 
                cursor: pointer; 
                border-bottom: 1px solid #eee;
                display: flex;
                justify-content: space-between;
                align-items: center;
            "
            onmouseover="highlightWordSuggestion(${index})"
            onclick="selectWordFromDropdown('${word}', ${count})"
        >
            <span style="font-weight: 500;">${word}</span>
            <span style="color: #6c757d; font-size: 0.9em;">${count} occurrence${count !== 1 ? 's' : ''}</span>
        </div>
    `).join('');
    
    dropdown.innerHTML = dropdownHTML;
    dropdown.style.display = 'block';
}

/**
 * Handle keyboard navigation in word search
 */
function handleWordSearchKeydown(event) {
    const dropdown = document.getElementById('wordSearchDropdown');
    
    if (dropdown.style.display === 'none' || currentWordsList.length === 0) {
        return;
    }
    
    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, currentWordsList.length - 1);
            updateSuggestionHighlight();
            break;
            
        case 'ArrowUp':
            event.preventDefault();
            selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
            updateSuggestionHighlight();
            break;
            
        case 'Enter':
            event.preventDefault();
            if (selectedSuggestionIndex >= 0) {
                const [word, count] = currentWordsList[selectedSuggestionIndex];
                selectWordFromDropdown(word, count);
            }
            break;
            
        case 'Escape':
            dropdown.style.display = 'none';
            selectedSuggestionIndex = -1;
            break;
    }
}

/**
 * Highlight word suggestion on hover
 */
function highlightWordSuggestion(index) {
    selectedSuggestionIndex = index;
    updateSuggestionHighlight();
}

/**
 * Update visual highlighting of selected suggestion
 */
function updateSuggestionHighlight() {
    const suggestions = document.querySelectorAll('.word-suggestion');
    suggestions.forEach((suggestion, index) => {
        if (index === selectedSuggestionIndex) {
            suggestion.style.backgroundColor = '#e7f3ff';
            suggestion.style.color = '#007bff';
        } else {
            suggestion.style.backgroundColor = 'white';
            suggestion.style.color = 'black';
        }
    });
}

/**
 * Select word from dropdown and show count
 */
function selectWordFromDropdown(word, count) {
    const input = document.getElementById('wordToReplace');
    const dropdown = document.getElementById('wordSearchDropdown');
    
    // Set the input value
    input.value = word;
    
    // Hide dropdown
    dropdown.style.display = 'none';
    selectedSuggestionIndex = -1;
    
    // Show word count result automatically
    const resultText = `The word "${word}" appears ${count} time${count !== 1 ? 's' : ''} in the text.`;
    document.getElementById('wordCountDisplay').textContent = resultText;
    document.getElementById('wordCountResult').style.display = 'block';
}

/**
 * Count occurrences of a specific word in the text
 */
function countWordOccurrences() {
    const wordToCount = document.getElementById('wordToReplace').value.trim();
    const textT = document.getElementById('textAreaT').value;
    
    if (!wordToCount) {
        alert('Please enter a word to count in the "Word to Replace" field');
        return;
    }
    
    if (!textT) {
        alert('Please enter some text in Text Area T');
        return;
    }
    
    // Count occurrences (case-insensitive, whole words only)
    const regex = new RegExp(`\\b${wordToCount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const matches = textT.match(regex) || [];
    const count = matches.length;
    
    // Display the result
    const resultText = `The word "${wordToCount}" appears ${count} time${count !== 1 ? 's' : ''} in the text.`;
    document.getElementById('wordCountDisplay').textContent = resultText;
    document.getElementById('wordCountResult').style.display = 'block';
    
    // Scroll to the result
    document.getElementById('wordCountResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Perform character replacement operation
 */
function performCharacterReplacement() {
    const stringS = document.getElementById('stringS').value;
    const textT = document.getElementById('textAreaT').value;
    const replacementC = document.getElementById('replacementC').value;
    
    if (!stringS) {
        alert('Please enter characters in String S to replace');
        return;
    }
    
    if (!textT) {
        alert('Please enter some text in Text Area T');
        return;
    }
    
    if (!replacementC) {
        alert('Please enter a replacement character C');
        return;
    }
    
    // Perform replacement
    let replacedText = textT;
    for (let char of stringS) {
        const regex = new RegExp(char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        replacedText = replacedText.replace(regex, replacementC);
    }
    
    // Show replacement preview
    showReplacementPreview(textT, replacedText);
}

/**
 * Show before/after replacement preview
 */
function showReplacementPreview(original, replaced) {
    document.getElementById('originalText').textContent = original;
    document.getElementById('replacedText').textContent = replaced;
    document.getElementById('replacementPreview').style.display = 'block';
    
    // Scroll to the preview
    document.getElementById('replacementPreview').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// =====================================
// STOP WORDS PROCESSING (Question 12)
// =====================================

/**
 * Remove stop words from the text
 */
function removeStopWords() {
    const stopWordsInput = document.getElementById('stopWordsP').value.trim();
    const textT = document.getElementById('textAreaT').value;
    
    if (!stopWordsInput) {
        alert('Please enter stop words in the P field (comma-separated)');
        return;
    }
    
    if (!textT) {
        alert('Please enter some text in Text Area T');
        return;
    }
    
    // Parse stop words (comma-separated, max 10)
    const stopWords = stopWordsInput
        .split(',')
        .map(word => word.trim().toLowerCase())
        .filter(word => word.length > 0)
        .slice(0, 10); // Limit to 10 words
    
    if (stopWords.length === 0) {
        alert('Please enter valid stop words separated by commas');
        return;
    }
    
    // Split text into words
    const words = textT.split(/\s+/);
    const originalWordCount = words.length;
    
    // Track removed words and their counts
    const removedWords = {};
    let totalRemoved = 0;
    
    // Filter out stop words (case-insensitive)
    const filteredWords = words.filter(word => {
        const cleanWord = word.toLowerCase().replace(/[^\w]/g, ''); // Remove punctuation for comparison
        
        if (stopWords.includes(cleanWord)) {
            // Track this removal
            const originalWord = cleanWord;
            removedWords[originalWord] = (removedWords[originalWord] || 0) + 1;
            totalRemoved++;
            return false; // Remove this word
        }
        return true; // Keep this word
    });
    
    // Create filtered text
    const filteredText = filteredWords.join(' ');
    const finalWordCount = filteredWords.length;
    
    // Display results
    showStopWordsResults(stopWords, removedWords, totalRemoved, originalWordCount, finalWordCount, filteredText);
}

/**
 * Display stop words removal results
 */
function showStopWordsResults(stopWords, removedWords, totalRemoved, originalCount, finalCount, filteredText) {
    // Show statistics
    const statsHtml = `
        <p style="margin: 2px 0;"><strong>Original word count:</strong> ${originalCount}</p>
        <p style="margin: 2px 0;"><strong>Words removed:</strong> ${totalRemoved}</p>
        <p style="margin: 2px 0;"><strong>Final word count:</strong> ${finalCount}</p>
        <p style="margin: 2px 0;"><strong>Percentage removed:</strong> ${((totalRemoved / originalCount) * 100).toFixed(1)}%</p>
    `;
    document.getElementById('stopWordsStats').innerHTML = statsHtml;
    
    // Show removed words list
    const removedWordsList = Object.entries(removedWords)
        .sort(([a, countA], [b, countB]) => countB - countA) // Sort by count descending
        .map(([word, count]) => `<span style="background: #f8d7da; padding: 2px 6px; border-radius: 3px; margin: 2px; display: inline-block;">${word} (${count})</span>`)
        .join('');
    
    document.getElementById('removedWordsList').innerHTML = removedWordsList || '<span style="color: #6c757d;">No stop words were found in the text</span>';
    
    // Show filtered text
    document.getElementById('filteredText').textContent = filteredText;
    
    // Show results section
    document.getElementById('stopWordsResults').style.display = 'block';
    
    // Scroll to results
    document.getElementById('stopWordsResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Clear stop words results and reset
 */
function clearStopWordsResults() {
    document.getElementById('stopWordsP').value = '';
    document.getElementById('stopWordsResults').style.display = 'none';
}

/**
 * Clear all interactive analysis inputs and results
 */
function clearInteractiveAnalysis() {
    document.getElementById('stringS').value = '';
    document.getElementById('textAreaT').value = '';
    document.getElementById('replacementC').value = '';
    document.getElementById('wordToReplace').value = '';
    document.getElementById('replacementWord').value = '';
    document.getElementById('stopWordsP').value = '';
    document.getElementById('replacementPreview').style.display = 'none';
    document.getElementById('wordReplacementPreview').style.display = 'none';
    document.getElementById('wordCountResult').style.display = 'none';
    document.getElementById('wordSearchDropdown').style.display = 'none';
    document.getElementById('stopWordsResults').style.display = 'none';
    
    // Reset displays
    document.getElementById('totalChars').textContent = '0';
    document.getElementById('totalWords').textContent = '0';
    document.getElementById('sCharsFound').textContent = '0';
    clearAnalysisDisplay();
}

// =====================================
// GLOBAL FUNCTION ASSIGNMENTS
// =====================================

// Make functions globally available for HTML onclick handlers
window.uploadText = uploadText;
window.loadSampleFile = loadSampleFile;
window.analyzeText = analyzeText;
window.viewFileAnalysis = viewFileAnalysis;
window.removeFile = removeFile;
window.clearDatabase = clearDatabase;
window.closeErrorModal = closeErrorModal;
window.searchFiles = searchFiles;
window.clearSearch = clearSearch;
window.handleSearchKeyPress = handleSearchKeyPress;
window.openFileFromSearch = openFileFromSearch;
window.jumpToNextOccurrence = jumpToNextOccurrence;
window.jumpToPreviousOccurrence = jumpToPreviousOccurrence;
window.analyzeTextReal = analyzeTextReal;
window.performCharacterReplacement = performCharacterReplacement;
window.performWordReplacement = performWordReplacement;
window.countWordOccurrences = countWordOccurrences;
window.searchWordsAutoComplete = searchWordsAutoComplete;
window.handleWordSearchKeydown = handleWordSearchKeydown;
window.highlightWordSuggestion = highlightWordSuggestion;
window.selectWordFromDropdown = selectWordFromDropdown;
window.removeStopWords = removeStopWords;
window.clearStopWordsResults = clearStopWordsResults;
window.clearInteractiveAnalysis = clearInteractiveAnalysis;

console.log('Global functions assigned:', {
    uploadText: typeof window.uploadText,
    loadSampleFile: typeof window.loadSampleFile,
    analyzeText: typeof window.analyzeText,
    viewFileAnalysis: typeof window.viewFileAnalysis,
    removeFile: typeof window.removeFile,
    clearDatabase: typeof window.clearDatabase,
    closeErrorModal: typeof window.closeErrorModal,
    searchFiles: typeof window.searchFiles,
    clearSearch: typeof window.clearSearch,
    handleSearchKeyPress: typeof window.handleSearchKeyPress,
    openFileFromSearch: typeof window.openFileFromSearch,
    jumpToNextOccurrence: typeof window.jumpToNextOccurrence,
    jumpToPreviousOccurrence: typeof window.jumpToPreviousOccurrence,
    analyzeTextReal: typeof window.analyzeTextReal,
    performCharacterReplacement: typeof window.performCharacterReplacement,
    performWordReplacement: typeof window.performWordReplacement,
    countWordOccurrences: typeof window.countWordOccurrences,
    searchWordsAutoComplete: typeof window.searchWordsAutoComplete,
    handleWordSearchKeydown: typeof window.handleWordSearchKeydown,
    highlightWordSuggestion: typeof window.highlightWordSuggestion,
    selectWordFromDropdown: typeof window.selectWordFromDropdown,
    removeStopWords: typeof window.removeStopWords,
    clearStopWordsResults: typeof window.clearStopWordsResults,
    clearInteractiveAnalysis: typeof window.clearInteractiveAnalysis
});

console.log('TextReader app.js fully loaded and ready!');
