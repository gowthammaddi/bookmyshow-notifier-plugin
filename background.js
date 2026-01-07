// BookMyShow Ticket Notifier - Background Script
const DEFAULT_CHECK_INTERVAL = 5;
let alertIntervalId = null;
let alertCount = 0;

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  console.log('BookMyShow Notifier installed');
});

// Handle notification clicks
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
});

// Monitoring functions
function startMonitoring(interval) {
  const checkInterval = interval || DEFAULT_CHECK_INTERVAL;
  chrome.alarms.create('checkTickets', {
    periodInMinutes: checkInterval
  });
  console.log('Monitoring started with', checkInterval, 'minute interval');
}

function stopMonitoring() {
  chrome.alarms.clear('checkTickets');
  console.log('Monitoring stopped');
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkTickets') {
    checkAllMovies();
  }
});

// Check all movies
async function checkAllMovies() {
  console.log('=== CHECK ALL MOVIES STARTED ===');

  const data = await chrome.storage.local.get(['movies']);
  const movies = data.movies || [];

  console.log('Movies to check:', movies.length);

  for (const movie of movies) {
    console.log('Processing movie:', movie.title);
    await checkMovie(movie);
  }

  console.log('=== CHECK ALL MOVIES COMPLETED ===');
}

// Check single movie
async function checkMovie(movie) {
  console.log('>>> checkMovie called with:', movie);

  try {
    console.log('>>> Inside try block');

    // Construct URL
    let checkUrl;
    if (movie.targetDate) {
      checkUrl = `https://in.bookmyshow.com/movies/${movie.city}/${movie.movieSlug}/buytickets/${movie.movieId}/${movie.targetDate}`;
      console.log('>>> Checking specific date:', movie.targetDate);
    } else {
      checkUrl = `https://in.bookmyshow.com/movies/${movie.city}/${movie.movieSlug}/${movie.movieId}`;
      console.log('>>> Checking general availability');
    }

    console.log('>>> Check URL:', checkUrl);
    console.log('>>> Starting fetch...');

    const response = await fetch(checkUrl);
    console.log('>>> Fetch completed, status:', response.status);

    const html = await response.text();
    console.log('>>> HTML received, length:', html.length);

    let isBookingOpen = false;
    let statusMessage = 'not available';

    if (movie.targetDate) {
      const result = checkDateSpecificBooking(html, movie.targetDate);
      isBookingOpen = result.isAvailable;
      statusMessage = result.status;
      console.log('>>> Date check result:', result);
    } else {
      isBookingOpen = checkHtmlForBooking(html);
      statusMessage = isBookingOpen ? 'available' : 'not available';
      console.log('>>> General check result:', isBookingOpen);
    }

    if (isBookingOpen) {
      console.log('✅ TICKETS AVAILABLE!');
      await sendNotification(movie);
    }

    // Update status
    const stored = await chrome.storage.local.get(['movies']);
    const movies = stored.movies || [];
    const index = movies.findIndex(m => m.id === movie.id);
    if (index !== -1) {
      movies[index].lastChecked = new Date().toISOString();
      movies[index].lastStatus = statusMessage;
      await chrome.storage.local.set({ movies });
    }

  } catch (error) {
    console.error('>>> Error in checkMovie:', error);

    const stored = await chrome.storage.local.get(['movies']);
    const movies = stored.movies || [];
    const index = movies.findIndex(m => m.id === movie.id);
    if (index !== -1) {
      movies[index].lastChecked = new Date().toISOString();
      movies[index].lastStatus = 'error';
      movies[index].lastError = error.message;
      await chrome.storage.local.set({ movies });
    }
  }
}

// Check general HTML for booking
function checkHtmlForBooking(html) {
  const htmlLower = html.toLowerCase();
  return htmlLower.includes('book tickets') || htmlLower.includes('buy tickets');
}

// Check date-specific booking
function checkDateSpecificBooking(html, targetDate) {
  console.log('=== DATE SPECIFIC CHECK ===');
  console.log('Target date (YYYYMMDD):', targetDate);

  const day = targetDate.substring(6, 8);
  const month = targetDate.substring(4, 6);
  const year = targetDate.substring(0, 4);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const monthName = months[parseInt(month) - 1];

  console.log(`Looking for date: ${day} ${monthName} ${year}`);
  console.log(`Parsed: Day=${day}, Month=${monthName}, Year=${year}`);

  // Store HTML for manual verification
  console.log('Full HTML stored in window for inspection');
  if (typeof window !== 'undefined') {
    window.lastCheckedHtml = html;
  }

  // Log HTML snippet showing date section (first 2000 chars)
  console.log('HTML snippet (first 2000 chars):', html.substring(0, 2000));

  // Check for theaters
  const hasTheaters = html.includes('PVR') || html.includes('INOX') || html.includes('Cinepolis') || html.includes('venue');
  console.log('Has theaters/venues:', hasTheaters);

  // Check for showtimes
  const showtimes = html.match(/\d{2}:\d{2}\s*(AM|PM)/gi);
  console.log('Found showtimes:', showtimes?.length || 0, showtimes?.slice(0, 5));
  const hasShowtimes = showtimes && showtimes.length > 2;

  // Find the SELECTED/ACTIVE date on the page
  // BookMyShow uses patterns like: <div class="...selected..." data-date-number="12">
  // or the red highlighted date box

  // Strategy: Look for the selected date indicator
  // The selected date usually has class names like "selected", "active", or specific styling

  // Extract all date numbers that appear near date selection UI
  const datePattern = /<div[^>]*(?:date|day)[^>]*>\s*(\d{1,2})\s*<\/div>/gi;
  let dateMatches = [...html.matchAll(datePattern)];
  console.log('Date elements found:', dateMatches.map(m => m[1]));

  // Look for the selected date more specifically
  // Pattern 1: Check for "MON 12 JAN" pattern (the selected one has red background)
  const selectedDatePattern = new RegExp(`<div[^>]*class="[^"]*(?:selected|active)[^"]*"[^>]*>\\s*${day}\\s*<`, 'i');
  const hasSelectedDay = selectedDatePattern.test(html);
  console.log('Selected day match (pattern 1):', hasSelectedDay);

  // Pattern 2: Look for the date near month name in a selected context
  const contextPattern = new RegExp(`${day}[^<]{0,50}${monthName}|${monthName}[^<]{0,50}${day}`, 'i');
  const dateInContext = contextPattern.test(html);
  console.log('Date-month proximity match:', dateInContext);

  // Pattern 3: Check if the exact format "12\nJAN" appears (selected date box)
  const exactPattern = new RegExp(`>\\s*${day}\\s*</.*?${monthName}`, 'i');
  const exactMatch = exactPattern.test(html);
  console.log('Exact date box match:', exactMatch);

  // The date matches if we find it in a selected/highlighted context
  dateMatches = hasSelectedDay || exactMatch;
  console.log('Final date match decision:', dateMatches);

  const ticketsAvailable = hasTheaters && hasShowtimes;
  console.log('Tickets available (theaters + showtimes):', ticketsAvailable);

  console.log('=== FINAL DECISION ===');

  if (dateMatches && ticketsAvailable) {
    console.log('✅ Date matches AND tickets available');
    return { isAvailable: true, status: 'available' };
  } else if (ticketsAvailable && !dateMatches) {
    console.log('⚠️ Tickets available but WRONG DATE');
    return { isAvailable: false, status: 'date-mismatch' };
  } else {
    console.log('❌ No tickets available');
    return { isAvailable: false, status: 'not available' };
  }
}

// Send notification
async function sendNotification(movie) {
  try {
    console.log('=== SENDING NOTIFICATION ===');

    let moviePageUrl;
    if (movie.targetDate) {
      moviePageUrl = `https://in.bookmyshow.com/movies/${movie.city}/${movie.movieSlug}/buytickets/${movie.movieId}/${movie.targetDate}`;
    } else {
      moviePageUrl = `https://in.bookmyshow.com/movies/${movie.city}/${movie.movieSlug}/${movie.movieId}`;
    }

    // Play sound
    const settings = await chrome.storage.local.get(['enableSound', 'enableTeamsCall', 'teamsEmail']);

    if (settings.enableSound !== false) {
      playAlertSound();
    }

    // Open tab
    chrome.tabs.create({ url: moviePageUrl, active: true });

    // Teams message
    if (settings.enableTeamsCall && settings.teamsEmail) {
      const dateInfo = movie.targetDate ? ` for ${formatDate(movie.targetDate)}` : '';
      const message = `🎬 BookMyShow Alert!\n\nTickets available for ${movie.title}${dateInfo}!\n\nBook now: ${moviePageUrl}`;
      const teamsUrl = `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(settings.teamsEmail)}&message=${encodeURIComponent(message)}`;

      setTimeout(() => {
        chrome.tabs.create({ url: teamsUrl, active: true });
      }, 1500);
    }

    await chrome.storage.local.set({
      lastNotification: {
        movieId: movie.id,
        title: movie.title,
        message: `Bookings opened for ${movie.title}`,
        timestamp: Date.now(),
        url: moviePageUrl
      }
    });

  } catch (error) {
    console.error('Error in sendNotification:', error);
  }
}

// Alert sound
async function playAlertSound() {
  try {
    stopAlert();
    alertCount = 0;

    const playOnce = () => {
      if (alertCount >= 10) {
        stopAlert();
        return;
      }
      alertCount++;
      console.log(`Alert ${alertCount}/10`);
      chrome.tts.speak('Attention! Tickets are now available! Book now!', {
        rate: 0.9,
        pitch: 1.3,
        volume: 1.0
      });
    };

    playOnce();
    alertIntervalId = setInterval(playOnce, 4000);
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });
  } catch (error) {
    console.error('Error playing sound:', error);
  }
}

function stopAlert() {
  if (alertIntervalId) {
    clearInterval(alertIntervalId);
    alertIntervalId = null;
    alertCount = 0;
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  }
  chrome.tts.stop();
}

function formatDate(dateStr) {
  if (!dateStr || dateStr.length !== 8) return dateStr;
  const y = dateStr.substring(0, 4);
  const m = dateStr.substring(4, 6);
  const d = dateStr.substring(6, 8);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
}

// Message handlers
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startMonitoring') {
    startMonitoring(request.interval);
    sendResponse({ success: true });
  } else if (request.action === 'stopMonitoring') {
    stopMonitoring();
    sendResponse({ success: true });
  } else if (request.action === 'checkNow') {
    checkAllMovies().then(() => sendResponse({ success: true }));
    return true;
  } else if (request.action === 'stopAlert') {
    stopAlert();
    sendResponse({ success: true });
  } else if (request.action === 'getAlertStatus') {
    sendResponse({ isPlaying: alertIntervalId !== null });
  }
});
